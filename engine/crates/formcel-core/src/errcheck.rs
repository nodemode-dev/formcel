use crate::audit::Arrow;
use crate::calc::{RULE_COLUMN, RULE_EMPTY, RULE_ERROR, RULE_INCONSISTENT, RULE_OMITS, RULE_TABLE_INVALID, RULE_TEXT_NUMBER, RULE_UNLOCKED, RULE_YEAR};
use crate::formula::{self, Area, Expr, RefKind};
use crate::graph::{FastMap, FastSet};
use crate::{r1c1, wire, Addr, Effect, EngineError, Value, Workbook};
use std::collections::BTreeMap;

const AGGREGATES: [&str; 16] = ["AVERAGE", "COUNT", "COUNTA", "MAX", "MEDIAN", "MIN", "PRODUCT", "STDEV", "STDEV.P", "STDEV.S", "SUBTOTAL", "SUM", "SUMPRODUCT", "VAR", "VAR.P", "VAR.S"];
const NO_VALUE: [&str; 11] = ["ISBLANK", "COUNTBLANK", "ISREF", "ROW", "COLUMN", "ROWS", "COLUMNS", "ISFORMULA", "SHEET", "CELL", "FORMULATEXT"];
const TRACE_LIMIT: usize = 1000;

pub fn rule_text(rule: u16, shown: &str) -> String {
    match rule {
        RULE_ERROR => match shown {
            "#DIV/0!" => "The formula or function used is dividing by zero or empty cells.",
            "#N/A" => "A value is not available to the formula or function.",
            "#NAME?" => "The formula refers to a name that is not defined.",
            "#NULL!" => "The formula refers to two ranges that do not intersect.",
            "#NUM!" => "The formula contains an invalid number.",
            "#REF!" => "The formula refers to cells that are not valid.",
            "#VALUE!" => "A value used in the formula is of the wrong data type.",
            "#SPILL!" => "The result of the formula cannot spill into the cells below or to the right.",
            _ => "The formula in this cell results in an error.",
        },
        RULE_COLUMN => "The formula in this cell differs from the calculated column formula in the table.",
        RULE_YEAR => "The date in this cell has a two-digit year that can be read as the wrong century.",
        RULE_TEXT_NUMBER => "The number in this cell is formatted as text or preceded by an apostrophe.",
        RULE_INCONSISTENT => "The formula in this cell differs from the formulas in this area of the spreadsheet.",
        RULE_OMITS => "The formula in this cell refers to a range that has additional numbers adjacent to it.",
        RULE_UNLOCKED => "This cell contains a formula and is unlocked, so it can be changed on a protected sheet.",
        RULE_EMPTY => "The formula in this cell refers to empty cells.",
        RULE_TABLE_INVALID => "The value in this table cell does not meet the data validation rule for the cell.",
        _ => "",
    }
    .to_string()
}

fn looks_number(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty() && !t.starts_with('=') && matches!(Value::parse_input(t), Value::Number(_)) && t.chars().any(|c| c.is_ascii_digit())
}

fn two_digit_year(s: &str) -> bool {
    let t = s.trim();
    let parts: Vec<&str> = t.split(['/', '-', '.']).collect();
    if parts.len() != 3 || t.contains("  ") {
        return false;
    }
    let digits = |p: &str, n: std::ops::RangeInclusive<usize>| n.contains(&p.len()) && p.chars().all(|c| c.is_ascii_digit());
    digits(parts[0], 1..=2) && digits(parts[1], 1..=2) && digits(parts[2], 2..=2)
}

pub fn expand_year(s: &str) -> String {
    let t = s.trim();
    let sep = t.chars().find(|c| matches!(c, '/' | '-' | '.')).unwrap_or('/');
    let parts: Vec<&str> = t.split(['/', '-', '.']).collect();
    let yy: u32 = parts[2].parse().unwrap_or(0);
    let year = if yy < 30 { 2000 + yy } else { 1900 + yy };
    format!("{}{sep}{}{sep}{year}", parts[0], parts[1])
}

