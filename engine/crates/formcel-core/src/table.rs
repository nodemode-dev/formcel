use crate::formula::{self, Area, ErrKind, Expr, TableSpec, ITEM_ALL, ITEM_DATA, ITEM_HEADERS, ITEM_THIS, ITEM_TOTALS};
use crate::wire::{escape, unescape};
use crate::{Addr, Effect, EngineError, Shift, Tx, Value, Workbook};

pub fn valid_style(s: &str) -> bool {
    for (kind, top) in [("Light", 21), ("Medium", 28), ("Dark", 11)] {
        if let Some(n) = s.strip_prefix("TableStyle").and_then(|r| r.strip_prefix(kind)) {
            return n.parse::<u32>().is_ok_and(|v| (1..=top).contains(&v) && v.to_string() == n);
        }
    }
    let Some(rest) = s.strip_prefix("Custom:") else { return false };
    let p: Vec<&str> = rest.split(':').collect();
    let hex = |h: &str| h.len() == 6 && h.bytes().all(|b| b.is_ascii_hexdigit());
    p.len() == 4 && !p[0].is_empty() && p[0].len() <= 40 && !p[0].contains(['\t', '\n']) && p[1..].iter().all(|h| hex(h))
}
pub const DEFAULT_STYLE: &str = "TableStyleMedium2";

#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    pub sheet: usize,
    pub name: String,
    pub area: Area,
    pub totals: bool,
    pub cols: Vec<String>,
    pub calc: Vec<String>,
    pub kept: Vec<String>,
    pub style: String,
    pub banded_rows: bool,
    pub banded_cols: bool,
    pub first_col: bool,
    pub last_col: bool,
    pub button: bool,
    pub types: Vec<String>,
}

fn hit(a: Area, at: Addr) -> bool {
    at.row >= a.r0 && at.row <= a.r1 && at.col >= a.c0 && at.col <= a.c1
}

fn overlaps(a: Area, b: Area) -> bool {
    a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0
}

impl Table {
    pub fn data(&self) -> (u32, u32) {
        (self.area.r0 + 1, self.area.r1 - u32::from(self.totals))
    }

    pub fn filter_area(&self) -> Area {
        Area { r1: self.data().1, ..self.area }
    }

    pub fn line(&self) -> String {
        let a = self.area;
        let mut flags = String::new();
        for (on, ch) in [(self.totals, 't'), (self.banded_rows, 'r'), (self.banded_cols, 'c'), (self.first_col, 'f'), (self.last_col, 'l'), (self.button, 'b')] {
            if on {
                flags.push(ch);
            }
        }
        let mut out = format!("{}\t", self.sheet);
        escape(&self.name, &mut out);
        out.push_str(&format!("\t{},{},{},{}\t{flags}\t", a.r0, a.c0, a.r1, a.c1));
        escape(&self.style, &mut out);
        out.push_str(&format!("\t{}", self.cols.len()));
        for list in [&self.cols, &self.calc, &self.kept] {
            for s in list {
                out.push('\t');
                escape(s, &mut out);
            }
        }
        if self.types.iter().any(|t| !t.is_empty()) {
            for j in 0..self.cols.len() {
                out.push('\t');
                escape(self.types.get(j).map_or("", String::as_str), &mut out);
            }
        }
        out
    }

