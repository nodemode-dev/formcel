use crate::{Addr, Changed, Effect, Shift, Value};

pub fn encode_shift(s: &Shift) -> String {
    format!("#\t{}\t{}\t{}\t{}\n", s.sheet, if s.rows { 'r' } else { 'c' }, s.at, s.delta)
}

pub type Meta = (Option<String>, bool, Option<u32>, bool);
pub type FxOf<'a> = &'a dyn Fn(usize, Addr) -> Meta;

pub fn encode_styles(tag: char, sheet: Option<usize>, styles: &[(usize, Addr, String)]) -> String {
    let mut out = String::new();
    for (s, a, text) in styles {
        out.push(tag);
        out.push('\t');
        if sheet.is_none() {
            out.push_str(&format!("{s}\t"));
        }
        out.push_str(&format!("{}\t{}\t", a.row, a.col));
        escape(text, &mut out);
        out.push('\n');
    }
    out
}

pub fn encode_formats(formats: &[(usize, Addr, String)]) -> String {
    let mut out = String::new();
    for (s, a, code) in formats {
        out.push_str(&format!("%\t{}\t{}\t{}\t", s, a.row, a.col));
        escape(code, &mut out);
        out.push('\n');
    }
    out
}

pub fn encode_effect(e: &Effect, fx: FxOf, shown: &dyn Fn(usize, Addr) -> String) -> String {
    let mut out = e.shift.as_ref().map(encode_shift).unwrap_or_default();
    if let Some(s) = e.merges {
        out.push_str(&format!("=\t{s}\n"));
    }
    if e.theme {
        out.push_str("^\n");
    }
    if let Some(s) = e.rules {
        out.push_str(&format!("!\t{s}\n"));
    }
    if let Some(s) = e.filter {
        out.push_str(&format!("~\t{s}\n"));
    }
    if let Some(s) = e.valid {
        out.push_str(&format!("?\t{s}\n"));
    }
    if e.tables {
        out.push_str("*\n");
    }
    if e.named {
        out.push_str("@\n");
    }
    out.push_str(&encode_formats(&e.formats));
    for (s, a, raw) in &e.styles {
        out.push_str(&format!("&\t{s}\t{}\t{}\t", a.row, a.col));
        escape(raw, &mut out);
        out.push('\t');
        escape(&shown(*s, *a), &mut out);
        out.push('\n');
    }
    out.push_str(&encode_changed(&e.cells, fx));
    out
}

pub fn escape(s: &str, out: &mut String) {
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c => out.push(c),
        }
    }
}

pub fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some(o) => out.push(o),
            None => out.push('\\'),
        }
    }
    out
}

fn line(out: &mut String, a: Addr, v: &Value, (fx, num, color, link): Meta) {
    out.push_str(&a.row.to_string());
    out.push('\t');
    out.push_str(&a.col.to_string());
    out.push('\t');
    if num {
        out.push('n');
    }
    if link {
        out.push('l');
    }
    if let Some(c) = color {
        out.push_str(&format!("c{c:06x}"));
    }
    out.push('\t');
    escape(&v.to_string(), out);
    if let Some(f) = fx {
        out.push('\t');
        escape(&f, out);
    }
    out.push('\n');
}

pub fn encode_cells(sheet: usize, cells: &[(Addr, Value)], fx: FxOf) -> String {
    let mut out = String::new();
    for (a, v) in cells {
        line(&mut out, *a, v, fx(sheet, *a));
    }
    out
}

pub fn encode_changed(changed: &Changed, fx: FxOf) -> String {
    let mut out = String::new();
    for (sheet, a, v) in changed {
        out.push_str(&sheet.to_string());
        out.push('\t');
        line(&mut out, *a, v, fx(*sheet, *a));
    }
    out
}

pub fn decode_edits(s: &str) -> Option<Vec<(Addr, String)>> {
    let mut out = Vec::new();
    for l in s.split('\n').filter(|l| !l.is_empty()) {
        let mut p = l.splitn(3, '\t');
        let row = p.next()?.parse().ok()?;
        let col = p.next()?.parse().ok()?;
        out.push((Addr { row, col }, unescape(p.next().unwrap_or(""))));
    }
    Some(out)
}