fn visit_refs(e: &Expr, quiet: bool, f: &mut dyn FnMut(&Expr)) {
    match e {
        Expr::Call(n, args) => {
            let q = quiet || NO_VALUE.contains(&n.as_str());
            for a in args {
                visit_refs(a, q, f);
            }
        }
        Expr::Ref(..) if !quiet => f(e),
        Expr::Ref(..) => {}
        o => {
            for c in formula::children(o) {
                visit_refs(c, quiet, f);
            }
        }
    }
}

fn strings(e: &Expr, f: &mut dyn FnMut(&str)) {
    if let Expr::Str(s) = e {
        f(s);
    }
    for c in formula::children(e) {
        strings(c, f);
    }
}

impl Workbook {
    fn own_sheet(&self, home: usize, name: &Option<String>) -> Option<usize> {
        match name {
            None => Some(home),
            Some(n) => self.sheet_by_name(n),
        }
    }

    fn rc_text(&self, memo: &mut FastMap<(u32, u32), Option<String>>, sheet: usize, r: i64, c: i64) -> Option<String> {
        if r < 0 || c < 0 {
            return None;
        }
        let key = (r as u32, c as u32);
        if let Some(t) = memo.get(&key) {
            return t.clone();
        }
        let a = Addr { row: key.0, col: key.1 };
        let t = self.formulas.get(&(sheet, a)).map(|f| r1c1::to_r1c1(&f.text(), a));
        memo.insert(key, t.clone());
        t
    }

    fn adjacent_number(&self, sheet: usize, r: i64, c: i64, me: Addr) -> bool {
        if r < 0 || c < 0 || (r as u32 == me.row && c as u32 == me.col) {
            return false;
        }
        let a = Addr { row: r as u32, col: c as u32 };
        matches!(self.sheets[sheet].cells.get(a), Some(Value::Number(_))) && !self.spilled.contains_key(&(sheet, a))
    }

    fn issues_in_formula(&self, sheet: usize, a: Addr, rules: u16, memo: &mut FastMap<(u32, u32), Option<String>>) -> u16 {
        let mut mask = 0u16;
        let Some(f) = self.formulas.get(&(sheet, a)) else { return 0 };
        let value = self.sheets[sheet].cells.get(a);
        let spilled_member = self.spilled.contains_key(&(sheet, a));
        if rules & RULE_ERROR != 0 && matches!(value, Some(Value::Error(_))) && !spilled_member {
            mask |= RULE_ERROR;
        }
        if rules & RULE_UNLOCKED != 0 && self.cell_flags(sheet, a.row, a.col) & 1 != 0 {
            mask |= RULE_UNLOCKED;
        }
        let Some(e) = f.ast.as_ref() else { return mask };
        if rules & RULE_INCONSISTENT != 0 {
            let (r, c) = (i64::from(a.row), i64::from(a.col));
            let me = self.rc_text(memo, sheet, r, c);
            let pairs = [((r, c - 1), (r, c + 1)), ((r - 1, c), (r + 1, c))];
            for (p, q) in pairs {
                let (x, y) = (self.rc_text(memo, sheet, p.0, p.1), self.rc_text(memo, sheet, q.0, q.1));
                if x.is_some() && x == y && x != me {
                    mask |= RULE_INCONSISTENT;
                    break;
                }
            }
        }
        if rules & RULE_YEAR != 0 {
            let mut hit = false;
            strings(e, &mut |s| hit |= two_digit_year(s));
            if hit {
                mask |= RULE_YEAR;
            }
        }
        if rules & RULE_OMITS != 0 && self.omitting(sheet, a, e).is_some() {
            mask |= RULE_OMITS;
        }
        if rules & RULE_EMPTY != 0 {
            let mut hit = false;
            visit_refs(e, false, &mut |n| {
                let Expr::Ref(s, k) = n else { return };
                let Some(si) = self.own_sheet(sheet, s) else { return };
                let ar = k.area();
                if !matches!(k, RefKind::Cell(_) | RefKind::Area(..)) || u64::from(ar.r1 - ar.r0 + 1) * u64::from(ar.c1 - ar.c0 + 1) > 400 {
                    return;
                }
                let mut any = false;
                self.sheets[si].cells.for_each_in(Addr { row: ar.r0, col: ar.c0 }, Addr { row: ar.r1, col: ar.c1 }, |_, v| any |= *v != Value::Empty);
                if !any && !(si == sheet && ar.contains(a.row, a.col)) {
                    hit = true;
                }
            });
            if hit {
                mask |= RULE_EMPTY;
            }
        }
        if rules & RULE_COLUMN != 0 {
            if let Some(t) = self.table_at(sheet, a) {
                let (d0, d1) = t.data();
                let j = (a.col - t.area.c0) as usize;
                if a.row >= d0 && a.row <= d1 && t.calc.get(j).is_some_and(|s| !s.is_empty()) {
                    let want = formula::offset_text(&t.calc[j], i64::from(a.row - d0), 0);
                    if want != f.text() {
                        mask |= RULE_COLUMN;
                    }
                }
            }
        }
        mask
    }