    pub fn parse(line: &str) -> Option<Table> {
        let p: Vec<String> = line.split('\t').map(unescape).collect();
        let sheet = p.first()?.parse().ok()?;
        let n: Vec<u32> = p.get(2)?.split(',').filter_map(|x| x.parse().ok()).collect();
        if n.len() != 4 || n[0] >= n[2] || n[1] > n[3] || n[2] >= crate::MAX_ROWS || n[3] >= crate::MAX_COLS {
            return None;
        }
        let area = Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] };
        let flags = p.get(3)?.clone();
        let count: usize = p.get(5)?.parse().ok()?;
        if count != (area.c1 - area.c0 + 1) as usize {
            return None;
        }
        let list = |k: usize| -> Vec<String> { (0..count).map(|i| p.get(6 + k * count + i).cloned().unwrap_or_default()).collect() };
        let name = p.get(1)?.clone();
        if !formula::valid_name(&name) {
            return None;
        }
        let t = Table {
            sheet,
            name,
            area,
            totals: flags.contains('t'),
            cols: list(0),
            calc: list(1),
            kept: list(2),
            style: Some(p.get(4)?.clone()).filter(|s| !s.is_empty()).unwrap_or_else(|| DEFAULT_STYLE.into()),
            banded_rows: flags.contains('r'),
            banded_cols: flags.contains('c'),
            first_col: flags.contains('f'),
            last_col: flags.contains('l'),
            button: flags.contains('b'),
            types: if p.len() >= 6 + 4 * count { (0..count).map(|i| p[6 + 3 * count + i].clone()).collect() } else { Vec::new() },
        };
        (t.data().0 <= t.data().1).then_some(t)
    }

    fn col_index(&self, name: &str) -> Option<usize> {
        self.cols.iter().position(|c| c.eq_ignore_ascii_case(name))
    }
}

pub fn unique_names(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (i, r) in raw.iter().enumerate() {
        let base = if r.trim().is_empty() { format!("Column{}", i + 1) } else { r.trim().to_string() };
        let mut name = base.clone();
        let mut k = 2;
        while out.iter().any(|o| o.eq_ignore_ascii_case(&name)) {
            name = format!("{base}{k}");
            k += 1;
        }
        out.push(name);
    }
    out
}

impl Workbook {
    pub fn tables(&self) -> Vec<String> {
        self.tables.iter().map(Table::line).collect()
    }

    pub fn load_tables(&mut self, lines: &[String]) -> usize {
        self.tables = lines.iter().filter_map(|l| Table::parse(l)).filter(|t| t.sheet < self.sheets.len()).collect();
        self.graph.built = false;
        self.recalc_all();
        self.tables.len()
    }

    pub fn table_at(&self, sheet: usize, a: Addr) -> Option<&Table> {
        self.tables.iter().find(|t| t.sheet == sheet && hit(t.area, a))
    }

    fn table_named(&self, name: &str) -> Option<usize> {
        self.tables.iter().position(|t| t.name.eq_ignore_ascii_case(name))
    }

    fn name_free(&self, name: &str, except: Option<usize>) -> bool {
        formula::valid_name(name)
            && !self.names.contains_key(&name.to_ascii_uppercase())
            && self.tables.iter().enumerate().all(|(i, t)| Some(i) == except || !t.name.eq_ignore_ascii_case(name))
    }

    pub fn resolve_table(&self, sheet: usize, name: Option<&str>, spec: &TableSpec, at: Option<Addr>) -> Result<(usize, Area), ErrKind> {
        let t = match name {
            Some(n) => self.tables.iter().find(|t| t.name.eq_ignore_ascii_case(n)),
            None => at.and_then(|a| self.table_at(sheet, a)),
        }
        .ok_or(ErrKind::Ref)?;
        let (c0, c1) = match &spec.cols {
            None => (t.area.c0, t.area.c1),
            Some((a, b)) => {
                let (x, y) = (t.col_index(a).ok_or(ErrKind::Ref)? as u32, t.col_index(b).ok_or(ErrKind::Ref)? as u32);
                (t.area.c0 + x.min(y), t.area.c0 + x.max(y))
            }
        };
        let (d0, d1) = t.data();
        let items = if spec.items == 0 { ITEM_DATA } else { spec.items };
        let (r0, r1) = if items & ITEM_THIS != 0 {
            let a = at.ok_or(ErrKind::Value)?;
            if a.row < d0 || a.row > d1 {
                return Err(ErrKind::Value);
            }
            (a.row, a.row)
        } else if items & ITEM_ALL != 0 {
            (t.area.r0, t.area.r1)
        } else {
            if items & ITEM_TOTALS != 0 && !t.totals {
                return Err(ErrKind::Ref);
            }
            let mut parts: Vec<(u32, u32)> = Vec::new();
            if items & ITEM_HEADERS != 0 {
                parts.push((t.area.r0, t.area.r0));
            }
            if items & ITEM_DATA != 0 {
                parts.push((d0, d1));
            }
            if items & ITEM_TOTALS != 0 {
                parts.push((t.area.r1, t.area.r1));
            }
            (parts.iter().map(|p| p.0).min().ok_or(ErrKind::Ref)?, parts.iter().map(|p| p.1).max().ok_or(ErrKind::Ref)?)
        };
        Ok((t.sheet, Area { r0, c0, r1, c1 }))
    }

