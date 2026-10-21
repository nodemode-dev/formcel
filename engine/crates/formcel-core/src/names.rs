use crate::eval::{Eval, Out};
use crate::formula::{self, Area, Expr, RefKind};
use crate::{col_name, Addr, Changed, EngineError, Value, Workbook};

#[derive(Clone, Debug, Default)]
pub struct NameRow {
    pub name: String,
    pub scope: String,
    pub refers: String,
    pub comment: String,
    pub value: String,
}

pub(crate) fn quote_sheet(name: &str) -> String {
    let plain = !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') && !name.chars().next().is_some_and(|c| c.is_ascii_digit());
    if plain {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

pub(crate) fn split_scope(full: &str) -> (Option<String>, String) {
    let t = full.trim();
    if let Some(rest) = t.strip_prefix('\'') {
        let cs: Vec<char> = rest.chars().collect();
        let mut i = 0;
        let mut sheet = String::new();
        while i < cs.len() {
            if cs[i] == '\'' {
                if cs.get(i + 1) == Some(&'\'') {
                    sheet.push('\'');
                    i += 2;
                    continue;
                }
                if cs.get(i + 1) == Some(&'!') {
                    return (Some(sheet), cs[i + 2..].iter().collect());
                }
                break;
            }
            sheet.push(cs[i]);
            i += 1;
        }
        return (None, t.to_string());
    }
    match t.rsplit_once('!') {
        Some((s, n)) if !s.is_empty() => (Some(s.to_string()), n.to_string()),
        _ => (None, t.to_string()),
    }
}

fn scoped_key(sheet: &str, local: &str) -> String {
    format!("{}!{}", sheet.to_ascii_uppercase(), local.to_ascii_uppercase())
}

pub(crate) fn rename_uses(e: &mut Expr, old: &str, new: &str) -> bool {
    let mut changed = false;
    formula::walk_mut(e, &mut |node| match node {
        Expr::Name(n) | Expr::Call(n, _) if n.eq_ignore_ascii_case(old) => {
            *n = new.to_string();
            changed = true;
        }
        _ => {}
    });
    changed
}

fn label_name(label: &str) -> Option<String> {
    let mut out = String::new();
    for c in label.trim().chars() {
        if c.is_alphanumeric() || c == '_' || c == '.' || c == '\\' {
            out.push(c);
        } else if c.is_whitespace() || c == '-' || c == '/' {
            out.push('_');
        }
    }
    if out.is_empty() {
        return None;
    }
    if !formula::valid_name(&out) {
        out.insert(0, '_');
    }
    formula::valid_name(&out).then_some(out)
}

fn abs_ref(sheet: &str, a: Area) -> String {
    let cell = |r: u32, c: u32| format!("${}${}", col_name(c), r + 1);
    if a.r0 == a.r1 && a.c0 == a.c1 {
        format!("={}!{}", quote_sheet(sheet), cell(a.r0, a.c0))
    } else {
        format!("={}!{}:{}", quote_sheet(sheet), cell(a.r0, a.c0), cell(a.r1, a.c1))
    }
}

fn node_area(kind: &RefKind) -> Option<(Area, bool)> {
    match kind {
        RefKind::Cell(c) => Some((Area { r0: c.row, c0: c.col, r1: c.row, c1: c.col }, c.abs_row && c.abs_col)),
        RefKind::Area(a, b) => Some((
            Area { r0: a.row.min(b.row), c0: a.col.min(b.col), r1: a.row.max(b.row), c1: a.col.max(b.col) },
            a.abs_row && a.abs_col && b.abs_row && b.abs_col,
        )),
        _ => None,
    }
}

impl Workbook {
    pub(crate) fn lookup_name(&self, sheet: usize, upper: &str) -> Option<&(String, Expr)> {
        if self.names.is_empty() {
            return None;
        }
        if let Some(s) = self.sheets.get(sheet) {
            if let Some(n) = self.names.get(&scoped_key(&s.name, upper)) {
                return Some(n);
            }
        }
        self.names.get(&upper.to_ascii_uppercase())
    }

    pub(crate) fn name_key(&self, full: &str) -> Result<(String, String, String), EngineError> {
        let (scope, local) = split_scope(full);
        if !formula::valid_name(&local) {
            return Err(EngineError::BadName(full.to_string()));
        }
        match scope {
            None => Ok((local.to_ascii_uppercase(), local.clone(), local)),
            Some(s) => {
                let i = self.sheet_by_name(&s).ok_or_else(|| EngineError::BadName(full.to_string()))?;
                let sheet = &self.sheets[i].name;
                Ok((scoped_key(sheet, &local), format!("{}!{}", quote_sheet(sheet), local), local))
            }
        }
    }

    pub(crate) fn drop_sheet_names(&mut self, sheet_name: &str) {
        let prefix = format!("{}!", sheet_name.to_ascii_uppercase());
        self.names.retain(|k, _| !k.starts_with(&prefix));
        self.name_notes.retain(|k, _| !k.starts_with(&prefix));
    }

    pub(crate) fn rekey_sheet_names(&mut self, old: &str, new: &str) {
        let prefix = format!("{}!", old.to_ascii_uppercase());
        let moved: Vec<String> = self.names.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
        for k in moved {
            let local = k[prefix.len()..].to_string();
            let nk = format!("{}!{}", new.to_ascii_uppercase(), local);
            if let Some((disp, e)) = self.names.remove(&k) {
                let (_, l) = split_scope(&disp);
                self.names.insert(nk.clone(), (format!("{}!{}", quote_sheet(new), l), e));
            }
            if let Some(n) = self.name_notes.remove(&k) {
                self.name_notes.insert(nk, n);
            }
        }
    }

    pub fn name_rows(&self) -> Vec<NameRow> {
        let mut rows: Vec<NameRow> = self
            .names
            .iter()
            .map(|(key, (disp, e))| {
                let (scope, local) = split_scope(disp);
                let at = scope.as_ref().and_then(|s| self.sheet_by_name(s)).unwrap_or(0);
                let value = match Eval::new(self, at).formula(e) {
                    Out::V(Value::Error(k)) => k.text().to_string(),
                    Out::V(v) => v.to_string(),
                    Out::A(a) => format!("{{{}}}", a.data.first().map_or(String::new(), |v| v.to_string())),
                };
                NameRow { name: local, scope: scope.unwrap_or_default(), refers: format!("={}", formula::to_text(e)), comment: self.name_notes.get(key).cloned().unwrap_or_default(), value }
            })
            .collect();
        rows.sort_by(|a, b| a.name.to_ascii_uppercase().cmp(&b.name.to_ascii_uppercase()).then_with(|| a.scope.cmp(&b.scope)));
        rows
    }

    pub fn name_tool_wire(&mut self, op: &str, line: &str) -> String {
        let args: Vec<String> = line.split('\t').map(crate::wire::unescape).collect();
        match self.name_tool(op, &args) {
            Ok(s) => format!("o{s}"),
            Err(m) => format!("e{m}"),
        }
    }

    pub fn name_tool(&mut self, op: &str, args: &[String]) -> Result<String, String> {
        let num = |i: usize| args.get(i).and_then(|s| s.parse::<u32>().ok()).ok_or_else(|| "bad argument".to_string());
        let arg = |i: usize| args.get(i).cloned().unwrap_or_default();
        let e = |x: EngineError| x.to_string();
        let mut out = String::new();
        match op {
            "rows" => {
                for r in self.name_rows() {
                    for (i, f) in [&r.name, &r.scope, &r.refers, &r.comment, &r.value].into_iter().enumerate() {
                        if i > 0 {
                            out.push('\t');
                        }
                        crate::wire::escape(f, &mut out);
                    }
                    out.push('\n');
                }
            }
            "comment" => self.set_name_comment(&arg(0), &arg(1)).map_err(e)?,
            "rename" => {
                let c = self.rename_name(&arg(0), &arg(1)).map_err(e)?;
                out = crate::wire::encode_changed(&c, &|s, a| self.meta(s, a));
            }
            "select" => {
                let area = Area { r0: num(1)?, c0: num(2)?, r1: num(3)?, c1: num(4)? };
                let flags = arg(5);
                let on = |i: usize| flags.as_bytes().get(i) == Some(&b'1');
                let (made, skipped) = self.names_from_selection(num(0)? as usize, area, on(0), on(1), on(2), on(3), on(4)).map_err(e)?;
                for m in made {
                    out.push_str(&format!("+\t{m}\n"));
                }
                for s in skipped {
                    out.push_str("-\t");
                    crate::wire::escape(&s, &mut out);
                    out.push('\n');
                }
            }
            "apply" => {
                let region = (arg(1) == "1").then(|| Ok::<_, String>((num(0)? as usize, Area { r0: num(2)?, c0: num(3)?, r1: num(4)?, c1: num(5)? }))).transpose()?;
                let names: Vec<String> = args.iter().skip(7).cloned().collect();
                let (n, c) = self.apply_names(region, &names, arg(6) != "0").map_err(e)?;
                out = format!("{n}\n{}", crate::wire::encode_changed(&c, &|s, a| self.meta(s, a)));
            }
            "file" => self.set_file_name(&arg(0), &arg(1)),
            "eval" => {
                let (sheet, at) = (num(0)? as usize, Addr { row: num(1)?, col: num(2)? });
                let text = arg(3);
                if text.trim().is_empty() {
                    return Ok(String::new());
                }
                let e = formula::parse(text.trim().trim_start_matches('=')).ok_or_else(|| "That is not a formula FormCel can read.".to_string())?;
                let shown = |v: &Value| match v {
                    Value::Text(t) => format!("\"{t}\""),
                    Value::Error(k) => k.text().to_string(),
                    o => o.to_string(),
                };
                out = match Eval::new(self, sheet).placed(at).formula(&e) {
                    Out::V(v) => match v {
                        Value::Text(t) if arg(4) != "1" => t,
                        other => shown(&other),
                    },
                    Out::A(a) => {
                        let rows: Vec<String> = (0..a.rows).map(|r| (0..a.cols).map(|c| shown(&a.data[r * a.cols + c])).collect::<Vec<_>>().join(",")).collect();
                        format!("{{{}}}", rows.join(";"))
                    }
                };
            }
            "notes" => {
                for (n, c) in self.name_notes() {
                    crate::wire::escape(&n, &mut out);
                    out.push('\t');
                    crate::wire::escape(&c, &mut out);
                    out.push('\n');
                }
            }
            _ => return Err("unknown name operation".to_string()),
        }
        Ok(out)
    }

    pub fn name_notes(&self) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = self.name_notes.iter().filter_map(|(k, n)| self.names.get(k).map(|(d, _)| (d.clone(), n.clone()))).collect();
        out.sort();
        out
    }

    pub fn set_name_comment(&mut self, name: &str, comment: &str) -> Result<(), EngineError> {
        let (key, _, _) = self.name_key(name)?;
        if !self.names.contains_key(&key) {
            return Err(EngineError::BadName(name.to_string()));
        }
        if comment.is_empty() {
            self.name_notes.remove(&key);
        } else {
            self.name_notes.insert(key, comment.chars().take(255).collect());
        }
        Ok(())
    }

    pub fn rename_name(&mut self, old: &str, new: &str) -> Result<Changed, EngineError> {
        let (okey, _, olocal) = self.name_key(old)?;
        let (nkey, ndisp, nlocal) = self.name_key(new)?;
        if !self.names.contains_key(&okey) || (nkey != okey && self.names.contains_key(&nkey)) {
            return Err(EngineError::BadName(new.to_string()));
        }
        let scope_sheet = split_scope(old).0.and_then(|s| self.sheet_by_name(&s));
        let mut by_sheet: Vec<Vec<(Addr, String)>> = vec![Vec::new(); self.sheets.len()];
        for ((sh, a), f) in &self.formulas {
            if scope_sheet.is_some_and(|s| s != *sh) {
                continue;
            }
            if scope_sheet.is_none() && self.sheets.get(*sh).is_some_and(|s| self.names.contains_key(&scoped_key(&s.name, &olocal))) {
                continue;
            }
            if let Some(e) = &f.ast {
                let mut c = e.clone();
                if rename_uses(&mut c, &olocal, &nlocal) {
                    by_sheet[*sh].push((*a, format!("={}", formula::to_text(&c))));
                }
            }
        }
        let (_, mut expr) = self.names.remove(&okey).ok_or_else(|| EngineError::BadName(old.to_string()))?;
        rename_uses(&mut expr, &olocal, &nlocal);
        for (_, e) in self.names.values_mut() {
            rename_uses(e, &olocal, &nlocal);
        }
        self.names.insert(nkey.clone(), (ndisp, expr));
        if let Some(n) = self.name_notes.remove(&okey) {
            self.name_notes.insert(nkey, n);
        }
        self.graph.built = false;
        let mut changed = Vec::new();
        for (sh, edits) in by_sheet.iter().enumerate() {
            if !edits.is_empty() {
                changed.extend(self.apply(sh, edits)?);
            }
        }
        changed.extend(self.recalc_all());
        Ok(self.present(changed))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn names_from_selection(&mut self, sheet: usize, area: Area, top: bool, left: bool, bottom: bool, right: bool, replace: bool) -> Result<(Vec<String>, Vec<String>), EngineError> {
        let sname = self.sheets.get(sheet).ok_or(EngineError::NoSheet(sheet))?.name.clone();
        let (r0, r1) = (area.r0 + u32::from(top), area.r1.saturating_sub(u32::from(bottom)));
        let (c0, c1) = (area.c0 + u32::from(left), area.c1.saturating_sub(u32::from(right)));
        if r0 > r1 || c0 > c1 || (area.r1 - area.r0 < u32::from(top) + u32::from(bottom)) || (area.c1 - area.c0 < u32::from(left) + u32::from(right)) {
            return Err(EngineError::BadAddress("The selection has no cells besides its labels.".to_string()));
        }
        let mut plan: Vec<(Addr, Area)> = Vec::new();
        for c in c0..=c1 {
            if top {
                plan.push((Addr { row: area.r0, col: c }, Area { r0, c0: c, r1, c1: c }));
            }
            if bottom {
                plan.push((Addr { row: area.r1, col: c }, Area { r0, c0: c, r1, c1: c }));
            }
        }
        for r in r0..=r1 {
            if left {
                plan.push((Addr { row: r, col: area.c0 }, Area { r0: r, c0, r1: r, c1 }));
            }
            if right {
                plan.push((Addr { row: r, col: area.c1 }, Area { r0: r, c0, r1: r, c1 }));
            }
        }
        let mut made = Vec::new();
        let mut skipped = Vec::new();
        for (label, target) in plan {
            let text = self.sheets[sheet].cells.get(label).map(|v| v.to_string()).unwrap_or_default();
            let Some(name) = label_name(&text) else {
                if !text.trim().is_empty() {
                    skipped.push(text);
                }
                continue;
            };
            let key = name.to_ascii_uppercase();
            if self.names.contains_key(&key) && (!replace || made.iter().any(|m: &String| m.eq_ignore_ascii_case(&name))) {
                skipped.push(name);
                continue;
            }
            let Some(e) = formula::parse(abs_ref(&sname, target).trim_start_matches('=')) else { continue };
            self.names.insert(key, (name.clone(), e));
            made.push(name);
        }
        self.graph.built = false;
        self.recalc_all();
        Ok((made, skipped))
    }

    pub fn apply_names(&mut self, region: Option<(usize, Area)>, names: &[String], ignore_abs: bool) -> Result<(usize, Changed), EngineError> {
        struct Cand {
            sheet: usize,
            area: Area,
            local: String,
            only: Option<usize>,
        }
        let mut cands: Vec<Cand> = Vec::new();
        for full in names {
            let (key, _, local) = self.name_key(full)?;
            let Some((_, e)) = self.names.get(&key) else { continue };
            let mut head = e;
            while let Expr::Paren(x) = head {
                head = x;
            }
            let Expr::Ref(s, kind) = head else { continue };
            let only = split_scope(full).0.and_then(|s| self.sheet_by_name(&s));
            let Some(idx) = s.as_ref().and_then(|n| self.sheet_by_name(n)).or(only) else { continue };
            let Some((area, _)) = node_area(kind) else { continue };
            cands.push(Cand { sheet: idx, area, local, only });
        }
        let mut by_sheet: Vec<Vec<(Addr, String)>> = vec![Vec::new(); self.sheets.len()];
        let mut count = 0;
        for ((sh, a), f) in &self.formulas {
            if let Some((rs, ra)) = region {
                if rs != *sh || !ra.contains(a.row, a.col) {
                    continue;
                }
            }
            let Some(e) = &f.ast else { continue };
            let mut c = e.clone();
            let mut hit = false;
            formula::walk_mut(&mut c, &mut |node| {
                let Expr::Ref(s, kind) = node else { return };
                let Some((area, abs)) = node_area(kind) else { return };
                if !ignore_abs && !abs {
                    return;
                }
                let idx = match s {
                    None => Some(*sh),
                    Some(n) => self.sheets.iter().position(|x| x.name.eq_ignore_ascii_case(n)),
                };
                if let Some(cd) = cands.iter().find(|cd| Some(cd.sheet) == idx && cd.area == area && cd.only.is_none_or(|o| o == *sh)) {
                    *node = Expr::Name(cd.local.clone());
                    hit = true;
                }
            });
            if hit {
                by_sheet[*sh].push((*a, format!("={}", formula::to_text(&c))));
                count += 1;
            }
        }
        let mut changed = Vec::new();
        for (sh, edits) in by_sheet.iter().enumerate() {
            if !edits.is_empty() {
                changed.extend(self.apply(sh, edits)?);
            }
        }
        Ok((count, changed))
    }
}
