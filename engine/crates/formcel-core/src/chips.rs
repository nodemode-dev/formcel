use crate::wire::{escape, unescape};
use crate::{link, Addr, Effect, EngineError, Key, Tx, Value, Workbook};

pub const KINDS: [&str; 4] = ["person", "file", "date", "place"];
const MAX_PER_CELL: usize = 50;
const MAX_FIELD: usize = 2000;

#[derive(Clone, Debug, PartialEq)]
pub struct Chip {
    pub kind: String,
    pub start: usize,
    pub label: String,
    pub value: String,
    pub tip: String,
}

impl Chip {
    pub fn len(&self) -> usize {
        self.label.chars().count()
    }

    pub fn is_empty(&self) -> bool {
        self.label.is_empty()
    }
}

pub fn parse(text: &str) -> Vec<Chip> {
    let mut out = Vec::new();
    for l in text.split('\n').filter(|l| !l.is_empty()) {
        let p: Vec<String> = l.split('\t').map(unescape).collect();
        if p.len() < 4 || !KINDS.contains(&p[0].as_str()) {
            continue;
        }
        let Ok(start) = p[1].parse::<usize>() else { continue };
        if p[2].is_empty() || p[2].chars().count() > MAX_FIELD || p[3].chars().count() > MAX_FIELD {
            continue;
        }
        out.push(Chip { kind: p[0].clone(), start, label: p[2].clone(), value: p[3].clone(), tip: p.get(4).cloned().unwrap_or_default().chars().take(MAX_FIELD).collect() });
    }
    out
}

pub fn encode(chips: &[Chip]) -> String {
    let mut out = String::new();
    for c in chips {
        if !out.is_empty() {
            out.push('\n');
        }
        escape(&c.kind, &mut out);
        out.push('\t');
        out.push_str(&c.start.to_string());
        out.push('\t');
        escape(&c.label, &mut out);
        out.push('\t');
        escape(&c.value, &mut out);
        out.push('\t');
        escape(&c.tip, &mut out);
    }
    out
}

