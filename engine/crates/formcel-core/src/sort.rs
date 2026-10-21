use crate::formula::{offset_text, Area};
use crate::{eval, Addr, Effect, EngineError, Tx, Value, Workbook};
use std::cmp::Ordering;

#[derive(Clone, Debug, Default, PartialEq)]
pub enum SortBy {
    #[default]
    Value,
    List(Vec<String>),
    Fill(String),
    Font(String),
    Icon(String),
}

#[derive(Clone, Debug)]
pub struct SortKey {
    pub col: u32,
    pub descending: bool,
    pub by: SortBy,
}

impl SortKey {
    pub fn value(col: u32, descending: bool) -> SortKey {
        SortKey { col, descending, by: SortBy::Value }
    }

    pub fn parse(item: &str) -> Option<SortKey> {
        let mut p = item.splitn(4, ':');
        let col = p.next()?.parse().ok()?;
        let descending = p.next()? == "d";
        let kind = p.next().unwrap_or("v");
        let arg = crate::wire::unescape(p.next().unwrap_or(""));
        let by = match kind {
            "v" => SortBy::Value,
            "list" => SortBy::List(arg.split('\u{1f}').map(String::from).filter(|s| !s.is_empty()).collect()),
            "fill" => SortBy::Fill(arg),
            "font" => SortBy::Font(arg),
            "icon" => SortBy::Icon(arg),
            _ => return None,
        };
        Some(SortKey { col, descending, by })
    }
}

const DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

pub fn builtin_lists() -> Vec<Vec<String>> {
    let short = |full: &[&str]| full.iter().map(|d| d[..3].to_string()).collect::<Vec<_>>();
    vec![short(&DAYS), DAYS.iter().map(|d| d.to_string()).collect(), short(&MONTHS), MONTHS.iter().map(|d| d.to_string()).collect()]
}

enum Prep {
    Plain(Vec<Value>),
    Listed(Vec<Option<usize>>, Vec<Value>),
    Hit(Vec<bool>),
}

fn rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Bool(_) => 2,
        Value::Error(_) => 3,
        Value::Empty => 4,
    }
}

pub(crate) fn order(a: &Value, b: &Value, descending: bool, case: bool) -> Ordering {
    let (ra, rb) = (rank(a), rank(b));
    if ra == 4 || rb == 4 {
        return ra.cmp(&rb);
    }
    let o = if ra != rb {
        ra.cmp(&rb)
    } else {
        match (a, b) {
            (Value::Text(x), Value::Text(y)) => {
                let o = x.to_lowercase().cmp(&y.to_lowercase());
                if o == Ordering::Equal && case {
                    let lower = |s: &str| s.chars().map(|c| !c.is_lowercase()).collect::<Vec<bool>>();
                    lower(x).cmp(&lower(y))
                } else {
                    o
                }
            }
            (Value::Error(_), Value::Error(_)) => Ordering::Equal,
            _ => eval::compare(a, b),
        }
    };
    if descending {
        o.reverse()
    } else {
        o
    }
}

impl Workbook {
    pub fn region(&self, sheet: usize, at: Addr) -> Result<Area, EngineError> {
        self.check(sheet, at)?;
        let filled = |r: u32, c: u32| !matches!(self.sheets[sheet].cells.get(Addr { row: r, col: c }), None | Some(Value::Empty));
        let mut a = Area { r0: at.row, c0: at.col, r1: at.row, c1: at.col };
        loop {
            let mut grew = false;
            let (r0, r1) = (a.r0.saturating_sub(1), (a.r1 + 1).min(crate::MAX_ROWS - 1));
            let (c0, c1) = (a.c0.saturating_sub(1), (a.c1 + 1).min(crate::MAX_COLS - 1));
            if a.r0 > 0 && (c0..=c1).any(|c| filled(a.r0 - 1, c)) {
                a.r0 -= 1;
                grew = true;
            }
            if a.r1 + 1 < crate::MAX_ROWS && (c0..=c1).any(|c| filled(a.r1 + 1, c)) {
                a.r1 += 1;
                grew = true;
            }
            if a.c0 > 0 && (r0..=r1).any(|r| filled(r, a.c0 - 1)) {
                a.c0 -= 1;
                grew = true;
            }
            if a.c1 + 1 < crate::MAX_COLS && (r0..=r1).any(|r| filled(r, a.c1 + 1)) {
                a.c1 += 1;
                grew = true;
            }
            if !grew {
                return Ok(a);
            }
        }
    }

