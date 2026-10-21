use crate::{Addr, Changed, Value};

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

fn line(out: &mut String, a: Addr, v: &Value) {
    out.push_str(&a.row.to_string());
    out.push('\t');
    out.push_str(&a.col.to_string());
    out.push('\t');
    escape(&v.to_string(), out);
    out.push('\n');
}

pub fn encode_cells(cells: &[(Addr, Value)]) -> String {
    let mut out = String::new();
    for (a, v) in cells {
        line(&mut out, *a, v);
    }
    out
}

pub fn encode_changed(changed: &Changed) -> String {
    let mut out = String::new();
    for (sheet, a, v) in changed {
        out.push_str(&sheet.to_string());
        out.push('\t');
        line(&mut out, *a, v);
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