    pub(crate) fn omitting(&self, sheet: usize, a: Addr, e: &Expr) -> Option<(Area, i32)> {
        fn walk(wb: &Workbook, sheet: usize, a: Addr, e: &Expr) -> Option<(Area, i32)> {
            if let Expr::Call(n, args) = e {
                if AGGREGATES.contains(&n.as_str()) {
                    for x in args {
                        let Expr::Ref(s, RefKind::Area(p, q)) = x else { continue };
                        let Some(si) = wb.own_sheet(sheet, s) else { continue };
                        if si != sheet {
                            continue;
                        }
                        let ar = RefKind::Area(*p, *q).area();
                        let (h, w) = (ar.r1 - ar.r0 + 1, ar.c1 - ar.c0 + 1);
                        let (r0, r1, c0, c1) = (i64::from(ar.r0), i64::from(ar.r1), i64::from(ar.c0), i64::from(ar.c1));
                        if w == 1 && h > 1 {
                            if wb.adjacent_number(sheet, r1 + 1, c0, a) {
                                return Some((ar, 1));
                            }
                            if wb.adjacent_number(sheet, r0 - 1, c0, a) {
                                return Some((ar, -1));
                            }
                        } else if h == 1 && w > 1 {
                            if wb.adjacent_number(sheet, r0, c1 + 1, a) {
                                return Some((ar, 2));
                            }
                            if wb.adjacent_number(sheet, r0, c0 - 1, a) {
                                return Some((ar, -2));
                            }
                        }
                    }
                }
            }
            formula::children(e).into_iter().find_map(|c| walk(wb, sheet, a, c))
        }
        walk(self, sheet, a, e)
    }

