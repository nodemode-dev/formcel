use crate::formula::{self, Area, Expr};
use crate::style::Style;
use crate::{eval, numfmt, Addr, EngineError, Value, Workbook};

#[derive(Clone, Debug, PartialEq)]
pub enum Point {
    Low,
    High,
    Num(f64),
    Pct(f64),
    Pctl(f64),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Cell { op: String, a: String, b: String },
    Text { mode: String, text: String },
    Date(String),
    Dup(bool),
    Top { bottom: bool, n: f64, percent: bool },
    Avg(bool),
    Blank(String),
    Formula(String),
    Scale { points: Vec<Point>, colors: Vec<u32> },
    Bar { color: u32, min: Point, max: Point },
    Icons { set: String, cuts: Vec<f64>, reverse: bool },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub area: Area,
    pub stop: bool,
    pub kind: Kind,
    pub style: String,
}

pub const ICON_SETS: [(&str, usize); 6] = [("3arrows", 3), ("3traffic", 3), ("3flags", 3), ("3symbols", 3), ("4arrows", 4), ("5arrows", 5)];
const DATES: [&str; 10] = ["yesterday", "today", "tomorrow", "last7", "lastweek", "thisweek", "nextweek", "lastmonth", "thismonth", "nextmonth"];
const OPS: [&str; 8] = ["gt", "lt", "ge", "le", "eq", "ne", "between", "notbetween"];

fn point(s: &str) -> Option<Point> {
    let (k, v) = s.split_once(':').unwrap_or((s, ""));
    let n = || v.parse::<f64>().ok().filter(|x| x.is_finite());
    Some(match k {
        "low" => Point::Low,
        "high" => Point::High,
        "num" => Point::Num(n()?),
        "pct" => Point::Pct(n()?.clamp(0.0, 100.0)),
        "pctl" => Point::Pctl(n()?.clamp(0.0, 100.0)),
        _ => return None,
    })
}

fn point_text(p: &Point) -> String {
    match p {
        Point::Low => "low".into(),
        Point::High => "high".into(),
        Point::Num(n) => format!("num:{n}"),
        Point::Pct(n) => format!("pct:{n}"),
        Point::Pctl(n) => format!("pctl:{n}"),
    }
}

fn hex(s: &str) -> Option<u32> {
    let s = s.trim().trim_start_matches('#');
    (s.len() == 6).then(|| u32::from_str_radix(s, 16).ok()).flatten()
}