    pub fn guess_header(&self, sheet: usize, area: Area) -> bool {
        if sheet >= self.sheets.len() || area.r1 <= area.r0 {
            return false;
        }
        let cells = &self.sheets[sheet].cells;
        let text = |r: u32, c: u32| matches!(cells.get(Addr { row: r, col: c }), Some(Value::Text(_)));
        let c1 = area.c1.min(area.c0 + 255);
        let blank = |r: u32, c: u32| matches!(cells.get(Addr { row: r, col: c }), None | Some(Value::Empty));
        if !(area.c0..=c1).all(|c| text(area.r0, c) || blank(area.r0, c)) || (area.c0..=c1).all(|c| blank(area.r0, c)) {
            return false;
        }
        let r1 = area.r1.min(area.r0 + 200);
        let typed_below = (area.c0..=c1).any(|c| (area.r0 + 1..=r1).any(|r| !text(r, c) && !matches!(cells.get(Addr { row: r, col: c }), None | Some(Value::Empty))));
        let bold = |r: u32| self.styles.get(&(sheet, Addr { row: r, col: area.c0 })).is_some_and(|s| s.1.bold == Some(true));
        typed_below || (bold(area.r0) && !bold(area.r0 + 1))
    }

    pub fn sort(&mut self, sheet: usize, area: Area, keys: &[SortKey], header: bool, case: bool) -> Result<Effect, EngineError> {
        self.sort_with(sheet, area, keys, header, case, false)
    }

    fn prep_key(&self, sheet: usize, area: Area, first: u32, across: bool, k: &SortKey) -> Prep {
        let at = |line: u32| if across { Addr { row: k.col, col: line } } else { Addr { row: line, col: k.col } };
        let last = if across { area.c1 } else { area.r1 };
        let values: Vec<Value> = (first..=last).map(|l| self.sheets[sheet].cells.get(at(l)).cloned().unwrap_or(Value::Empty)).collect();
        match &k.by {
            SortBy::Value => Prep::Plain(values),
            SortBy::List(items) => {
                let low: Vec<String> = items.iter().map(|s| s.trim().to_lowercase()).collect();
                let ranks = (first..=last)
                    .map(|l| {
                        let shown = self.shown(sheet, at(l), self.sheets[sheet].cells.get(at(l)).cloned().unwrap_or(Value::Empty)).to_string().trim().to_lowercase();
                        low.iter().position(|s| *s == shown)
                    })
                    .collect();
                Prep::Listed(ranks, values)
            }
            SortBy::Fill(want) | SortBy::Font(want) | SortBy::Icon(want) => {
                let cf: std::collections::HashMap<(u32, u32), crate::cf::Paint> = self.cf_in(sheet, at(first), at(last)).into_iter().map(|(a, p)| ((a.row, a.col), p)).collect();
                let hit = (first..=last)
                    .map(|l| {
                        let a = at(l);
                        let (fill, font, icon) = self.paint_of(sheet, a, cf.get(&(a.row, a.col)));
                        match k.by {
                            SortBy::Icon(_) => icon == *want,
                            SortBy::Fill(_) => fill == *want,
                            _ => font == *want,
                        }
                    })
                    .collect();
                Prep::Hit(hit)
            }
        }
    }

    fn paint_of(&self, sheet: usize, a: Addr, paint: Option<&crate::cf::Paint>) -> (String, String, String) {
        let mut st = self.effective_style(sheet, a);
        if let Some(s) = paint.and_then(|p| p.style.as_ref()) {
            st = st.overlay(s);
        }
        let icon = paint.and_then(|p| p.icon.as_ref()).map_or_else(|| "none".to_string(), |(set, i)| format!("{set}:{i}"));
        (st.fill.map(|p| p.text()).unwrap_or_else(|| "none".into()), st.color.map(|p| p.text()).unwrap_or_else(|| "auto".into()), icon)
    }

    pub fn sort_choices(&self, sheet: usize, area: Area, header: bool, across: bool, key: u32) -> (Vec<String>, Vec<String>, Vec<String>) {
        if sheet >= self.sheets.len() {
            return Default::default();
        }
        let (lo, hi) = if across { (area.c0, area.c1) } else { (area.r0, area.r1) };
        let first = lo + u32::from(header);
        if first > hi {
            return Default::default();
        }
        let at = |line: u32| if across { Addr { row: key, col: line } } else { Addr { row: line, col: key } };
        let cf: std::collections::HashMap<(u32, u32), crate::cf::Paint> = self.cf_in(sheet, at(first), at(hi)).into_iter().map(|(a, p)| ((a.row, a.col), p)).collect();
        let (mut fills, mut fonts, mut icons) = (Vec::new(), Vec::new(), Vec::new());
        for l in first..=hi.min(first + 50_000) {
            let a = at(l);
            let (fill, font, icon) = self.paint_of(sheet, a, cf.get(&(a.row, a.col)));
            for (list, v) in [(&mut fills, fill), (&mut fonts, font), (&mut icons, icon)] {
                if !list.contains(&v) {
                    list.push(v);
                }
            }
        }
        (fills, fonts, icons)
    }

