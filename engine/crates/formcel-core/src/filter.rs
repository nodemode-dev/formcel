use crate::formula::Area;
use crate::numfmt;
use crate::wire::{escape, unescape};
use crate::{eval, Addr, Effect, EngineError, Tx, Value, Workbook};

#[derive(Clone, Debug, PartialEq)]
pub enum Crit {
    Values { keep: Vec<String>, blanks: bool },
    Cond { first: (String, String), second: Option<(String, String)>, and: bool },
    Fill(String),
    Font(String),
    Top { bottom: bool, n: f64, percent: bool },
    Avg(bool),
    Dates { keep: Vec<String>, blanks: bool },
    Dyn(String),
    Icon(String),
}

pub const DYNAMIC: [&str; 33] = [
    "today", "yesterday", "tomorrow", "thisweek", "lastweek", "nextweek", "thismonth", "lastmonth", "nextmonth", "thisquarter", "lastquarter", "nextquarter", "thisyear", "lastyear", "nextyear", "yeartodate", "q1", "q2", "q3", "q4", "m1",
    "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "null",
];

fn span_of(name: &str, today: f64) -> Option<(f64, f64)> {
    let t = today.floor();
    let (y, m, _) = numfmt::ymd(t)?;
    let month = |shift: i64| -> Option<(f64, f64)> { Some((numfmt::serial(y, m + shift, 1)?, numfmt::serial(y, m + shift + 1, 1)? - 1.0)) };
    let quarter = |shift: i64| -> Option<(f64, f64)> {
        let q0 = (m - 1) / 3 * 3 + 1 + shift * 3;
        Some((numfmt::serial(y, q0, 1)?, numfmt::serial(y, q0 + 3, 1)? - 1.0))
    };
    let week = |shift: f64| {
        let start = t - (numfmt::weekday(t) - 1) as f64 + shift * 7.0;
        Some((start, start + 6.0))
    };
    match name {
        "today" => Some((t, t)),
        "yesterday" => Some((t - 1.0, t - 1.0)),
        "tomorrow" => Some((t + 1.0, t + 1.0)),
        "thisweek" => week(0.0),
        "lastweek" => week(-1.0),
        "nextweek" => week(1.0),
        "thismonth" => month(0),
        "lastmonth" => month(-1),
        "nextmonth" => month(1),
        "thisquarter" => quarter(0),
        "lastquarter" => quarter(-1),
        "nextquarter" => quarter(1),
        "thisyear" => Some((numfmt::serial(y, 1, 1)?, numfmt::serial(y + 1, 1, 1)? - 1.0)),
        "lastyear" => Some((numfmt::serial(y - 1, 1, 1)?, numfmt::serial(y, 1, 1)? - 1.0)),
        "nextyear" => Some((numfmt::serial(y + 1, 1, 1)?, numfmt::serial(y + 2, 1, 1)? - 1.0)),
        "yeartodate" => Some((numfmt::serial(y, 1, 1)?, t)),
        _ => None,
    }
}

fn dynamic_hit(name: &str, n: f64, today: f64) -> bool {
    let n = n.floor();
    if let Some(q) = name.strip_prefix('q').and_then(|d| d.parse::<i64>().ok()) {
        return numfmt::ymd(n).is_some_and(|(_, m, _)| (m - 1) / 3 + 1 == q);
    }
    if let Some(k) = name.strip_prefix('m').and_then(|d| d.parse::<i64>().ok()) {
        return numfmt::ymd(n).is_some_and(|(_, m, _)| m == k);
    }
    span_of(name, today).is_some_and(|(lo, hi)| n >= lo && n <= hi)
}