    pub fn file_formula(&self, sheet: usize, a: Addr) -> Option<String> {
        let f = self.formulas.get(&(sheet, a))?;
        let mut e = f.ast.clone()?;
        if !formula::has_table(&e) {
            return None;
        }
        let own = self.table_at(sheet, a).map(|t| t.name.clone());
        formula::walk_mut(&mut e, &mut |node| {
            if let Expr::Table(n, spec) = node {
                if n.is_none() {
                    n.clone_from(&own);
                }
                spec.long = spec.items == ITEM_THIS;
            }
        });
        Some(format!("={}", formula::to_text(&e)))
    }

    pub fn plain_formula(&self, sheet: usize, a: Addr) -> Option<String> {
        let mut e = self.formulas.get(&(sheet, a))?.ast.clone()?;
        if !formula::has_table(&e) {
            return None;
        }
        formula::walk_mut(&mut e, &mut |node| {
            if let Expr::Table(n, spec) = node {
                *node = match self.resolve_table(sheet, n.as_deref(), spec, Some(a)) {
                    Ok((ts, r)) => {
                        let other = (ts != sheet).then(|| self.sheets[ts].name.clone());
                        let c0 = formula::CellRef { row: r.r0, col: r.c0, abs_row: true, abs_col: true };
                        let c1 = formula::CellRef { row: r.r1, col: r.c1, abs_row: true, abs_col: true };
                        Expr::Ref(other, if r.r0 == r.r1 && r.c0 == r.c1 { formula::RefKind::Cell(c0) } else { formula::RefKind::Area(c0, c1) })
                    }
                    Err(k) => Expr::Err(k),
                };
            }
        });
        Some(format!("={}", formula::to_text(&e)))
    }

    fn header_texts(&self, sheet: usize, a: Area) -> Vec<String> {
        (a.c0..=a.c1).map(|c| self.shown(sheet, Addr { row: a.r0, col: c }, self.sheets[sheet].cells.get(Addr { row: a.r0, col: c }).cloned().unwrap_or(Value::Empty)).to_string()).collect()
    }

    fn write_headers(&mut self, sheet: usize, a: Area, names: &[String]) -> Vec<(Addr, String)> {
        let mut edits = Vec::new();
        for (i, n) in names.iter().enumerate() {
            let at = Addr { row: a.r0, col: a.c0 + i as u32 };
            let cur = self.input(sheet, at);
            let want = if matches!(Value::parse_input(n), Value::Text(_)) && !n.starts_with(['\'', '=']) { n.clone() } else { format!("'{n}") };
            if cur != want && cur.trim_start_matches('\'') != n.as_str() || (cur.is_empty() && !n.is_empty()) {
                edits.push((at, want));
            }
        }
        edits
    }

    fn quiet_apply(&mut self, sheet: usize, edits: &[(Addr, String)]) -> Result<crate::Changed, EngineError> {
        self.table_quiet = true;
        let out = self.apply(sheet, edits);
        self.table_quiet = false;
        out
    }

    fn put_tables(&mut self, before: Vec<Table>) -> Effect {
        if before != self.tables {
            self.record(Tx::Tables { before, after: self.tables.clone() });
        }
        self.graph.built = false;
        let cells = self.recalc_all();
        Effect { cells: self.present(cells), tables: true, ..Effect::default() }
    }

