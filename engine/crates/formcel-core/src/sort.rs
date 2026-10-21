use crate::formula::{offset_text, Area};
use crate::{eval, Addr, Effect, EngineError, Tx, Value, Workbook};
use std::cmp::Ordering;

#[derive(Clone, Copy, Debug)]
pub struct SortKey {
    pub col: u32,
    pub descending: bool,
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
        self.check(sheet, Addr { row: area.r1, col: area.c1 })?;
        let mut area = area;
        if let Some(end) = self.sheets[sheet].cells.extent() {
            area.r1 = area.r1.min(end.row);
            area.c1 = area.c1.min(end.col);
        }
        let first = area.r0 + u32::from(header);
        if first >= area.r1 || keys.is_empty() || area.c0 > area.c1 {
            return Ok(Effect::default());
        }
        let hits = |m: &Area| m.r0 <= area.r1 && m.r1 >= area.r0 && m.c0 <= area.c1 && m.c1 >= area.c0;
        if self.sheets[sheet].merges.iter().any(hits) {
            return Err(EngineError::BadStyle("merged cells in the sort range".into()));
        }
        let rows: Vec<u32> = (first..=area.r1).collect();
        let value = |r: u32, c: u32| self.sheets[sheet].cells.get(Addr { row: r, col: c }).cloned().unwrap_or(Value::Empty);
        let mut perm = rows.clone();
        perm.sort_by(|&x, &y| {
            for k in keys {
                let o = order(&value(x, k.col), &value(y, k.col), k.descending, case);
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
            for c in area.c0..=area.c1 {
                let (from, to) = (Addr { row: src, col: c }, Addr { row: dst, col: c });
                let raw = self.input(sheet, from);
                let raw = if raw.starts_with('=') { offset_text(&raw, i64::from(dst) - i64::from(src), 0) } else { raw };
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