impl Rule {
    pub fn parse(line: &str) -> Option<Rule> {
        let p: Vec<&str> = line.split('\t').collect();
        let n: Vec<u32> = p.first()?.split(',').filter_map(|x| x.parse().ok()).collect();
        if n.len() != 4 || n[0] > n[2] || n[1] > n[3] || n[2] >= crate::MAX_ROWS || n[3] >= crate::MAX_COLS {
            return None;
        }
        let area = Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] };
        let stop = *p.get(1)? == "1";
        let arg = |i: usize| crate::wire::unescape(p.get(i).copied().unwrap_or(""));
        let kind = match *p.get(2)? {
            "cell" => {
                let op = arg(3);
                if !OPS.contains(&op.as_str()) {
                    return None;
                }
                Kind::Cell { op, a: arg(4), b: arg(5) }
            }
            "text" => {
                let mode = arg(3);
                if !["contains", "notcontains", "begins", "ends"].contains(&mode.as_str()) {
                    return None;
                }
                Kind::Text { mode, text: arg(4) }
            }
            "date" => Some(arg(3)).filter(|d| DATES.contains(&d.as_str())).map(Kind::Date)?,
            "dup" => Kind::Dup(arg(3) != "unique"),
            "top" => Kind::Top { bottom: arg(3) == "bottom", n: arg(4).parse::<f64>().ok().filter(|x| *x >= 1.0 && *x <= 1000.0)?, percent: arg(5) == "%" },
            "avg" => Kind::Avg(arg(3) != "below"),
            "blank" => Some(arg(3)).filter(|b| ["blank", "noblank", "error", "noerror"].contains(&b.as_str())).map(Kind::Blank)?,
            "formula" => {
                let f = arg(3);
                formula::parse(f.trim_start_matches('='))?;
                Kind::Formula(f)
            }
            "scale" => {
                let points: Vec<Point> = arg(3).split(',').filter_map(point).collect();
                let colors: Vec<u32> = arg(4).split(',').filter_map(hex).collect();
                if !(2..=3).contains(&points.len()) || colors.len() != points.len() {
                    return None;
                }
                Kind::Scale { points, colors }
            }
            "bar" => Kind::Bar { color: hex(&arg(3))?, min: point(&arg(4)).unwrap_or(Point::Low), max: point(&arg(5)).unwrap_or(Point::High) },
            "icons" => {
                let set = arg(3);
                let count = ICON_SETS.iter().find(|s| s.0 == set)?.1;
                let mut cuts: Vec<f64> = arg(4).split(',').filter_map(|x| x.parse().ok()).collect();
                if cuts.len() != count - 1 {
                    cuts = (1..count).map(|i| (100 * i / count) as f64).collect();
                }
                Kind::Icons { set, cuts, reverse: arg(5) == "rev" }
            }
            _ => return None,
        };
        let style = arg(6);
        if !style.is_empty() {
            Style::parse(&style)?;
        }
        Some(Rule { area, stop, kind, style })
    }

    pub fn line(&self) -> String {
        let a = self.area;
        let (k, x, y, z) = match &self.kind {
            Kind::Cell { op, a, b } => ("cell", op.clone(), a.clone(), b.clone()),
            Kind::Text { mode, text } => ("text", mode.clone(), text.clone(), String::new()),
            Kind::Date(d) => ("date", d.clone(), String::new(), String::new()),
            Kind::Dup(d) => ("dup", if *d { "dup" } else { "unique" }.into(), String::new(), String::new()),
            Kind::Top { bottom, n, percent } => ("top", if *bottom { "bottom" } else { "top" }.into(), n.to_string(), if *percent { "%" } else { "" }.into()),
            Kind::Avg(above) => ("avg", if *above { "above" } else { "below" }.into(), String::new(), String::new()),
            Kind::Blank(b) => ("blank", b.clone(), String::new(), String::new()),
            Kind::Formula(f) => ("formula", f.clone(), String::new(), String::new()),
            Kind::Scale { points, colors } => ("scale", points.iter().map(point_text).collect::<Vec<_>>().join(","), colors.iter().map(|c| format!("{c:06x}")).collect::<Vec<_>>().join(","), String::new()),
            Kind::Bar { color, min, max } => ("bar", format!("{color:06x}"), point_text(min), point_text(max)),
            Kind::Icons { set, cuts, reverse } => ("icons", set.clone(), cuts.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(","), if *reverse { "rev" } else { "" }.into()),
        };
        let mut out = format!("{},{},{},{}\t{}\t{k}\t", a.r0, a.c0, a.r1, a.c1, u8::from(self.stop));
        for (i, s) in [x, y, z, self.style.clone()].iter().enumerate() {
            if i > 0 {
                out.push('\t');
            }
            crate::wire::escape(s, &mut out);
        }
        out
    }
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => Some(*n),
        _ => None,
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = p / 100.0 * (sorted.len() - 1) as f64;
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo as f64)
}

fn resolve(p: &Point, sorted: &[f64]) -> f64 {
    let (lo, hi) = (sorted.first().copied().unwrap_or(0.0), sorted.last().copied().unwrap_or(0.0));
    match p {
        Point::Low => lo,
        Point::High => hi,
        Point::Num(n) => *n,
        Point::Pct(n) => lo + (hi - lo) * n / 100.0,
        Point::Pctl(n) => percentile(sorted, *n),
    }
}

fn mix(a: u32, b: u32, t: f64) -> u32 {
    let ch = |c: u32, s: u32| ((c >> s) & 255) as f64;
    let m = |s: u32| ((ch(a, s) + (ch(b, s) - ch(a, s)) * t.clamp(0.0, 1.0)).round() as u32) << s;
    m(16) | m(8) | m(0)
}