    pub fn create_table(&mut self, sheet: usize, area: Area, header: bool) -> Result<Effect, EngineError> {
        self.check(sheet, Addr { row: area.r1, col: area.c1 })?;
        let mut area = area;
        if let Some(end) = self.sheets[sheet].cells.extent() {
            area.r1 = area.r1.min(end.row.max(area.r0 + 1));
            area.c1 = area.c1.min(end.col.max(area.c0));
        }
        if self.tables.iter().any(|t| t.sheet == sheet && overlaps(t.area, area)) {
            return Err(EngineError::BadStyle("a table cannot overlap another table".into()));
        }
        if self.sheets[sheet].merges.iter().any(|m| overlaps(*m, area)) {
            return Err(EngineError::BadStyle("merged cells in the table range".into()));
        }
        let mark = self.undo_mark();
        let mut out = Effect::default();
        if !header {
            let s = self.insert(sheet, true, area.r0, 1)?;
            out.shift = Some(s);
            area.r1 += 1;
        }
        if area.r1 <= area.r0 {
            area.r1 = area.r0 + 1;
        }
        let raw = if header { self.header_texts(sheet, area) } else { vec![String::new(); (area.c1 - area.c0 + 1) as usize] };
        let names = unique_names(&raw);
        let edits = self.write_headers(sheet, area, &names);
        if !edits.is_empty() {
            out.cells = self.quiet_apply(sheet, &edits)?;
        }
        let mut k = 1;
        while !self.name_free(&format!("Table{k}"), None) {
            k += 1;
        }
        let n = names.len();
        let before = self.tables.clone();
        self.tables.push(Table {
            sheet,
            name: format!("Table{k}"),
            area,
            totals: false,
            cols: names,
            calc: vec![String::new(); n],
            kept: vec![String::new(); n],
            style: DEFAULT_STYLE.into(),
            banded_rows: true,
            banded_cols: false,
            first_col: false,
            last_col: false,
            button: true,
            types: Vec::new(),
        });
        let t = self.tables.last().cloned().unwrap();
        let e = self.put_tables(before);
        out = out.join(e);
        if self.filter(sheet).is_none() {
            let fa = t.filter_area();
            out = out.join(self.set_filter(sheet, &format!("area\t{},{},{},{}\n", fa.r0, fa.c0, fa.r1, fa.c1))?);
        }
        self.undo_group(mark);
        Ok(out)
    }