    pub fn sort_with(&mut self, sheet: usize, area: Area, keys: &[SortKey], header: bool, case: bool, across: bool) -> Result<Effect, EngineError> {
        self.check(sheet, Addr { row: area.r1, col: area.c1 })?;
        let mut area = area;
        if let Some(end) = self.sheets[sheet].cells.extent() {
            area.r1 = area.r1.min(end.row);
            area.c1 = area.c1.min(end.col);
        }
        let (lo, hi) = if across { (area.c0, area.c1) } else { (area.r0, area.r1) };
        let (po0, po1) = if across { (area.r0, area.r1) } else { (area.c0, area.c1) };
        let first = lo + u32::from(header);
        if first >= hi || keys.is_empty() || area.c0 > area.c1 {
            return Ok(Effect::default());
        }
        let hits = |m: &Area| m.r0 <= area.r1 && m.r1 >= area.r0 && m.c0 <= area.c1 && m.c1 >= area.c0;
        if self.sheets[sheet].merges.iter().any(hits) {
            return Err(EngineError::BadStyle("merged cells in the sort range".into()));
        }
        let rows: Vec<u32> = (first..=hi).collect();
        let preps: Vec<Prep> = keys.iter().map(|k| self.prep_key(sheet, area, first, across, k)).collect();
        let mut perm = rows.clone();
        perm.sort_by(|&x, &y| {
            let (ix, iy) = ((x - first) as usize, (y - first) as usize);
            for (k, p) in keys.iter().zip(&preps) {
                let o = match p {
                    Prep::Plain(v) => order(&v[ix], &v[iy], k.descending, case),
                    Prep::Listed(r, v) => match (r[ix], r[iy]) {
                        (Some(a), Some(b)) => {
                            let o = a.cmp(&b);
                            if k.descending { o.reverse() } else { o }
                        }
                        (Some(_), None) => if k.descending { Ordering::Greater } else { Ordering::Less },
                        (None, Some(_)) => if k.descending { Ordering::Less } else { Ordering::Greater },
                        (None, None) => order(&v[ix], &v[iy], k.descending, case),
                    },
                    Prep::Hit(h) => {
                        let o = h[iy].cmp(&h[ix]);
                        if k.descending { o.reverse() } else { o }
                    }
                };
                if o != Ordering::Equal {
                    return o;
                }
            }
            Ordering::Equal
        });
        if perm == rows {
            return Ok(Effect::default());
        }
        let mut edits = Vec::new();
        let mut formats = Vec::new();
        let mut links_after = Vec::new();
        for (i, &src) in perm.iter().enumerate() {
            let dst = first + i as u32;
            if src == dst {
                continue;
            }
            for c in po0..=po1 {
                let place = |line: u32| if across { Addr { row: c, col: line } } else { Addr { row: line, col: c } };
                let (from, to) = (place(src), place(dst));
                let raw = self.input(sheet, from);
                let shift = i64::from(dst) - i64::from(src);
                let raw = if raw.starts_with('=') { if across { offset_text(&raw, 0, shift) } else { offset_text(&raw, shift, 0) } } else { raw };
                edits.push((to, raw));
                let style = self.styles.get(&(sheet, from)).map(|s| s.0.clone()).unwrap_or_default();
                let code = self.codes.get(&(sheet, from)).map(|c| c.0.clone()).unwrap_or_default();
                formats.push((to, Some(style), Some(code)));
                links_after.push(((sheet, to), self.links.get(&(sheet, from)).cloned()));
            }
        }
        let mark = self.undo_mark();
        let mut out = Effect { cells: self.apply(sheet, &edits)?, ..Effect::default() };
        out = out.join(self.put_formats(sheet, &formats)?);
        let changes: Vec<_> = links_after.into_iter().filter_map(|(k, after)| {
            let before = self.links.get(&k).cloned();
            (before != after).then_some((k, before, after))
        }).collect();
        if !changes.is_empty() {
            let e = self.apply_links(&changes, true);
            self.record(Tx::Links(changes));
            out = out.join(Effect { cells: self.present(e.cells), ..e });
        }
        self.undo_group(mark);
        Ok(out)
    }
}
