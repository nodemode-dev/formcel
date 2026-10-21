use crate::formula::{self, CellRef, Expr, RefKind};
use crate::{col_name, Addr, MAX_COLS, MAX_ROWS};

fn part(letter: char, idx: u32, abs: bool, base: u32, out: &mut String) {
    out.push(letter);
    if abs {
        out.push_str(&(idx + 1).to_string());
    } else {
        let d = i64::from(idx) - i64::from(base);
        if d != 0 {
            out.push_str(&format!("[{d}]"));
        }
    }
}

fn cell_text(c: CellRef, at: Addr, out: &mut String) {
    part('R', c.row, c.abs_row, at.row, out);
    part('C', c.col, c.abs_col, at.col, out);
}

pub fn ref_text(kind: RefKind, at: Addr) -> String {
    let mut out = String::new();
    match kind {
        RefKind::Cell(c) => cell_text(c, at, &mut out),
        RefKind::Area(a, b) => {
            cell_text(a, at, &mut out);
            out.push(':');
            cell_text(b, at, &mut out);
        }
        RefKind::Cols(a, aa, b, ab) => {
            part('C', a, aa, at.col, &mut out);
            out.push(':');
            part('C', b, ab, at.col, &mut out);
        }
        RefKind::Rows(a, aa, b, ab) => {
            part('R', a, aa, at.row, &mut out);
            out.push(':');
            part('R', b, ab, at.row, &mut out);
        }
    }
    out
}

pub fn to_r1c1(formula_text: &str, at: Addr) -> String {
    let body = formula_text.trim_start().strip_prefix('=').unwrap_or(formula_text);
    let Some(mut e) = formula::parse(body) else { return formula_text.to_string() };
    formula::walk_mut(&mut e, &mut |node| {
        if let Expr::Ref(sheet, kind) = node {
            let mut t = String::new();
            if let Some(s) = sheet {
                formula::sheet_text(s, &mut t);
            }
            t.push_str(&ref_text(*kind, at));
            *node = Expr::Name(t);
        }
    });
    format!("={}", formula::to_text(&e))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Axis {
    Row,
    Col,
}

#[derive(Clone, Copy)]
struct Piece {
    idx: i64,
    abs: bool,
}

struct Token {
    row: Option<Piece>,
    col: Option<Piece>,
    end: usize,
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '.' || c == '\\'
}

fn piece(s: &[char], i: &mut usize, letter: char) -> Option<Option<Piece>> {
    if !s.get(*i).is_some_and(|c| c.to_ascii_uppercase() == letter) {
        return Some(None);
    }
    let mut j = *i + 1;
    let out = match s.get(j) {
        Some('[') => {
            j += 1;
            let st = j;
            if s.get(j) == Some(&'-') || s.get(j) == Some(&'+') {
                j += 1;
            }
            let ds = j;
            while s.get(j).is_some_and(char::is_ascii_digit) {
                j += 1;
            }
            if j == ds || s.get(j) != Some(&']') {
                return None;
            }
            let n: i64 = s[st..j].iter().collect::<String>().parse().ok()?;
            j += 1;
            Piece { idx: n, abs: false }
        }
        Some(d) if d.is_ascii_digit() => {
            let st = j;
            while s.get(j).is_some_and(char::is_ascii_digit) {
                j += 1;
            }
            let n: i64 = s[st..j].iter().collect::<String>().parse().ok()?;
            if n < 1 {
                return None;
            }
            Piece { idx: n - 1, abs: true }
        }
        _ => Piece { idx: 0, abs: false },
    };
    *i = j;
    Some(Some(out))
}

fn token_at(s: &[char], start: usize) -> Option<Token> {
    let mut i = start;
    let row = piece(s, &mut i, 'R')?;
    let col = piece(s, &mut i, 'C')?;
    if row.is_none() && col.is_none() {
        return None;
    }
    if s.get(i).is_some_and(|c| is_word(*c) || *c == '(' || *c == '[' || *c == '!') {
        return None;
    }
    Some(Token { row, col, end: i })
}

fn resolve(p: Piece, base: u32, limit: u32) -> Option<u32> {
    let v = if p.abs { p.idx } else { i64::from(base) + p.idx };
    (v >= 0 && v < i64::from(limit)).then_some(v as u32)
}

fn a1_axis(p: Piece, base: u32, axis: Axis) -> Option<String> {
    let limit = if axis == Axis::Row { MAX_ROWS } else { MAX_COLS };
    let v = resolve(p, base, limit)?;
    let mut t = String::new();
    if p.abs {
        t.push('$');
    }
    if axis == Axis::Row {
        t.push_str(&(v + 1).to_string());
    } else {
        t.push_str(&col_name(v));
    }
    Some(t)
}

fn a1_cell(t: &Token, at: Addr) -> Option<String> {
    let (r, c) = (t.row?, t.col?);
    let col = a1_axis(c, at.col, Axis::Col)?;
    let row = a1_axis(r, at.row, Axis::Row)?;
    Some(format!("{col}{row}"))
}

fn a1_line(t: &Token, at: Addr) -> Option<String> {
    match (t.row, t.col) {
        (Some(r), None) => a1_axis(r, at.row, Axis::Row),
        (None, Some(c)) => a1_axis(c, at.col, Axis::Col),
        _ => None,
    }
}

fn copy_quoted(s: &[char], i: &mut usize, out: &mut String) {
    let q = s[*i];
    out.push(q);
    *i += 1;
    while *i < s.len() {
        out.push(s[*i]);
        if s[*i] == q {
            if s.get(*i + 1) == Some(&q) {
                out.push(q);
                *i += 2;
                continue;
            }
            *i += 1;
            return;
        }
        *i += 1;
    }
}

fn copy_bracket(s: &[char], i: &mut usize, out: &mut String) {
    let mut depth = 0;
    while *i < s.len() {
        let c = s[*i];
        out.push(c);
        *i += 1;
        match c {
            '\'' => {
                if *i < s.len() {
                    out.push(s[*i]);
                    *i += 1;
                }
            }
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return;
                }
            }
            _ => {}
        }
    }
}