    pub fn set_table(&mut self, name: &str, line: &str) -> Result<Effect, EngineError> {
        let i = self.table_named(name).ok_or_else(|| EngineError::BadName(name.to_string()))?;
        let old = self.tables[i].clone();
        let want = Table::parse(&format!("{}\t{line}", old.sheet)).ok_or_else(|| EngineError::BadStyle(line.to_string()))?;
        if !want.name.eq_ignore_ascii_case(&old.name) && !self.name_free(&want.name, Some(i)) {
            return Err(EngineError::BadName(want.name));
        }
        if want.area.r0 != old.area.r0 || want.area.c0 != old.area.c0 {
            return Err(EngineError::BadStyle("a table keeps its top-left cell".into()));
        }
        let sheet = old.sheet;
        if self.tables.iter().enumerate().any(|(j, t)| j != i && t.sheet == sheet && overlaps(t.area, want.area)) {
            return Err(EngineError::BadStyle("a table cannot overlap another table".into()));
        }
        let mark = self.undo_mark();
        let before = self.tables.clone();
        let mut out = Effect::default();
        let mut t = old.clone();
        t.name = want.name.clone();
        t.style = if valid_style(&want.style) || want.style == "None" { want.style.clone() } else { old.style.clone() };
        t.banded_rows = want.banded_rows;
        t.banded_cols = want.banded_cols;
        t.first_col = want.first_col;
        t.last_col = want.last_col;
        t.button = want.button;
        if !want.types.is_empty() {
            t.types = want.types.clone();
        }
        let body_end = old.data().1;
        if want.area.r1 != old.area.r1 || want.area.c1 != old.area.c1 {
            let w = (want.area.c1 - want.area.c0 + 1) as usize;
            let raw = self.header_texts(sheet, Area { r1: want.area.r0, ..want.area });
            let mut keep: Vec<String> = old.cols.iter().take(w).cloned().collect();
            for r in raw.iter().skip(keep.len()) {
                keep.push(r.clone());
            }
            let names = unique_names(&keep);
            let edits = self.write_headers(sheet, want.area, &names);
            if !edits.is_empty() {
                out.cells.extend(self.quiet_apply(sheet, &edits)?);
            }
            t.cols = names;
            t.calc.resize(w, String::new());
            t.kept.resize(w, String::new());
            if !t.types.is_empty() {
                t.types.resize(w, String::new());
            }
            t.area = want.area;
            if t.data().0 > t.data().1 {
                self.undo_group(mark);
                return Err(EngineError::BadStyle("a table needs a header row and a data row".into()));
            }
        }
        if want.totals != t.totals {
            let (_, d1) = t.data();
            let w = (t.area.c1 - t.area.c0 + 1) as usize;
            if want.totals {
                let row = d1 + 1;
                let busy = (t.area.c0..=t.area.c1).any(|c| !matches!(self.sheets[sheet].cells.get(Addr { row, col: c }), None | Some(Value::Empty)));
                if busy {
                    let s = self.insert(sheet, true, row, 1)?;
                    out.shift = Some(s);
                }
                t.area.r1 = row;
                t.totals = true;
                let mut edits = Vec::new();
                for j in 0..w {
                    let kept = t.kept.get(j).cloned().unwrap_or_default();
                    let raw = if !kept.is_empty() { kept } else if j == 0 { "Total".into() } else { String::new() };
                    if !raw.is_empty() {
                        edits.push((Addr { row, col: t.area.c0 + j as u32 }, raw));
                    }
                }
                if !edits.is_empty() {
                    out.cells.extend(self.quiet_apply(sheet, &edits)?);
                }
            } else {
                let row = t.area.r1;
                t.kept = (0..w).map(|j| self.input(sheet, Addr { row, col: t.area.c0 + j as u32 })).collect();
                let edits: Vec<(Addr, String)> = (0..w).map(|j| (Addr { row, col: t.area.c0 + j as u32 }, String::new())).collect();
                out.cells.extend(self.quiet_apply(sheet, &edits)?);
                t.area.r1 -= 1;
                t.totals = false;
            }
        }
        if t.name != old.name {
            self.rename_table_refs(&old.name, &t.name);
        }
        self.tables[i] = t.clone();
        out = out.join(self.put_tables(before));
        let fa_old = Area { r1: body_end, ..old.area };
        match self.filter(sheet) {
            Some(f) if f.area == fa_old && !t.button => out = out.join(self.set_filter(sheet, "")?),
            Some(f) if f.area == fa_old && t.filter_area() != fa_old => {
                let fa = t.filter_area();
                let mut text = f.text();
                text = text.replacen(&format!("area\t{},{},{},{}", fa_old.r0, fa_old.c0, fa_old.r1, fa_old.c1), &format!("area\t{},{},{},{}", fa.r0, fa.c0, fa.r1, fa.c1), 1);
                out = out.join(self.set_filter(sheet, &text)?);
            }
            None if t.button => {
                let fa = t.filter_area();
                out = out.join(self.set_filter(sheet, &format!("area\t{},{},{},{}\n", fa.r0, fa.c0, fa.r1, fa.c1))?);
            }
            _ => {}
        }
        self.undo_group(mark);
        Ok(out)
    }

    fn rename_table_refs(&mut self, old: &str, new: &str) {
        for f in self.formulas.values_mut() {
            if let Some(e) = f.ast.as_mut() {
                formula::walk_mut(e, &mut |node| {
                    if let Expr::Table(Some(n), _) = node {
                        if n.eq_ignore_ascii_case(old) {
                            *n = new.to_string();
                        }
                    }
                });
            }
        }
    }