fn encode_percent(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn link_of(kind: &str, value: &str) -> Option<String> {
    let v = value.trim();
    if v.is_empty() {
        return None;
    }
    match kind {
        "person" => v.contains('@').then(|| link::clean(v)).flatten().filter(|t| t.starts_with("mailto:")),
        "file" => link::clean(v).filter(|t| t.starts_with("http") || t.starts_with("ftp")),
        "place" => link::clean(v).filter(|t| t.starts_with("http")).or_else(|| Some(format!("https://www.google.com/maps/search/?api=1&query={}", encode_percent(v)))),
        _ => None,
    }
}

fn slice(text: &str, start: usize, len: usize) -> String {
    text.chars().skip(start).take(len).collect()
}

fn fit(text: &str, chips: Vec<Chip>) -> Vec<Chip> {
    let total = text.chars().count();
    let mut out: Vec<Chip> = Vec::new();
    let mut cursor = 0;
    let mut chips = chips;
    chips.sort_by_key(|c| c.start);
    for mut c in chips {
        if out.len() >= MAX_PER_CELL {
            break;
        }
        let len = c.len();
        if c.start >= cursor && c.start + len <= total && slice(text, c.start, len) == c.label {
            cursor = c.start + len;
            out.push(c);
            continue;
        }
        let hay: Vec<char> = text.chars().collect();
        let needle: Vec<char> = c.label.chars().collect();
        let found = (cursor..=hay.len().saturating_sub(needle.len())).find(|&i| i + needle.len() <= hay.len() && hay[i..i + needle.len()] == needle[..]);
        if let Some(p) = found {
            c.start = p;
            cursor = p + len;
            out.push(c);
        }
    }
    out
}

impl Workbook {
    fn chip_text(&self, sheet: usize, a: Addr) -> Option<String> {
        let k = (sheet, a);
        if self.formulas.contains_key(&k) {
            return None;
        }
        match self.sheets.get(sheet)?.cells.get(a) {
            Some(Value::Text(t)) => Some(t.to_string()),
            _ => None,
        }
    }

    pub fn chips_of(&self, sheet: usize) -> Vec<(Addr, String)> {
        let mut out: Vec<(Addr, String)> = self.chips.iter().filter(|((s, _), _)| *s == sheet).map(|((_, a), t)| (*a, t.clone())).collect();
        out.sort_by_key(|(a, _)| (a.row, a.col));
        out
    }

    pub fn chip_at(&self, sheet: usize, a: Addr) -> Option<String> {
        self.chips.get(&(sheet, a)).cloned()
    }

    pub fn chip_links(&self, sheet: usize) -> Vec<(Addr, String)> {
        let mut out = Vec::new();
        for (a, text) in self.chips_of(sheet) {
            if let Some(t) = parse(&text).iter().find_map(|c| link_of(&c.kind, &c.value)) {
                out.push((a, t));
            }
        }
        out
    }

    pub fn load_chips(&mut self, sheet: usize, cells: &[(Addr, String)]) -> Result<usize, EngineError> {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        let mut n = 0;
        for (a, t) in cells {
            let kept = self.chip_text(sheet, *a).map(|text| fit(&text, parse(t))).unwrap_or_default();
            if kept.is_empty() {
                self.chips.remove(&(sheet, *a));
            } else {
                self.chips.insert((sheet, *a), encode(&kept));
                n += 1;
            }
        }
        Ok(n)
    }

    pub(crate) fn apply_chips(&mut self, changes: &[(Key, Option<String>, Option<String>)], forward: bool) -> Effect {
        let mut cells = Vec::new();
        for (k, before, after) in changes {
            let to = if forward { after } else { before };
            match to {
                Some(t) => {
                    self.chips.insert(*k, t.clone());
                }
                None => {
                    self.chips.remove(k);
                }
            }
            self.chip_log.push((k.0, k.1, to.clone().unwrap_or_default()));
            if let Some(v) = self.sheets[k.0].cells.get(k.1) {
                cells.push((k.0, k.1, v.clone()));
            }
        }
        Effect { cells, ..Effect::default() }
    }

    pub fn take_chip_changes(&mut self) -> Vec<(usize, Addr, String)> {
        std::mem::take(&mut self.chip_log)
    }

    pub fn set_chips(&mut self, sheet: usize, a: Addr, text: &str) -> Result<Effect, EngineError> {
        self.check(sheet, a)?;
        let k = (sheet, a);
        let after = self.chip_text(sheet, a).map(|t| fit(&t, parse(text))).filter(|c| !c.is_empty()).map(|c| encode(&c));
        let before = self.chips.get(&k).cloned();
        if before == after {
            return Ok(Effect::default());
        }
        let change = vec![(k, before, after)];
        let e = self.apply_chips(&change, true);
        self.record(Tx::Chips(change));
        Ok(Effect { cells: self.present(e.cells), ..e })
    }

    pub(crate) fn refresh_chips(&mut self, sheet: usize, edited: &[Addr]) {
        if self.chips.is_empty() {
            return;
        }
        let mut changes = Vec::new();
        for a in edited {
            let k = (sheet, *a);
            let Some(before) = self.chips.get(&k).cloned() else { continue };
            let after = self.chip_text(sheet, *a).map(|t| fit(&t, parse(&before))).filter(|c| !c.is_empty()).map(|c| encode(&c));
            if Some(&before) != after.as_ref() {
                changes.push((k, Some(before), after));
            }
        }
        if !changes.is_empty() {
            self.apply_chips(&changes, true);
            self.record(Tx::Chips(changes));
        }
    }

    pub(crate) fn move_chips(&mut self, sheet: usize, moved: &dyn Fn(Addr) -> Option<Addr>) -> Vec<(Key, Option<String>, Option<String>)> {
        let mut lost = Vec::new();
        let list: Vec<(Key, String)> = self.chips.iter().filter(|((sh, _), _)| *sh == sheet).map(|(k, t)| (*k, t.clone())).collect();
        for (k, _) in &list {
            self.chips.remove(k);
            self.chip_log.push((k.0, k.1, String::new()));
        }
        for ((sh, a), t) in list {
            match moved(a) {
                Some(b) => {
                    self.chip_log.push((sh, b, t.clone()));
                    self.chips.insert((sh, b), t);
                }
                None => lost.push(((sh, a), Some(t), None)),
            }
        }
        lost
    }
}