fn week_start(d: f64) -> f64 {
    d - ((d as i64 + 6) % 7) as f64
}

fn month_of(d: f64) -> (i64, i64) {
    numfmt::ymd(d).map(|(y, m, _)| (y, m)).unwrap_or((0, 0))
}

fn in_period(d: f64, p: &str, today: f64) -> bool {
    let d = d.floor();
    let (ty, tm) = month_of(today);
    let shift = |k: i64| {
        let n = ty * 12 + tm - 1 + k;
        (n.div_euclid(12), n.rem_euclid(12) + 1)
    };
    match p {
        "yesterday" => d == today - 1.0,
        "today" => d == today,
        "tomorrow" => d == today + 1.0,
        "last7" => d <= today && d > today - 7.0,
        "lastweek" => week_start(d) == week_start(today) - 7.0,
        "thisweek" => week_start(d) == week_start(today),
        "nextweek" => week_start(d) == week_start(today) + 7.0,
        "lastmonth" => month_of(d) == shift(-1),
        "thismonth" => month_of(d) == (ty, tm),
        "nextmonth" => month_of(d) == shift(1),
        _ => false,
    }
}

#[derive(Default, Clone, Debug)]
pub struct Paint {
    pub style: Option<Style>,
    pub bar: Option<(f64, f64, u32)>,
    pub icon: Option<(String, usize)>,
}

impl Workbook {
    pub fn rules(&self, sheet: usize) -> Vec<Rule> {
        self.sheets.get(sheet).map(|s| s.rules.clone()).unwrap_or_default()
    }

    pub fn rule_lines(&self, sheet: usize) -> Vec<String> {
        self.rules(sheet).iter().map(Rule::line).collect()
    }

    pub fn load_rules(&mut self, sheet: usize, lines: &[String]) -> Result<usize, EngineError> {
        let s = self.sheets.get_mut(sheet).ok_or(EngineError::NoSheet(sheet))?;
        s.rules = lines.iter().filter_map(|l| Rule::parse(l)).collect();
        Ok(s.rules.len())
    }

    pub fn set_rules(&mut self, sheet: usize, lines: &[String]) -> Result<crate::Effect, EngineError> {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        let mut after = Vec::with_capacity(lines.len());
        for l in lines {
            after.push(Rule::parse(l).ok_or_else(|| EngineError::BadStyle(l.clone()))?);
        }
        let before = std::mem::replace(&mut self.sheets[sheet].rules, after.clone());
        if before != after {
            self.record(crate::Tx::Rules { sheet, before, after });
        }
        Ok(crate::Effect { rules: Some(sheet), ..crate::Effect::default() })
    }

    fn area_values(&self, sheet: usize, a: Area) -> Vec<(Addr, Value)> {
        let mut out = Vec::new();
        self.sheets[sheet].cells.for_each_in(Addr { row: a.r0, col: a.c0 }, Addr { row: a.r1, col: a.c1 }, |at, v| out.push((at, v.clone())));
        out
    }

    fn cell_value(&self, sheet: usize, a: Addr) -> Value {
        self.sheets[sheet].cells.get(a).cloned().unwrap_or(Value::Empty)
    }

    fn eval_text(&self, sheet: usize, src: &str, dr: i64, dc: i64) -> Value {
        let body = src.trim_start().strip_prefix('=').unwrap_or(src);
        let Some(mut e): Option<Expr> = formula::parse(body) else { return Value::Empty };
        if dr != 0 || dc != 0 {
            formula::offset(&mut e, dr, dc);
        }
        eval::Eval::new(self, sheet).scalar(&e)
    }

    fn operand(&self, sheet: usize, s: &str, dr: i64, dc: i64) -> Value {
        if s.trim_start().starts_with('=') {
            self.eval_text(sheet, s, dr, dc)
        } else {
            Value::parse_input(s)
        }
    }