    pub fn remove_table(&mut self, name: &str) -> Result<Effect, EngineError> {
        let i = self.table_named(name).ok_or_else(|| EngineError::BadName(name.to_string()))?;
        let t = self.tables[i].clone();
        let mark = self.undo_mark();
        let mut edits: Vec<(usize, Addr, String)> = Vec::new();
        let keys: Vec<(usize, Addr)> = self.formulas.keys().copied().collect();
        for (s, a) in keys {
            let Some(e) = self.formulas.get(&(s, a)).and_then(|f| f.ast.clone()) else { continue };
            if !formula::has_table(&e) {
                continue;
            }
            let mut e = e;
            let mut changed = false;
            formula::walk_mut(&mut e, &mut |node| {
                if let Expr::Table(n, spec) = node {
                    let mine = match n {
                        Some(n) => n.eq_ignore_ascii_case(&t.name),
                        None => s == t.sheet && hit(t.area, a),
                    };
                    if !mine {
                        return;
                    }
                    let resolved = self.resolve_table(s, n.as_deref(), spec, Some(a));
                    *node = match resolved {
                        Ok((ts, r)) => {
                            let sheet = (ts != s).then(|| self.sheets[ts].name.clone());
                            let c0 = formula::CellRef { row: r.r0, col: r.c0, abs_row: true, abs_col: true };
                            let c1 = formula::CellRef { row: r.r1, col: r.c1, abs_row: true, abs_col: true };
                            Expr::Ref(sheet, if r.r0 == r.r1 && r.c0 == r.c1 { formula::RefKind::Cell(c0) } else { formula::RefKind::Area(c0, c1) })
                        }
                        Err(k) => Expr::Err(k),
                    };
                    changed = true;
                }
            });
            if changed {
                edits.push((s, a, format!("={}", formula::to_text(&e))));
            }
        }
        let mut out = Effect::default();
        for (s, a, raw) in edits {
            out.cells.extend(self.quiet_apply(s, &[(a, raw)])?);
        }
        let before = self.tables.clone();
        self.tables.remove(i);
        out = out.join(self.put_tables(before));
        if self.filter(t.sheet).is_some_and(|f| f.area == t.filter_area()) {
            out = out.join(self.set_filter(t.sheet, "")?);
        }
        self.undo_group(mark);
        Ok(out)
    }

    pub(crate) fn table_hook(&mut self, sheet: usize, edits: &[(Addr, String)]) -> Vec<(usize, Addr)> {
        let mut seeds = Vec::new();
        if self.tables.iter().all(|t| t.sheet != sheet) {
            return seeds;
        }
        let before = self.tables.clone();
        for (a, raw) in edits {
            let Some(i) = self.tables.iter().position(|t| t.sheet == sheet && (hit(t.area, *a) || (!t.totals && a.row == t.area.r1 + 1 && (t.area.c0..=t.area.c1).contains(&a.col)) || (a.col == t.area.c1 + 1 && (t.area.r0..=t.area.r1).contains(&a.row)))) else { continue };
            let mut t = self.tables[i].clone();
            if !hit(t.area, *a) {
                if raw.is_empty() || self.tables.iter().any(|o| o.sheet == sheet && hit(o.area, *a)) {
                    continue;
                }
                let mut g = t.clone();
                if a.row == t.area.r1 + 1 {
                    g.area.r1 += 1;
                    let row = a.row;
                    for (j, calc) in t.calc.iter().enumerate() {
                        let at = Addr { row, col: t.area.c0 + j as u32 };
                        if !calc.is_empty() && at != *a && self.input(sheet, at).is_empty() {
                            let f = formula::offset_text(calc, i64::from(row - t.data().0), 0);
                            self.set_cell_logged(sheet, at, &f);
                            seeds.push((sheet, at));
                        }
                    }
                } else {
                    g.area.c1 += 1;
                    let raw_name = if a.row == t.area.r0 { raw.trim_start_matches('\'').to_string() } else { String::new() };
                    let mut names = g.cols.clone();
                    names.push(raw_name);
                    let names = unique_names(&names);
                    let last = names.last().cloned().unwrap_or_default();
                    if a.row != t.area.r0 {
                        let at = Addr { row: t.area.r0, col: g.area.c1 };
                        self.set_cell_logged(sheet, at, &last);
                        seeds.push((sheet, at));
                    }
                    g.cols = names;
                    g.calc.push(String::new());
                    g.kept.push(String::new());
                }
                let fa_old = t.filter_area();
                self.tables[i] = g.clone();
                if let Some(mut f) = self.filter(sheet).filter(|f| f.area == fa_old) {
                    f.area = g.filter_area();
                    let _ = self.load_filter(sheet, &f.text());
                }
                if a.row == g.area.r0 {
                    continue;
                }
                t = g;
            }
            if a.row == t.area.r0 {
                let raw_names = self.header_texts(sheet, t.area);
                let names = unique_names(&raw_names);
                if names != t.cols {
                    let pairs: Vec<(String, String)> = t.cols.iter().zip(&names).filter(|(o, n)| o != n).map(|(o, n)| (o.clone(), n.clone())).collect();
                    self.rename_col_refs(&t, &pairs);
                    self.tables[i].cols = names;
                }
                continue;
            }
            let (d0, d1) = t.data();
            if edits.len() == 1 && a.row >= d0 && a.row <= d1 && raw.starts_with('=') {
                let j = (a.col - t.area.c0) as usize;
                let others_empty = (d0..=d1).filter(|r| *r != a.row).all(|r| self.input(sheet, Addr { row: r, col: a.col }).is_empty());
                if !t.calc[j].is_empty() || others_empty {
                    let calc = formula::offset_text(raw, -i64::from(a.row - d0), 0);
                    for r in d0..=d1 {
                        if r == a.row {
                            continue;
                        }
                        let at = Addr { row: r, col: a.col };
                        self.set_cell_logged(sheet, at, &formula::offset_text(&calc, i64::from(r - d0), 0));
                        seeds.push((sheet, at));
                    }
                    self.tables[i].calc[j] = calc;
                }
            }
        }
        if before != self.tables {
            self.record(Tx::Tables { before, after: self.tables.clone() });
            self.graph.built = false;
        }
        seeds
    }