fn date_kept(keep: &[String], n: f64) -> bool {
    let Some((y, m, d)) = numfmt::ymd(n) else { return false };
    keep.iter().any(|k| {
        let p: Vec<i64> = k.split('-').filter_map(|x| x.parse().ok()).collect();
        match p.as_slice() {
            [a] => *a == y,
            [a, b] => *a == y && *b == m,
            [a, b, c] => *a == y && *b == m && *c == d,
            _ => false,
        }
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Filter {
    pub area: Area,
    pub cols: Vec<(u32, Crit)>,
    pub hidden: Vec<u32>,
}

pub const CONDS: [&str; 12] = ["eq", "ne", "gt", "ge", "lt", "le", "begins", "notbegins", "ends", "notends", "contains", "notcontains"];
pub const VALUE_LIMIT: usize = 10_000;

fn ranges(rows: &[u32]) -> String {
    let mut out = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        let mut j = i;
        while j + 1 < rows.len() && rows[j + 1] == rows[j] + 1 {
            j += 1;
        }
        out.push(if i == j { rows[i].to_string() } else { format!("{}-{}", rows[i], rows[j]) });
        i = j + 1;
    }
    out.join(",")
}

fn unranges(s: &str) -> Vec<u32> {
    let mut out = Vec::new();
    for part in s.split(',').filter(|p| !p.is_empty()) {
        let (a, b) = part.split_once('-').unwrap_or((part, part));
        if let (Ok(a), Ok(b)) = (a.parse::<u32>(), b.parse::<u32>()) {
            if a <= b && b < crate::MAX_ROWS {
                out.extend(a..=b);
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn push_fields(out: &mut String, fields: &[&str]) {
    for f in fields {
        out.push('\t');
        escape(f, out);
    }
}

impl Filter {
    pub fn parse(text: &str) -> Option<Filter> {
        let mut area = None;
        let mut cols = Vec::new();
        let mut hidden = Vec::new();
        for l in text.split('\n').filter(|l| !l.is_empty()) {
            let p: Vec<String> = l.split('\t').map(unescape).collect();
            match p[0].as_str() {
                "area" => {
                    let n: Vec<u32> = p.get(1)?.split(',').filter_map(|x| x.parse().ok()).collect();
                    if n.len() != 4 || n[0] > n[2] || n[1] > n[3] || n[2] >= crate::MAX_ROWS || n[3] >= crate::MAX_COLS {
                        return None;
                    }
                    area = Some(Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] });
                }
                "hidden" => hidden = unranges(p.get(1).map_or("", String::as_str)),
                "col" => {
                    let col: u32 = p.get(1)?.parse().ok()?;
                    let arg = |i: usize| p.get(i).cloned().unwrap_or_default();
                    let crit = match p.get(2)?.as_str() {
                        "values" => Crit::Values { blanks: arg(3) == "1", keep: p.iter().skip(4).cloned().collect() },
                        "cond" => {
                            let first = (arg(4), arg(5));
                            if !CONDS.contains(&first.0.as_str()) {
                                return None;
                            }
                            let second = Some((arg(6), arg(7))).filter(|s| CONDS.contains(&s.0.as_str()));
                            Crit::Cond { first, second, and: arg(3) != "or" }
                        }
                        "fill" => Crit::Fill(arg(3)),
                        "font" => Crit::Font(arg(3)),
                        "top" => Crit::Top { bottom: arg(3) == "bottom", n: arg(4).parse::<f64>().ok().filter(|x| *x >= 1.0 && *x <= 500.0)?, percent: arg(5) == "%" },
                        "avg" => Crit::Avg(arg(3) != "below"),
                        "dates" => Crit::Dates { blanks: arg(3) == "1", keep: p.iter().skip(4).cloned().collect() },
                        "dyn" => Crit::Dyn(Some(arg(3).to_lowercase()).filter(|n| DYNAMIC.contains(&n.as_str()))?),
                        "icon" => Crit::Icon(arg(3)),
                        _ => return None,
                    };
                    cols.retain(|(c, _)| *c != col);
                    cols.push((col, crit));
                }
                _ => {}
            }
        }
        let area = area?;
        cols.retain(|(c, _)| *c >= area.c0 && *c <= area.c1);
        cols.sort_by_key(|(c, _)| *c);
        hidden.retain(|r| *r > area.r0 && *r <= area.r1);
        Some(Filter { area, cols, hidden })
    }

    pub fn text(&self) -> String {
        let a = self.area;
        let mut out = format!("area\t{},{},{},{}\n", a.r0, a.c0, a.r1, a.c1);
        for (c, crit) in &self.cols {
            out.push_str(&format!("col\t{c}"));
            match crit {
                Crit::Values { keep, blanks } => {
                    push_fields(&mut out, &["values", if *blanks { "1" } else { "0" }]);
                    for k in keep {
                        push_fields(&mut out, &[k]);
                    }
                }
                Crit::Cond { first, second, and } => {
                    push_fields(&mut out, &["cond", if *and { "and" } else { "or" }, &first.0, &first.1]);
                    if let Some(s) = second {
                        push_fields(&mut out, &[&s.0, &s.1]);
                    }
                }
                Crit::Fill(p) => push_fields(&mut out, &["fill", p]),
                Crit::Font(p) => push_fields(&mut out, &["font", p]),
                Crit::Top { bottom, n, percent } => push_fields(&mut out, &["top", if *bottom { "bottom" } else { "top" }, &n.to_string(), if *percent { "%" } else { "" }]),
                Crit::Avg(above) => push_fields(&mut out, &["avg", if *above { "above" } else { "below" }]),
                Crit::Dates { keep, blanks } => {
                    push_fields(&mut out, &["dates", if *blanks { "1" } else { "0" }]);
                    for k in keep {
                        push_fields(&mut out, &[k]);
                    }
                }
                Crit::Dyn(n) => push_fields(&mut out, &["dyn", n]),
                Crit::Icon(i) => push_fields(&mut out, &["icon", i]),
            }
            out.push('\n');
        }
        out.push_str(&format!("hidden\t{}\n", ranges(&self.hidden)));
        out
    }

    pub(crate) fn shifted(self, area: Area, rows: bool, moved: &dyn Fn(u32) -> Option<u32>) -> Filter {
        if rows {
            let hidden = self.hidden.iter().filter_map(|r| moved(*r)).collect();
            Filter { area, hidden, ..self }
        } else {
            let cols: Vec<(u32, Crit)> = self.cols.into_iter().filter_map(|(c, k)| moved(c).map(|c| (c, k))).collect();
            let hidden = if cols.is_empty() { Vec::new() } else { self.hidden };
            Filter { area, cols, hidden }
        }
    }
}

fn number_of(s: &str) -> Option<f64> {
    match Value::parse_input(s.trim()) {
        Value::Number(n) => Some(n),
        _ => None,
    }
}

fn cond(op: &str, want: &str, v: &Value, shown: &str) -> bool {
    let blank = matches!(v, Value::Empty) || shown.is_empty();
    let low = shown.to_lowercase();
    let wl = want.to_lowercase();
    let ord = || -> Option<std::cmp::Ordering> {
        if blank {
            return None;
        }
        match (v, number_of(want)) {
            (Value::Number(n), Some(w)) => n.partial_cmp(&w),
            (Value::Number(_), None) | (_, Some(_)) => None,
            _ => Some(low.as_str().cmp(wl.as_str())),
        }
    };
    let equal = || {
        if want.is_empty() {
            return blank;
        }
        match (v, number_of(want)) {
            (Value::Number(n), Some(w)) if !want.contains(['*', '?']) => (n - w).abs() <= 1e-9 * w.abs().max(1.0),
            _ => eval::wild_match(want, shown),
        }
    };
    use std::cmp::Ordering::*;
    match op {
        "eq" => equal(),
        "ne" => !equal(),
        "gt" => ord() == Some(Greater),
        "ge" => matches!(ord(), Some(Greater | Equal)),
        "lt" => ord() == Some(Less),
        "le" => matches!(ord(), Some(Less | Equal)),
        "begins" => eval::wild_match(&format!("{want}*"), shown),
        "notbegins" => !eval::wild_match(&format!("{want}*"), shown),
        "ends" => eval::wild_match(&format!("*{want}"), shown),
        "notends" => !eval::wild_match(&format!("*{want}"), shown),
        "contains" => eval::wild_match(&format!("*{want}*"), shown),
        "notcontains" => !eval::wild_match(&format!("*{want}*"), shown),
        _ => true,
    }
}

impl Workbook {
    pub fn filter(&self, sheet: usize) -> Option<Filter> {
        self.sheets.get(sheet).and_then(|s| s.filter.clone())
    }

    pub fn filter_text(&self, sheet: usize) -> String {
        self.filter(sheet).map(|f| f.text()).unwrap_or_default()
    }

    pub fn load_filter(&mut self, sheet: usize, text: &str) -> Result<bool, EngineError> {
        let s = self.sheets.get_mut(sheet).ok_or(EngineError::NoSheet(sheet))?;
        s.filter = Filter::parse(text);
        Ok(s.filter.is_some())
    }

    pub fn set_filter(&mut self, sheet: usize, text: &str) -> Result<Effect, EngineError> {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        let after = if text.trim().is_empty() {
            None
        } else {
            let mut f = Filter::parse(text).ok_or_else(|| EngineError::BadStyle(text.to_string()))?;
            f.hidden = self.hidden_by(sheet, &f, None);
            Some(f)
        };
        self.put_filter(sheet, after)
    }

    pub fn reapply_filter(&mut self, sheet: usize) -> Result<Effect, EngineError> {
        let Some(mut f) = self.filter(sheet) else { return Ok(Effect::default()) };
        let reach = self.region(sheet, Addr { row: f.area.r0, col: f.area.c0 })?;
        f.area.r1 = f.area.r1.max(reach.r1);
        f.hidden = self.hidden_by(sheet, &f, None);
        self.put_filter(sheet, Some(f))
    }

    fn put_filter(&mut self, sheet: usize, after: Option<Filter>) -> Result<Effect, EngineError> {
        let before = std::mem::replace(&mut self.sheets[sheet].filter, after.clone());
        if before != after {
            self.record(Tx::Filter { sheet, before, after });
        }
        Ok(Effect { filter: Some(sheet), ..Effect::default() })
    }

    fn cell_text(&self, sheet: usize, a: Addr) -> (Value, String) {
        let v = self.sheets[sheet].cells.get(a).cloned().unwrap_or(Value::Empty);
        let shown = self.shown(sheet, a, v.clone()).to_string();
        (v, shown)
    }

    fn paints(&self, sheet: usize, area: Area, col: u32) -> std::collections::HashMap<u32, (String, String)> {
        let cf: std::collections::HashMap<u32, crate::cf::Paint> = self.cf_in(sheet, Addr { row: area.r0, col }, Addr { row: area.r1, col }).into_iter().map(|(a, p)| (a.row, p)).collect();
        let mut out = std::collections::HashMap::new();
        for r in area.r0 + 1..=area.r1 {
            let mut st = self.effective_style(sheet, Addr { row: r, col });
            if let Some(s) = cf.get(&r).and_then(|p| p.style.as_ref()) {
                st = st.overlay(s);
            }
            let fill = st.fill.map(|p| p.text()).unwrap_or_else(|| "none".into());
            let font = st.color.map(|p| p.text()).unwrap_or_else(|| "auto".into());
            out.insert(r, (fill, font));
        }
        out
    }

    fn passes(&self, sheet: usize, area: Area, col: u32, crit: &Crit) -> Vec<bool> {
        let rows: Vec<u32> = (area.r0 + 1..=area.r1).collect();
        let texts: Vec<(Value, String)> = rows.iter().map(|&r| self.cell_text(sheet, Addr { row: r, col })).collect();
        match crit {
            Crit::Values { keep, blanks } => {
                let keep: std::collections::HashSet<String> = keep.iter().map(|k| k.to_lowercase()).collect();
                texts.iter().map(|(v, s)| if matches!(v, Value::Empty) || s.is_empty() { *blanks } else { keep.contains(&s.to_lowercase()) }).collect()
            }
            Crit::Cond { first, second, and } => texts
                .iter()
                .map(|(v, s)| {
                    let a = cond(&first.0, &first.1, v, s);
                    match second {
                        Some(b) if *and => a && cond(&b.0, &b.1, v, s),
                        Some(b) => a || cond(&b.0, &b.1, v, s),
                        None => a,
                    }
                })
                .collect(),
            Crit::Fill(want) | Crit::Font(want) => {
                let fill = matches!(crit, Crit::Fill(_));
                let p = self.paints(sheet, area, col);
                rows.iter().map(|r| p.get(r).is_some_and(|(f, t)| if fill { f == want } else { t == want })).collect()
            }
            Crit::Top { bottom, n, percent } => {
                let mut nums: Vec<f64> = texts.iter().filter_map(|(v, _)| if let Value::Number(x) = v { Some(*x) } else { None }).collect();
                if nums.is_empty() {
                    return vec![false; rows.len()];
                }
                nums.sort_by(|a, b| if *bottom { a.total_cmp(b) } else { b.total_cmp(a) });
                let count = if *percent { ((nums.len() as f64) * n / 100.0).ceil() as usize } else { *n as usize };
                let cut = nums[count.clamp(1, nums.len()) - 1];
                texts.iter().map(|(v, _)| matches!(v, Value::Number(x) if if *bottom { *x <= cut } else { *x >= cut })).collect()
            }
            Crit::Dates { keep, blanks } => texts
                .iter()
                .map(|(v, s)| match v {
                    Value::Number(n) => date_kept(keep, *n),
                    _ if matches!(v, Value::Empty) || s.is_empty() => *blanks,
                    _ => false,
                })
                .collect(),
            Crit::Dyn(name) => {
                let today = numfmt::now().floor();
                texts.iter().map(|(v, _)| matches!(v, Value::Number(n) if dynamic_hit(name, *n, today))).collect()
            }
            Crit::Icon(want) => {
                let cf: std::collections::HashMap<u32, crate::cf::Paint> = self.cf_in(sheet, Addr { row: area.r0 + 1, col }, Addr { row: area.r1, col }).into_iter().map(|(a, p)| (a.row, p)).collect();
                rows.iter().map(|r| cf.get(r).and_then(|p| p.icon.as_ref()).map_or_else(|| want == "none", |(set, i)| format!("{set}:{i}") == *want)).collect()
            }
            Crit::Avg(above) => {
                let nums: Vec<f64> = texts.iter().filter_map(|(v, _)| if let Value::Number(x) = v { Some(*x) } else { None }).collect();
                let mean = nums.iter().sum::<f64>() / nums.len().max(1) as f64;
                texts.iter().map(|(v, _)| matches!(v, Value::Number(x) if if *above { *x > mean } else { *x < mean })).collect()
            }
        }
    }

    fn shown_rows(&self, sheet: usize, f: &Filter, skip: Option<u32>) -> Vec<bool> {
        let mut keep = vec![true; (f.area.r1 - f.area.r0) as usize];
        for (c, crit) in &f.cols {
            if Some(*c) == skip {
                continue;
            }
            for (k, ok) in keep.iter_mut().zip(self.passes(sheet, f.area, *c, crit)) {
                *k &= ok;
            }
        }
        keep
    }

    fn hidden_by(&self, sheet: usize, f: &Filter, skip: Option<u32>) -> Vec<u32> {
        self.shown_rows(sheet, f, skip).iter().enumerate().filter(|(_, k)| !**k).map(|(i, _)| f.area.r0 + 1 + i as u32).collect()
    }

    pub fn filter_values(&self, sheet: usize, col: u32) -> (Vec<String>, bool, bool) {
        let Some(f) = self.filter(sheet) else { return (Vec::new(), false, false) };
        let keep = self.shown_rows(sheet, &f, Some(col));
        let mut seen = std::collections::HashSet::new();
        let mut items: Vec<(Value, String)> = Vec::new();
        let mut blanks = false;
        let mut more = false;
        for (i, k) in keep.iter().enumerate() {
            if !k {
                continue;
            }
            let (v, s) = self.cell_text(sheet, Addr { row: f.area.r0 + 1 + i as u32, col });
            if matches!(v, Value::Empty) || s.is_empty() {
                blanks = true;
                continue;
            }
            if seen.insert(s.to_lowercase()) {
                if items.len() == VALUE_LIMIT {
                    more = true;
                    continue;
                }
                items.push((v, s));
            }
        }
        items.sort_by(|a, b| crate::sort::order(&a.0, &b.0, false, false).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
        (items.into_iter().map(|(_, s)| s).collect(), blanks, more)
    }

    pub fn filter_dates(&self, sheet: usize, col: u32) -> (Vec<(i64, i64, i64)>, bool) {
        let Some(f) = self.filter(sheet) else { return (Vec::new(), false) };
        let keep = self.shown_rows(sheet, &f, Some(col));
        let mut days = std::collections::BTreeSet::new();
        let mut blanks = false;
        for (i, k) in keep.iter().enumerate() {
            if !k {
                continue;
            }
            let a = Addr { row: f.area.r0 + 1 + i as u32, col };
            let (v, s) = self.cell_text(sheet, a);
            match v {
                Value::Number(n) if self.fmt(sheet, a).is_some_and(|f| f.is_date()) => match numfmt::ymd(n) {
                    Some(d) => {
                        days.insert(d);
                    }
                    None => return (Vec::new(), false),
                },
                Value::Empty => blanks = true,
                _ if s.is_empty() => blanks = true,
                _ => return (Vec::new(), false),
            }
        }
        (days.into_iter().collect(), blanks)
    }

    pub fn filter_icons(&self, sheet: usize, col: u32) -> Vec<String> {
        let Some(f) = self.filter(sheet) else { return Vec::new() };
        let keep = self.shown_rows(sheet, &f, Some(col));
        let cf: std::collections::HashMap<u32, crate::cf::Paint> = self.cf_in(sheet, Addr { row: f.area.r0 + 1, col }, Addr { row: f.area.r1, col }).into_iter().map(|(a, p)| (a.row, p)).collect();
        let mut out: Vec<String> = Vec::new();
        for (i, k) in keep.iter().enumerate() {
            if let (true, Some((set, n))) = (*k, cf.get(&(f.area.r0 + 1 + i as u32)).and_then(|p| p.icon.as_ref())) {
                let id = format!("{set}:{n}");
                if !out.contains(&id) {
                    out.push(id);
                }
            }
        }
        out
    }

    pub fn filter_colors(&self, sheet: usize, col: u32) -> (Vec<String>, Vec<String>) {
        let Some(f) = self.filter(sheet) else { return (Vec::new(), Vec::new()) };
        let keep = self.shown_rows(sheet, &f, Some(col));
        let p = self.paints(sheet, f.area, col);
        let (mut fills, mut fonts) = (Vec::new(), Vec::new());
        for (i, k) in keep.iter().enumerate() {
            if let (true, Some((fill, font))) = (*k, p.get(&(f.area.r0 + 1 + i as u32))) {
                if !fills.contains(fill) {
                    fills.push(fill.clone());
                }
                if !fonts.contains(font) {
                    fonts.push(font.clone());
                }
            }
        }
        (fills, fonts)
    }
}