    pub fn errcheck_scan(&self, sheet: usize, top: Addr, bottom: Addr) -> Vec<(Addr, u16)> {
        let rules = self.calc.set.rules;
        if rules == 0 || sheet >= self.sheets.len() {
            return Vec::new();
        }
        let mut found: BTreeMap<(u32, u32), u16> = BTreeMap::new();
        let inside = |a: Addr| a.row >= top.row && a.row <= bottom.row && a.col >= top.col && a.col <= bottom.col;
        if rules & (RULE_TEXT_NUMBER | RULE_YEAR) != 0 {
            self.sheets[sheet].cells.for_each_in(top, bottom, |a, v| {
                let k = (sheet, a);
                if self.formulas.contains_key(&k) || self.spilled.contains_key(&k) {
                    return;
                }
                if let Value::Text(s) = v {
                    if rules & RULE_TEXT_NUMBER != 0 && looks_number(s) {
                        *found.entry((a.row, a.col)).or_default() |= RULE_TEXT_NUMBER;
                    }
                    if rules & RULE_YEAR != 0 && two_digit_year(s) {
                        *found.entry((a.row, a.col)).or_default() |= RULE_YEAR;
                    }
                }
            });
        }
        let mut memo: FastMap<(u32, u32), Option<String>> = FastMap::default();
        for (k, _) in self.formulas.iter().filter(|(k, _)| k.0 == sheet && inside(k.1)) {
            let m = self.issues_in_formula(sheet, k.1, rules, &mut memo);
            if m != 0 {
                *found.entry((k.1.row, k.1.col)).or_default() |= m;
            }
        }
        if rules & RULE_TABLE_INVALID != 0 {
            for t in self.tables.iter().filter(|t| t.sheet == sheet) {
                let (d0, d1) = t.data();
                let ar = Area { r0: d0.max(top.row), r1: d1.min(bottom.row), c0: t.area.c0.max(top.col), c1: t.area.c1.min(bottom.col) };
                if ar.r0 > ar.r1 || ar.c0 > ar.c1 {
                    continue;
                }
                for a in self.invalid_in(sheet, Addr { row: ar.r0, col: ar.c0 }, Addr { row: ar.r1, col: ar.c1 }) {
                    *found.entry((a.row, a.col)).or_default() |= RULE_TABLE_INVALID;
                }
            }
        }
        let ignored: FastSet<(u32, u32, u16)> = self.calc.ignored.iter().filter(|i| i.0 == sheet).map(|i| (i.1, i.2, i.3)).collect();
        found
            .into_iter()
            .filter_map(|((r, c), mut m)| {
                for bit in [RULE_ERROR, RULE_COLUMN, RULE_YEAR, RULE_TEXT_NUMBER, RULE_INCONSISTENT, RULE_OMITS, RULE_UNLOCKED, RULE_EMPTY, RULE_TABLE_INVALID] {
                    if m & bit != 0 && ignored.contains(&(r, c, bit)) {
                        m &= !bit;
                    }
                }
                (m != 0).then_some((Addr { row: r, col: c }, m))
            })
            .collect()
    }

    pub fn errcheck_lines(&self, sheet: usize, top: Addr, bottom: Addr) -> String {
        let mut out = String::new();
        for (a, m) in self.errcheck_scan(sheet, top, bottom) {
            let rule = m & m.wrapping_neg();
            let shown = self.sheets[sheet].cells.get(a).map(Value::to_string).unwrap_or_default();
            out.push_str(&format!("{}\t{}\t{}\t{}\t", a.row, a.col, rule, m));
            wire::escape(&rule_text(rule, &shown), &mut out);
            out.push('\n');
        }
        out
    }

    pub fn errcheck_ignore(&mut self, sheet: usize, a: Addr, rule: u16) {
        if !self.calc.ignored.iter().any(|i| *i == (sheet, a.row, a.col, rule)) {
            self.calc.ignored.push((sheet, a.row, a.col, rule));
        }
    }

    pub fn errcheck_reset(&mut self) -> usize {
        let n = self.calc.ignored.len();
        self.calc.ignored.clear();
        n
    }

