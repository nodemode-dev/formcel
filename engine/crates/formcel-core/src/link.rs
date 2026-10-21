use crate::formula::Expr;
use crate::{eval, Addr, Effect, EngineError, Key, Tx, Value, Workbook};

const SCHEMES: [&str; 4] = ["http://", "https://", "mailto:", "ftp://"];

pub fn clean(target: &str) -> Option<String> {
    let t = target.trim();
    if t.is_empty() || t.chars().any(|c| c.is_control()) || t.len() > 2048 {
        return None;
    }
    if t.starts_with('#') {
        return (t.len() > 1).then(|| t.to_string());
    }
    let lower = t.to_ascii_lowercase();
    if SCHEMES.iter().any(|s| lower.starts_with(s)) {
        return Some(t.to_string());
    }
    if !lower.contains("://") && !lower.contains(':') && lower.contains('.') && !t.contains(' ') {
        return Some(if is_email(t) { format!("mailto:{t}") } else { format!("http://{t}") });
    }
    None
}

fn is_email(t: &str) -> bool {
    let Some((user, host)) = t.split_once('@') else { return false };
    !user.is_empty() && host.contains('.') && !host.starts_with('.') && !host.ends_with('.') && !t.contains(' ')
}

pub fn detect(text: &str) -> Option<String> {
    let t = text.trim();
    if t.contains(char::is_whitespace) || t.starts_with('=') {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("ftp://") {
        return (t.len() > lower.find("://").unwrap_or(0) + 3).then(|| t.to_string());
    }
    if lower.starts_with("www.") && t.len() > 4 {
        return Some(format!("http://{t}"));
    }
    if lower.starts_with("mailto:") && is_email(&t[7..]) {
        return Some(t.to_string());
    }
    is_email(t).then(|| format!("mailto:{t}"))
}

impl Workbook {
    pub(crate) fn formula_link(&self, k: &Key) -> Option<String> {
        let f = self.formulas.get(k)?;
        let Some(Expr::Call(name, args)) = f.ast.as_ref() else { return None };
        if name != "HYPERLINK" || args.is_empty() {
            return None;
        }
        match eval::Eval::new(self, k.0).scalar(&args[0]) {
            Value::Error(_) | Value::Empty => None,
            v => clean(&v.to_string()),
        }
    }

    pub fn has_link(&self, sheet: usize, a: Addr) -> bool {
        let k = (sheet, a);
        self.links.contains_key(&k) || self.formulas.get(&k).is_some_and(|f| matches!(f.ast.as_ref(), Some(Expr::Call(n, _)) if n == "HYPERLINK"))
    }

    pub fn link_at(&self, sheet: usize, a: Addr) -> Option<String> {
        let k = (sheet, a);
        self.formula_link(&k).or_else(|| self.links.get(&k).cloned())
    }

    pub fn links(&self, sheet: usize) -> Vec<(Addr, String)> {
        let mut out: Vec<(Addr, String)> = self.links.iter().filter(|((s, _), _)| *s == sheet).map(|((_, a), t)| (*a, t.clone())).collect();
        out.sort_by_key(|(a, _)| (a.row, a.col));
        out
    }

    pub fn load_links(&mut self, sheet: usize, cells: &[(Addr, String)]) -> Result<usize, EngineError> {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        let mut n = 0;
        for (a, t) in cells {
            if let Some(t) = clean(t) {
                self.links.insert((sheet, *a), t);
                n += 1;
            } else {
                self.links.remove(&(sheet, *a));
            }
        }
        Ok(n)
    }

    pub(crate) fn apply_links(&mut self, changes: &[(Key, Option<String>, Option<String>)], forward: bool) -> Effect {
        let mut cells = Vec::new();
        for (k, before, after) in changes {
            let to = if forward { after } else { before };
            match to {
                Some(t) => {
                    self.links.insert(*k, t.clone());
                }
                None => {
                    self.links.remove(k);
                }
            }
            self.link_log.push((k.0, k.1, to.clone().unwrap_or_default()));
            if let Some(v) = self.sheets[k.0].cells.get(k.1) {
                cells.push((k.0, k.1, v.clone()));
            }
        }
        Effect { cells, ..Effect::default() }
    }

    pub fn take_link_changes(&mut self) -> Vec<(usize, Addr, String)> {
        std::mem::take(&mut self.link_log)
    }

    pub(crate) fn auto_links(&mut self, sheet: usize, edited: &[Addr]) {
        let mut changes = Vec::new();
        for a in edited {
            let k = (sheet, *a);
            let before = self.links.get(&k).cloned();
            let value = self.sheets[sheet].cells.get(*a).cloned();
            let after = match &value {
                None | Some(Value::Empty) => None,
                Some(Value::Text(t)) if !self.formulas.contains_key(&k) => before.clone().or_else(|| detect(t)),
                _ => before.clone(),
            };
            if before != after {
                changes.push((k, before, after));
            }
        }
        if !changes.is_empty() {
            self.apply_links(&changes, true);
            self.record(Tx::Links(changes));
        }
    }

    pub fn set_link(&mut self, sheet: usize, a: Addr, target: &str, display: Option<&str>) -> Result<Effect, EngineError> {
        self.check(sheet, a)?;
        let target = clean(target).ok_or_else(|| EngineError::BadStyle(target.to_string()))?;
        let mark = self.undo_mark();
        let mut out = Effect::default();
        if let Some(d) = display.filter(|d| *d != self.input(sheet, a)) {
            out.cells = self.apply(sheet, &[(a, d.to_string())])?;
        } else if self.input(sheet, a).is_empty() {
            out.cells = self.apply(sheet, &[(a, target.trim_start_matches("mailto:").to_string())])?;
        }
        let k = (sheet, a);
        let before = self.links.get(&k).cloned();
        if before.as_deref() != Some(target.as_str()) {
            let change = vec![(k, before, Some(target))];
            let e = self.apply_links(&change, true);
            self.record(Tx::Links(change));
            out = out.join(Effect { cells: self.present(e.cells), ..e });
        }
        self.undo_group(mark);
        Ok(out)
    }

    pub fn remove_links(&mut self, sheet: usize, top: Addr, bottom: Addr) -> Result<Effect, EngineError> {
        self.check(sheet, top)?;
        self.check(sheet, bottom)?;
        let (r0, r1, c0, c1) = (top.row.min(bottom.row), top.row.max(bottom.row), top.col.min(bottom.col), top.col.max(bottom.col));
        let changes: Vec<(Key, Option<String>, Option<String>)> = self
            .links
            .iter()
            .filter(|((s, a), _)| *s == sheet && a.row >= r0 && a.row <= r1 && a.col >= c0 && a.col <= c1)
            .map(|(k, t)| (*k, Some(t.clone()), None))
            .collect();
        let e = self.apply_links(&changes, true);
        if !changes.is_empty() {
            self.record(Tx::Links(changes));
        }
        Ok(Effect { cells: self.present(e.cells), ..e })
    }
}
