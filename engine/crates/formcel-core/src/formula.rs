use crate::{col_name, MAX_COLS, MAX_ROWS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrKind {
    Div0,
    Value,
    Ref,
    Name,
    Na,
    Num,
    Null,
    Error,
}

impl ErrKind {
    pub fn text(self) -> &'static str {
        match self {
            ErrKind::Div0 => "#DIV/0!",
            ErrKind::Value => "#VALUE!",
            ErrKind::Ref => "#REF!",
            ErrKind::Name => "#NAME?",
            ErrKind::Na => "#N/A",
            ErrKind::Num => "#NUM!",
            ErrKind::Null => "#NULL!",
            ErrKind::Error => "#ERROR!",
        }
    }

    pub fn parse(s: &str) -> Option<ErrKind> {
        [ErrKind::Div0, ErrKind::Value, ErrKind::Ref, ErrKind::Name, ErrKind::Na, ErrKind::Num, ErrKind::Null, ErrKind::Error]
            .into_iter()
            .find(|e| e.text().eq_ignore_ascii_case(s))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellRef {
    pub row: u32,
    pub col: u32,
    pub abs_row: bool,
    pub abs_col: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefKind {
    Cell(CellRef),
    Area(CellRef, CellRef),
    Cols(u32, bool, u32, bool),
    Rows(u32, bool, u32, bool),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Area {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl Area {
    pub fn contains(&self, row: u32, col: u32) -> bool {
        row >= self.r0 && row <= self.r1 && col >= self.c0 && col <= self.c1
    }
}

impl RefKind {
    pub fn area(&self) -> Area {
        match *self {
            RefKind::Cell(c) => Area { r0: c.row, c0: c.col, r1: c.row, c1: c.col },
            RefKind::Area(a, b) => Area { r0: a.row.min(b.row), c0: a.col.min(b.col), r1: a.row.max(b.row), c1: a.col.max(b.col) },
            RefKind::Cols(a, _, b, _) => Area { r0: 0, c0: a.min(b), r1: MAX_ROWS - 1, c1: a.max(b) },
            RefKind::Rows(a, _, b, _) => Area { r0: a.min(b), c0: 0, r1: a.max(b), c1: MAX_COLS - 1 },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Cat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Op {
    fn text(self) -> &'static str {
        match self {
            Op::Add => "+",
            Op::Sub => "-",
            Op::Mul => "*",
            Op::Div => "/",
            Op::Pow => "^",
            Op::Cat => "&",
            Op::Eq => "=",
            Op::Ne => "<>",
            Op::Lt => "<",
            Op::Le => "<=",
            Op::Gt => ">",
            Op::Ge => ">=",
        }
    }

    fn prec(self) -> u8 {
        match self {
            Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => 1,
            Op::Cat => 2,
            Op::Add | Op::Sub => 3,
            Op::Mul | Op::Div => 4,
            Op::Pow => 5,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Num(f64),
    Str(String),
    Bool(bool),
    Err(ErrKind),
    Missing,
    Ref(Option<String>, RefKind),
    Name(String),
    Neg(Box<Expr>),
    Pos(Box<Expr>),
    Pct(Box<Expr>),
    Bin(Op, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    Paren(Box<Expr>),
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    Ident(String),
    Quoted(String),
    Err(ErrKind),
    Bang,
    Colon,
    Comma,
    LParen,
    RParen,
    Op(Op),
    Plus,
    Minus,
    Pct,
}

fn lex(src: &str) -> Option<Vec<Tok>> {
    let s: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < s.len() {
        let c = s[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && s.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            let st = i;
            while i < s.len() && (s[i].is_ascii_digit() || s[i] == '.') {
                i += 1;
            }
            if i < s.len() && (s[i] == 'e' || s[i] == 'E') {
                let mut j = i + 1;
                if j < s.len() && (s[j] == '+' || s[j] == '-') {
                    j += 1;
                }
                if j < s.len() && s[j].is_ascii_digit() {
                    i = j;
                    while i < s.len() && s[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            let t: String = s[st..i].iter().collect();
            if i < s.len() && (s[i].is_ascii_alphabetic() || s[i] == '$') {
                while i < s.len() && (s[i].is_alphanumeric() || s[i] == '_' || s[i] == '.' || s[i] == '$') {
                    i += 1;
                }
                out.push(Tok::Ident(s[st..i].iter().collect()));
                continue;
            }
            out.push(Tok::Num(t.parse().ok()?));
            continue;
        }
        if c.is_alphabetic() || c == '_' || c == '$' || c == '\\' {
            let st = i;
            while i < s.len() && (s[i].is_alphanumeric() || s[i] == '_' || s[i] == '.' || s[i] == '$' || s[i] == '\\') {
                i += 1;
            }
            out.push(Tok::Ident(s[st..i].iter().collect()));
            continue;
        }
        match c {
            '"' | '\'' => {
                let q = c;
                let mut t = String::new();
                i += 1;
                loop {
                    if i >= s.len() {
                        return None;
                    }
                    if s[i] == q {
                        if s.get(i + 1) == Some(&q) {
                            t.push(q);
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    t.push(s[i]);
                    i += 1;
                }
                out.push(if q == '"' { Tok::Str(t) } else { Tok::Quoted(t) });
                continue;
            }
            '#' => {
                let st = i;
                i += 1;
                while i < s.len() && (s[i].is_ascii_alphanumeric() || s[i] == '/') {
                    i += 1;
                }
                if i < s.len() && (s[i] == '!' || s[i] == '?') {
                    i += 1;
                }
                let t: String = s[st..i].iter().collect();
                out.push(Tok::Err(ErrKind::parse(&t)?));
                continue;
            }
            '<' => {
                let n = s.get(i + 1).copied();
                let (op, w) = match n {
                    Some('=') => (Op::Le, 2),
                    Some('>') => (Op::Ne, 2),
                    _ => (Op::Lt, 1),
                };
                out.push(Tok::Op(op));
                i += w;
                continue;
            }
            '>' => {
                let ge = s.get(i + 1) == Some(&'=');
                out.push(Tok::Op(if ge { Op::Ge } else { Op::Gt }));
                i += if ge { 2 } else { 1 };
                continue;
            }
            _ => {}
        }
        let t = match c {
            '!' => Tok::Bang,
            ':' => Tok::Colon,
            ',' => Tok::Comma,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '%' => Tok::Pct,
            '*' => Tok::Op(Op::Mul),
            '/' => Tok::Op(Op::Div),
            '^' => Tok::Op(Op::Pow),
            '&' => Tok::Op(Op::Cat),
            '=' => Tok::Op(Op::Eq),
            _ => return None,
        };
        out.push(t);
        i += 1;
    }
    Some(out)
}

fn parse_col_part(s: &str) -> Option<(u32, bool)> {
    let (abs, rest) = s.strip_prefix('$').map_or((false, s), |r| (true, r));
    if rest.is_empty() || rest.len() > 3 || !rest.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let mut col: u32 = 0;
    for b in rest.to_ascii_uppercase().bytes() {
        col = col * 26 + u32::from(b - b'A' + 1);
    }
    (1..=MAX_COLS).contains(&col).then_some((col - 1, abs))
}

fn parse_row_part(s: &str) -> Option<(u32, bool)> {
    let (abs, rest) = s.strip_prefix('$').map_or((false, s), |r| (true, r));
    if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let row: u64 = rest.parse().ok()?;
    (row >= 1 && row <= u64::from(MAX_ROWS)).then_some(((row - 1) as u32, abs))
}

fn parse_cell(s: &str) -> Option<CellRef> {
    let b = s.as_bytes();
    let mut k = usize::from(b.first() == Some(&b'$'));
    while k < b.len() && b[k].is_ascii_alphabetic() {
        k += 1;
    }
    let (c, abs_col) = parse_col_part(&s[..k])?;
    let (r, abs_row) = parse_row_part(&s[k..])?;
    Some(CellRef { row: r, col: c, abs_row, abs_col })
}

struct Parser {
    t: Vec<Tok>,
    i: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.t.get(self.i)
    }

    fn peek_at(&self, k: usize) -> Option<&Tok> {
        self.t.get(self.i + k)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.t.get(self.i).cloned();
        self.i += 1;
        t
    }

    fn expr(&mut self, min: u8) -> Option<Expr> {
        let mut left = self.unary()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op(o)) => *o,
                Some(Tok::Plus) => Op::Add,
                Some(Tok::Minus) => Op::Sub,
                _ => break,
            };
            let p = op.prec();
            if p < min {
                break;
            }
            self.i += 1;
            let right = self.expr(p + 1)?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
        Some(left)
    }

    fn unary(&mut self) -> Option<Expr> {
        match self.peek() {
            Some(Tok::Minus) => {
                self.i += 1;
                Some(Expr::Neg(Box::new(self.unary()?)))
            }
            Some(Tok::Plus) => {
                self.i += 1;
                Some(Expr::Pos(Box::new(self.unary()?)))
            }
            _ => {
                let mut e = self.primary()?;
                while self.peek() == Some(&Tok::Pct) {
                    self.i += 1;
                    e = Expr::Pct(Box::new(e));
                }
                Some(e)
            }
        }
    }

    fn reference(&mut self, sheet: Option<String>, first: &str) -> Option<Expr> {
        let colon_next = self.peek() == Some(&Tok::Colon);
        if let Some(a) = parse_cell(first) {
            if colon_next {
                if let Some(Tok::Ident(second)) = self.peek_at(1) {
                    if let Some(b) = parse_cell(second) {
                        self.i += 2;
                        return Some(Expr::Ref(sheet, RefKind::Area(a, b)));
                    }
                }
            }
            return Some(Expr::Ref(sheet, RefKind::Cell(a)));
        }
        if colon_next {
            let second = match self.peek_at(1) {
                Some(Tok::Ident(s)) => s.clone(),
                Some(Tok::Num(n)) if n.fract() == 0.0 => format!("{}", *n as u64),
                _ => return None,
            };
            if let (Some((a, aa)), Some((b, ab))) = (parse_col_part(first), parse_col_part(&second)) {
                self.i += 2;
                return Some(Expr::Ref(sheet, RefKind::Cols(a, aa, b, ab)));
            }
            if let (Some((a, aa)), Some((b, ab))) = (parse_row_part(first), parse_row_part(&second)) {
                self.i += 2;
                return Some(Expr::Ref(sheet, RefKind::Rows(a, aa, b, ab)));
            }
        }
        None
    }

    fn primary(&mut self) -> Option<Expr> {
        match self.next()? {
            Tok::Num(n) => {
                if n.fract() == 0.0 && self.peek() == Some(&Tok::Colon) {
                    if let Some(e) = self.reference(None, &format!("{}", n as u64)) {
                        return Some(e);
                    }
                }
                Some(Expr::Num(n))
            }
            Tok::Str(s) => Some(Expr::Str(s)),
            Tok::Err(e) => Some(Expr::Err(e)),
            Tok::LParen => {
                let e = self.expr(0)?;
                (self.next()? == Tok::RParen).then(|| Expr::Paren(Box::new(e)))
            }
            Tok::Quoted(name) => {
                if self.next()? != Tok::Bang {
                    return None;
                }
                self.sheet_ref(name)
            }
            Tok::Ident(id) => {
                if self.peek() == Some(&Tok::Bang) {
                    self.i += 1;
                    return self.sheet_ref(id);
                }
                if self.peek() == Some(&Tok::LParen) {
                    self.i += 1;
                    let mut args = Vec::new();
                    if self.peek() == Some(&Tok::RParen) {
                        self.i += 1;
                        return Some(Expr::Call(id.to_ascii_uppercase(), args));
                    }
                    loop {
                        if matches!(self.peek(), Some(Tok::Comma) | Some(Tok::RParen)) {
                            args.push(Expr::Missing);
                        } else {
                            args.push(self.expr(0)?);
                        }
                        match self.next()? {
                            Tok::Comma => continue,
                            Tok::RParen => break,
                            _ => return None,
                        }
                    }
                    return Some(Expr::Call(id.to_ascii_uppercase(), args));
                }
                match id.to_ascii_uppercase().as_str() {
                    "TRUE" => return Some(Expr::Bool(true)),
                    "FALSE" => return Some(Expr::Bool(false)),
                    _ => {}
                }
                if let Some(e) = self.reference(None, &id) {
                    return Some(e);
                }
                Some(Expr::Name(id))
            }
            _ => None,
        }
    }

    fn sheet_ref(&mut self, sheet: String) -> Option<Expr> {
        let first = match self.next()? {
            Tok::Ident(s) => s,
            Tok::Num(n) if n.fract() == 0.0 => format!("{}", n as u64),
            Tok::Err(ErrKind::Ref) => return Some(Expr::Err(ErrKind::Ref)),
            _ => return None,
        };
        self.reference(Some(sheet), &first)
    }
}

pub fn parse(src: &str) -> Option<Expr> {
    let toks = lex(src)?;
    let mut p = Parser { t: toks, i: 0 };
    let e = p.expr(0)?;
    (p.i == p.t.len()).then_some(e)
}

fn num_text(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}

fn sheet_text(name: &str, out: &mut String) {
    let plain = !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') && !name.starts_with(|c: char| c.is_ascii_digit());
    if plain {
        out.push_str(name);
    } else {
        out.push('\'');
        out.push_str(&name.replace('\'', "''"));
        out.push('\'');
    }
    out.push('!');
}

fn cell_text(c: CellRef, out: &mut String) {
    if c.abs_col {
        out.push('$');
    }
    out.push_str(&col_name(c.col));
    if c.abs_row {
        out.push('$');
    }
    out.push_str(&(c.row + 1).to_string());
}

pub fn print(e: &Expr, out: &mut String) {
    match e {
        Expr::Num(n) => out.push_str(&num_text(*n)),
        Expr::Str(s) => {
            out.push('"');
            out.push_str(&s.replace('"', "\"\""));
            out.push('"');
        }
        Expr::Bool(b) => out.push_str(if *b { "TRUE" } else { "FALSE" }),
        Expr::Err(k) => out.push_str(k.text()),
        Expr::Missing => {}
        Expr::Name(n) => out.push_str(n),
        Expr::Ref(sheet, k) => {
            if let Some(s) = sheet {
                sheet_text(s, out);
            }
            match *k {
                RefKind::Cell(c) => cell_text(c, out),
                RefKind::Area(a, b) => {
                    cell_text(a, out);
                    out.push(':');
                    cell_text(b, out);
                }
                RefKind::Cols(a, aa, b, ab) => {
                    out.push_str(if aa { "$" } else { "" });
                    out.push_str(&col_name(a));
                    out.push(':');
                    out.push_str(if ab { "$" } else { "" });
                    out.push_str(&col_name(b));
                }
                RefKind::Rows(a, aa, b, ab) => {
                    out.push_str(if aa { "$" } else { "" });
                    out.push_str(&(a + 1).to_string());
                    out.push(':');
                    out.push_str(if ab { "$" } else { "" });
                    out.push_str(&(b + 1).to_string());
                }
            }
        }
        Expr::Neg(x) => {
            out.push('-');
            print(x, out);
        }
        Expr::Pos(x) => {
            out.push('+');
            print(x, out);
        }
        Expr::Pct(x) => {
            print(x, out);
            out.push('%');
        }
        Expr::Bin(op, a, b) => {
            print(a, out);
            out.push_str(op.text());
            print(b, out);
        }
        Expr::Call(name, args) => {
            out.push_str(name);
            out.push('(');
            for (i, a) in args.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                print(a, out);
            }
            out.push(')');
        }
        Expr::Paren(x) => {
            out.push('(');
            print(x, out);
            out.push(')');
        }
    }
}

pub fn to_text(e: &Expr) -> String {
    let mut s = String::new();
    print(e, &mut s);
    s
}

pub fn walk_mut(e: &mut Expr, f: &mut dyn FnMut(&mut Expr)) {
    match e {
        Expr::Neg(x) | Expr::Pos(x) | Expr::Pct(x) | Expr::Paren(x) => walk_mut(x, f),
        Expr::Bin(_, a, b) => {
            walk_mut(a, f);
            walk_mut(b, f);
        }
        Expr::Call(_, args) => {
            for a in args {
                walk_mut(a, f);
            }
        }
        _ => {}
    }
    f(e);
}

pub fn refs(e: &Expr, f: &mut dyn FnMut(Option<&str>, Area)) {
    match e {
        Expr::Ref(s, k) => f(s.as_deref(), k.area()),
        Expr::Neg(x) | Expr::Pos(x) | Expr::Pct(x) | Expr::Paren(x) => refs(x, f),
        Expr::Bin(_, a, b) => {
            refs(a, f);
            refs(b, f);
        }
        Expr::Call(_, args) => {
            for a in args {
                refs(a, f);
            }
        }
        _ => {}
    }
}

fn shift_index(i: u32, at: u32, delta: i64, limit: u32) -> Option<u32> {
    let (i, at) = (i64::from(i), i64::from(at));
    if delta >= 0 {
        let n = if i >= at { i + delta } else { i };
        return (n < i64::from(limit)).then_some(n as u32);
    }
    let n = -delta;
    if i >= at && i < at + n {
        return None;
    }
    Some(if i >= at + n { (i - n) as u32 } else { i as u32 })
}

fn shift_span(lo: u32, hi: u32, at: u32, delta: i64, limit: u32) -> Option<(u32, u32)> {
    if delta >= 0 {
        let a = shift_index(lo, at, delta, limit)?;
        let b = shift_index(hi, at, delta, limit).unwrap_or(limit - 1);
        return Some((a, b));
    }
    let (lo64, hi64, at64, n) = (i64::from(lo), i64::from(hi), i64::from(at), -delta);
    let a = if lo64 >= at64 + n { lo64 - n } else if lo64 >= at64 { at64 } else { lo64 };
    let b = if hi64 >= at64 + n { hi64 - n } else if hi64 >= at64 { at64 - 1 } else { hi64 };
    (b >= a && b >= 0).then_some((a as u32, b as u32))
}

pub fn shift_refs(e: &mut Expr, own: &str, target: &str, rows: bool, at: u32, delta: i64) -> bool {
    let mut changed = false;
    let limit = if rows { MAX_ROWS } else { MAX_COLS };
    walk_mut(e, &mut |node| {
        let Expr::Ref(sheet, kind) = node else { return };
        let on = sheet.as_deref().unwrap_or(own);
        if !on.eq_ignore_ascii_case(target) {
            return;
        }
        let before = *kind;
        let next: Option<RefKind> = match *kind {
            RefKind::Cell(c) => shift_index(if rows { c.row } else { c.col }, at, delta, limit).map(|n| {
                let mut c = c;
                if rows {
                    c.row = n;
                } else {
                    c.col = n;
                }
                RefKind::Cell(c)
            }),
            RefKind::Area(mut a, mut b) => {
                let (pa, pb) = if rows { (a.row, b.row) } else { (a.col, b.col) };
                let (lo, hi) = (pa.min(pb), pa.max(pb));
                shift_span(lo, hi, at, delta, limit).map(|(nl, nh)| {
                    let (first, second) = if pa <= pb { (&mut a, &mut b) } else { (&mut b, &mut a) };
                    if rows {
                        first.row = nl;
                        second.row = nh;
                    } else {
                        first.col = nl;
                        second.col = nh;
                    }
                    RefKind::Area(a, b)
                })
            }
            RefKind::Cols(a, aa, b, ab) if !rows => shift_span(a.min(b), a.max(b), at, delta, limit).map(|(l, h)| RefKind::Cols(l, aa, h, ab)),
            RefKind::Rows(a, aa, b, ab) if rows => shift_span(a.min(b), a.max(b), at, delta, limit).map(|(l, h)| RefKind::Rows(l, aa, h, ab)),
            k => Some(k),
        };
        match next {
            Some(k) => {
                if k != before {
                    *kind = k;
                    changed = true;
                }
            }
            None => {
                *node = Expr::Err(ErrKind::Ref);
                changed = true;
            }
        }
    });
    changed
}

pub fn rename_refs(e: &mut Expr, old: &str, new: &str) -> bool {
    let mut changed = false;
    walk_mut(e, &mut |node| {
        if let Expr::Ref(Some(s), _) = node {
            if s.eq_ignore_ascii_case(old) {
                *s = new.to_string();
                changed = true;
            }
        }
    });
    changed
}

fn move_by(i: u32, abs: bool, d: i64, limit: u32) -> Option<u32> {
    if abs {
        return Some(i);
    }
    let n = i64::from(i) + d;
    (n >= 0 && n < i64::from(limit)).then_some(n as u32)
}

pub fn offset(e: &mut Expr, dr: i64, dc: i64) {
    walk_mut(e, &mut |node| {
        let Expr::Ref(_, kind) = node else { return };
        let cell = |c: CellRef| -> Option<CellRef> {
            Some(CellRef { row: move_by(c.row, c.abs_row, dr, MAX_ROWS)?, col: move_by(c.col, c.abs_col, dc, MAX_COLS)?, ..c })
        };
        let next = match *kind {
            RefKind::Cell(c) => cell(c).map(RefKind::Cell),
            RefKind::Area(a, b) => cell(a).zip(cell(b)).map(|(a, b)| RefKind::Area(a, b)),
            RefKind::Cols(a, aa, b, ab) => move_by(a, aa, dc, MAX_COLS).zip(move_by(b, ab, dc, MAX_COLS)).map(|(a, b)| RefKind::Cols(a, aa, b, ab)),
            RefKind::Rows(a, aa, b, ab) => move_by(a, aa, dr, MAX_ROWS).zip(move_by(b, ab, dr, MAX_ROWS)).map(|(a, b)| RefKind::Rows(a, aa, b, ab)),
        };
        match next {
            Some(k) => *kind = k,
            None => *node = Expr::Err(ErrKind::Ref),
        }
    });
}

pub fn offset_text(src: &str, dr: i64, dc: i64) -> String {
    let body = src.trim_start().strip_prefix('=').unwrap_or(src);
    match parse(body) {
        Some(mut e) => {
            offset(&mut e, dr, dc);
            format!("={}", to_text(&e))
        }
        None => src.to_string(),
    }
}