    pub fn cf_in(&self, sheet: usize, top: Addr, bottom: Addr) -> Vec<(Addr, Paint)> {
        let Some(sh) = self.sheets.get(sheet) else { return Vec::new() };
        if sh.rules.is_empty() {
            return Vec::new();
        }
        let today = numfmt::now().floor();
        let mut out: std::collections::BTreeMap<(u32, u32), (Paint, bool)> = std::collections::BTreeMap::new();
        for rule in &sh.rules {
            let a = rule.area;
            let view = Area { r0: a.r0.max(top.row), c0: a.c0.max(top.col), r1: a.r1.min(bottom.row), c1: a.c1.min(bottom.col) };
            if view.r0 > view.r1 || view.c0 > view.c1 {
                continue;
            }
            let needs_all = matches!(rule.kind, Kind::Dup(_) | Kind::Top { .. } | Kind::Avg(_) | Kind::Scale { .. } | Kind::Bar { .. } | Kind::Icons { .. });
            let all = if needs_all { self.area_values(sheet, a) } else { Vec::new() };
            let mut sorted: Vec<f64> = all.iter().filter_map(|(_, v)| num(v)).collect();
            sorted.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
            let mean = if sorted.is_empty() { 0.0 } else { sorted.iter().sum::<f64>() / sorted.len() as f64 };
            let counts: std::collections::HashMap<String, usize> = if matches!(rule.kind, Kind::Dup(_)) {
                let mut m = std::collections::HashMap::new();
                for (_, v) in &all {
                    if !matches!(v, Value::Empty) {
                        *m.entry(v.to_string().to_lowercase()).or_insert(0) += 1;
                    }
                }
                m
            } else {
                std::collections::HashMap::new()
            };
            let cutoff = if let Kind::Top { bottom, n, percent } = &rule.kind {
                let k = if *percent { ((sorted.len() as f64) * n / 100.0).floor().max(1.0) as usize } else { *n as usize };
                let k = k.min(sorted.len());
                if k == 0 {
                    None
                } else if *bottom {
                    Some(sorted[k - 1])
                } else {
                    Some(sorted[sorted.len() - k])
                }
            } else {
                None
            };
            let style = (!rule.style.is_empty()).then(|| Style::parse(&rule.style)).flatten();
            for r in view.r0..=view.r1 {
                for c in view.c0..=view.c1 {
                    let at = Addr { row: r, col: c };
                    let slot = out.entry((r, c)).or_insert((Paint::default(), false));
                    if slot.1 {
                        continue;
                    }
                    let v = self.cell_value(sheet, at);
                    if matches!(v, Value::Error(_)) && !matches!(rule.kind, Kind::Blank(_) | Kind::Formula(_)) {
                        continue;
                    }
                    let (dr, dc) = (i64::from(r) - i64::from(a.r0), i64::from(c) - i64::from(a.c0));
                    let hit = match &rule.kind {
                        Kind::Cell { op, a: x, b: y } => {
                            if matches!(v, Value::Empty) {
                                false
                            } else {
                                let x = self.operand(sheet, x, dr, dc);
                                let y = self.operand(sheet, y, dr, dc);
                                let cmp = |p: &Value, q: &Value| eval::compare(p, q);
                                match op.as_str() {
                                    "gt" => cmp(&v, &x).is_gt(),
                                    "lt" => cmp(&v, &x).is_lt(),
                                    "ge" => cmp(&v, &x).is_ge(),
                                    "le" => cmp(&v, &x).is_le(),
                                    "eq" => cmp(&v, &x).is_eq(),
                                    "ne" => !cmp(&v, &x).is_eq(),
                                    "between" | "notbetween" => {
                                        let (lo, hi) = if cmp(&x, &y).is_gt() { (&y, &x) } else { (&x, &y) };
                                        let inside = cmp(&v, lo).is_ge() && cmp(&v, hi).is_le();
                                        inside == (op == "between")
                                    }
                                    _ => false,
                                }
                            }
                        }
                        Kind::Text { mode, text } => {
                            let t = v.to_string().to_lowercase();
                            let p = text.to_lowercase();
                            match mode.as_str() {
                                "contains" => eval::wild_match(&format!("*{p}*"), &t),
                                "notcontains" => !eval::wild_match(&format!("*{p}*"), &t),
                                "begins" => eval::wild_match(&format!("{p}*"), &t),
                                _ => eval::wild_match(&format!("*{p}"), &t),
                            }
                        }
                        Kind::Date(p) => num(&v).is_some_and(|d| in_period(d, p, today)),
                        Kind::Dup(dup) => !matches!(v, Value::Empty) && (counts.get(&v.to_string().to_lowercase()).copied().unwrap_or(0) > 1) == *dup,
                        Kind::Top { bottom, .. } => match (num(&v), cutoff) {
                            (Some(n), Some(k)) => if *bottom { n <= k } else { n >= k },
                            _ => false,
                        },
                        Kind::Avg(above) => num(&v).is_some_and(|n| if *above { n > mean } else { n < mean }),
                        Kind::Blank(b) => match b.as_str() {
                            "blank" => matches!(v, Value::Empty) || v.to_string().trim().is_empty(),
                            "noblank" => !(matches!(v, Value::Empty) || v.to_string().trim().is_empty()),
                            "error" => matches!(v, Value::Error(_)),
                            _ => !matches!(v, Value::Error(_)),
                        },
                        Kind::Formula(f) => matches!(self.eval_text(sheet, f, dr, dc), Value::Bool(true)) || num(&self.eval_text(sheet, f, dr, dc)).is_some_and(|n| n != 0.0),
                        Kind::Scale { points, colors } => {
                            if let Some(n) = num(&v) {
                                let pts: Vec<f64> = points.iter().map(|p| resolve(p, &sorted)).collect();
                                let color = if pts.len() == 2 || n <= pts[1] {
                                    let span = pts[1] - pts[0];
                                    mix(colors[0], colors[1], if span == 0.0 { 1.0 } else { (n - pts[0]) / span })
                                } else {
                                    let span = pts[2] - pts[1];
                                    mix(colors[1], colors[2], if span == 0.0 { 1.0 } else { (n - pts[1]) / span })
                                };
                                let mut st = slot.0.style.clone().unwrap_or_default();
                                if st.fill.is_none() {
                                    st.fill = Some(crate::style::Paint::Rgb(color));
                                }
                                slot.0.style = Some(st);
                                true
                            } else {
                                false
                            }
                        }
                        Kind::Bar { color, min, max } => {
                            if let Some(n) = num(&v) {
                                let (lo, hi) = (resolve(min, &sorted), resolve(max, &sorted));
                                let (from, to) = if lo < 0.0 {
                                    let axis = -lo / (hi - lo).max(f64::MIN_POSITIVE);
                                    let pos = (n - lo) / (hi - lo).max(f64::MIN_POSITIVE);
                                    (axis.min(pos).clamp(0.0, 1.0), axis.max(pos).clamp(0.0, 1.0))
                                } else {
                                    (0.0, ((n - lo) / (hi - lo).max(f64::MIN_POSITIVE)).clamp(0.05, 1.0))
                                };
                                if slot.0.bar.is_none() {
                                    slot.0.bar = Some((from, to, *color));
                                }
                                true
                            } else {
                                false
                            }
                        }
                        Kind::Icons { set, cuts, reverse } => {
                            if let Some(n) = num(&v) {
                                let (lo, hi) = (sorted.first().copied().unwrap_or(0.0), sorted.last().copied().unwrap_or(0.0));
                                let pct = if hi > lo { (n - lo) / (hi - lo) * 100.0 } else { 100.0 };
                                let mut i = cuts.iter().filter(|c| pct >= **c).count();
                                if *reverse {
                                    i = cuts.len() - i;
                                }
                                if slot.0.icon.is_none() {
                                    slot.0.icon = Some((set.clone(), i));
                                }
                                true
                            } else {
                                false
                            }
                        }
                    };
                    if !hit {
                        continue;
                    }
                    if let Some(s) = &style {
                        let base = slot.0.style.clone().unwrap_or_default();
                        slot.0.style = Some(s.overlay(&base));
                    }
                    if rule.stop {
                        slot.1 = true;
                    }
                }
            }
        }
        out.into_iter().filter(|(_, (p, _))| p.style.is_some() || p.bar.is_some() || p.icon.is_some()).map(|((r, c), (p, _))| (Addr { row: r, col: c }, p)).collect()
    }
}