pub fn to_a1_text(src: &str, at: Addr) -> String {
    let s: Vec<char> = src.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < s.len() {
        let c = s[i];
        if c == '"' || c == '\'' {
            copy_quoted(&s, &mut i, &mut out);
        } else if c == '[' {
            copy_bracket(&s, &mut i, &mut out);
        } else if c == 'R' || c == 'r' || c == 'C' || c == 'c' {
            let prior = i > 0 && (is_word(s[i - 1]) || s[i - 1] == ']');
            match (!prior).then(|| token_at(&s, i)).flatten() {
                Some(t) => {
                    let mut end = t.end;
                    let mut converted = None;
                    if s.get(end) == Some(&':') {
                        if let Some(u) = token_at(&s, end + 1) {
                            converted = match (&t.row, &t.col, &u.row, &u.col) {
                                (Some(_), Some(_), Some(_), Some(_)) => a1_cell(&t, at).zip(a1_cell(&u, at)).map(|(x, y)| format!("{x}:{y}")),
                                _ if t.row.is_some() != t.col.is_some() && (t.row.is_some() == u.row.is_some()) && (t.col.is_some() == u.col.is_some()) => a1_line(&t, at).zip(a1_line(&u, at)).map(|(x, y)| format!("{x}:{y}")),
                                _ => None,
                            };
                            if converted.is_some() {
                                end = u.end;
                            }
                        }
                    }
                    let text = match converted {
                        Some(x) => Some(x),
                        None => {
                            if t.row.is_some() && t.col.is_some() {
                                a1_cell(&t, at)
                            } else {
                                a1_line(&t, at).map(|x| format!("{x}:{x}"))
                            }
                        }
                    };
                    out.push_str(&text.unwrap_or_else(|| "#REF!".to_string()));
                    i = end;
                }
                None => {
                    while i < s.len() && is_word(s[i]) {
                        out.push(s[i]);
                        i += 1;
                    }
                }
            }
        } else if is_word(c) || c == '$' {
            out.push(c);
            i += 1;
            while i < s.len() && is_word(s[i]) {
                out.push(s[i]);
                i += 1;
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

pub fn convert(text: &str, at: Addr, to_r1c1_style: bool) -> String {
    let (open, body, close) = match text.strip_prefix('{').and_then(|t| t.strip_suffix('}')) {
        Some(b) if b.starts_with('=') => ("{", b, "}"),
        _ => ("", text, ""),
    };
    let out = if to_r1c1_style { to_r1c1(body, at) } else { input_to_a1(body, at) };
    format!("{open}{out}{close}")
}

pub fn input_to_a1(raw: &str, at: Addr) -> String {
    let t = raw.trim_start();
    match t.strip_prefix('=') {
        Some(body) if !body.is_empty() => format!("={}", to_a1_text(body, at)),
        _ => raw.to_string(),
    }
}