    fn set_cell_logged(&mut self, sheet: usize, at: Addr, raw: &str) {
        let before = self.input(sheet, at);
        self.set_raw(sheet, at, raw);
        let after = self.input(sheet, at);
        if before != after {
            self.record(Tx::Cells(vec![crate::Change { sheet, addr: at, before, after }]));
        }
    }

    fn rename_col_refs(&mut self, t: &Table, pairs: &[(String, String)]) {
        let tables = self.tables.clone();
        for ((s, a), f) in self.formulas.iter_mut() {
            let Some(e) = f.ast.as_mut() else { continue };
            formula::walk_mut(e, &mut |node| {
                if let Expr::Table(n, spec) = node {
                    let mine = match n {
                        Some(n) => n.eq_ignore_ascii_case(&t.name),
                        None => *s == t.sheet && tables.iter().any(|x| x.name == t.name && hit(x.area, *a)),
                    };
                    if let (true, Some((x, y))) = (mine, spec.cols.as_mut()) {
                        for (o, nw) in pairs {
                            if x.eq_ignore_ascii_case(o) {
                                *x = nw.clone();
                            }
                            if y.eq_ignore_ascii_case(o) {
                                *y = nw.clone();
                            }
                        }
                    }
                }
            });
        }
    }

    pub(crate) fn shift_tables(&mut self, s: Shift) {
        let mut out = Vec::new();
        for mut t in std::mem::take(&mut self.tables) {
            if t.sheet != s.sheet {
                out.push(t);
                continue;
            }
            let (a0, a1) = if s.rows { (t.area.r0, t.area.r1) } else { (t.area.c0, t.area.c1) };
            let (at, d) = (i64::from(s.at), s.delta);
            if s.rows && d < 0 && i64::from(t.area.r0) >= at && i64::from(t.area.r0) < at - d {
                continue;
            }
            let Some(area) = crate::shift_span_pub(t.area, s) else { continue };
            if !s.rows {
                let (lo, hi) = (i64::from(a0), i64::from(a1));
                if d > 0 && at > lo && at <= hi {
                    let k = (at - lo) as usize;
                    for _ in 0..d {
                        t.cols.insert(k, String::new());
                        t.calc.insert(k, String::new());
                        t.kept.insert(k, String::new());
                    }
                } else if d < 0 {
                    let (x0, x1) = (at.max(lo), (at - d - 1).min(hi));
                    if x0 <= x1 {
                        let (k0, k1) = ((x0 - lo) as usize, (x1 - lo) as usize);
                        t.cols.drain(k0..=k1);
                        t.calc.drain(k0..=k1);
                        t.kept.drain(k0..=k1);
                    }
                }
                if t.cols.is_empty() {
                    continue;
                }
                t.cols = unique_names(&t.cols);
            }
            t.area = area;
            if t.data().0 > t.data().1 || (t.area.c1 - t.area.c0 + 1) as usize != t.cols.len() {
                continue;
            }
            out.push(t);
        }
        self.tables = out;
        self.graph.built = false;
    }
}