    pub fn errcheck_fix(&mut self, sheet: usize, a: Addr, rule: u16, action: &str) -> Result<Effect, EngineError> {
        self.check(sheet, a)?;
        let k = (sheet, a);
        let mut fx = Effect::default();
        match (rule, action) {
            (RULE_TEXT_NUMBER, "number") => {
                if let Some(Value::Text(s)) = self.sheets[sheet].cells.get(a).cloned() {
                    let mark = self.undo.len();
                    if self.code_of(&k).is_some_and(|c| c.1.class() == crate::fmtcode::Class::Text) {
                        fx = self.set_format(sheet, a, a, "General")?;
                    }
                    let cells = self.apply(sheet, &[(a, s.trim().to_string())])?;
                    fx.cells.extend(cells);
                    self.group_since(mark);
                }
            }
            (RULE_YEAR, "year") => {
                let text = self.input(sheet, a);
                let fixed = match self.formulas.get(&k).and_then(|f| f.ast.clone()) {
                    Some(mut e) => {
                        formula::walk_mut(&mut e, &mut |n| {
                            if let Expr::Str(s) = n {
                                if two_digit_year(s) {
                                    *s = expand_year(s);
                                }
                            }
                        });
                        format!("={}", formula::to_text(&e))
                    }
                    None => expand_year(text.trim_start_matches('\'')),
                };
                fx.cells = self.apply(sheet, &[(a, fixed)])?;
            }
            (RULE_OMITS, "include") => {
                let Some(mut e) = self.formulas.get(&k).and_then(|f| f.ast.clone()) else { return Ok(fx) };
                let Some((area, dir)) = self.omitting(sheet, a, &e) else { return Ok(fx) };
                formula::walk_mut(&mut e, &mut |n| {
                    let Expr::Ref(None, RefKind::Area(p, q)) = n else { return };
                    if RefKind::Area(*p, *q).area() != area {
                        return;
                    }
                    let (lo, hi) = if p.row <= q.row && p.col <= q.col { (p, q) } else { (q, p) };
                    match dir {
                        1 => hi.row += 1,
                        -1 => lo.row = lo.row.saturating_sub(1),
                        2 => hi.col += 1,
                        _ => lo.col = lo.col.saturating_sub(1),
                    }
                });
                fx.cells = self.apply(sheet, &[(a, format!("={}", formula::to_text(&e)))])?;
            }
            (RULE_INCONSISTENT, "above" | "left" | "below" | "right") => {
                let (dr, dc): (i64, i64) = match action {
                    "above" => (-1, 0),
                    "below" => (1, 0),
                    "left" => (0, -1),
                    _ => (0, 1),
                };
                let (nr, nc) = (i64::from(a.row) + dr, i64::from(a.col) + dc);
                if nr < 0 || nc < 0 {
                    return Ok(fx);
                }
                let from = Addr { row: nr as u32, col: nc as u32 };
                let Some(mut e) = self.formulas.get(&(sheet, from)).and_then(|f| f.ast.clone()) else { return Ok(fx) };
                formula::offset(&mut e, -dr, -dc);
                fx.cells = self.apply(sheet, &[(a, format!("={}", formula::to_text(&e)))])?;
            }
            (RULE_UNLOCKED, "lock") => {
                self.set_cell_flags(sheet, Area { r0: a.row, c0: a.col, r1: a.row, c1: a.col }, Some(false), None).map_err(EngineError::Protected)?;
            }
            (RULE_COLUMN, "column") => {
                if let Some(t) = self.table_at(sheet, a) {
                    let (d0, _) = t.data();
                    let j = (a.col - t.area.c0) as usize;
                    if let Some(c) = t.calc.get(j).filter(|c| !c.is_empty()) {
                        let want = formula::offset_text(c, i64::from(a.row - d0), 0);
                        fx.cells = self.apply(sheet, &[(a, want)])?;
                    }
                }
            }
            _ => return Err(EngineError::BadFormula(action.to_string())),
        }
        Ok(fx)
    }

    pub fn trace_error(&self, sheet: usize, a: Addr) -> Vec<Arrow> {
        let mut out: Vec<Arrow> = Vec::new();
        let mut seen: Vec<(usize, Addr)> = vec![(sheet, a)];
        let mut frontier = vec![(sheet, a)];
        let mut level = 1;
        while !frontier.is_empty() && out.len() < TRACE_LIMIT {
            let mut next = Vec::new();
            for k in &frontier {
                for (s, ar) in self.areas_of_key(k) {
                    self.sheets[s].cells.for_each_in(Addr { row: ar.r0, col: ar.c0 }, Addr { row: ar.r1, col: ar.c1 }, |p, v| {
                        if matches!(v, Value::Error(_)) && !(s == k.0 && p == k.1) && out.len() < TRACE_LIMIT {
                            let cell = Area { r0: p.row, c0: p.col, r1: p.row, c1: p.col };
                            out.push(Arrow { from_sheet: s, from: cell, to_sheet: k.0, to: k.1, level });
                            if !seen.contains(&(s, p)) {
                                seen.push((s, p));
                                next.push((s, p));
                            }
                        }
                    });
                }
            }
            frontier = next;
            level += 1;
        }
        out
    }

    fn areas_of_key(&self, k: &(usize, Addr)) -> Vec<(usize, Area)> {
        self.formulas.get(k).map(|f| self.areas_of(k, f)).unwrap_or_default()
    }
}
