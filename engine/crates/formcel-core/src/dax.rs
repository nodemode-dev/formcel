use crate::datamodel::{key_of, Model};
use crate::Value;
use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

type R<T> = Result<T, String>;

#[derive(Clone, Copy, Debug, PartialEq)]
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
    And,
    Or,
}

#[derive(Clone, Debug, PartialEq)]
pub enum D {
    Num(f64),
    Str(String),
    Bool(bool),
    Col(Option<String>, String),
    Name(String),
    Call(String, Vec<D>),
    Bin(Op, Box<D>, Box<D>),
    Neg(Box<D>),
    Not(Box<D>),
    In(Box<D>, Vec<D>),
}

#[derive(Clone, Debug, PartialEq)]
enum T {
    Num(f64),
    Str(String),
    Id(String),
    Quoted(String),
    Br(String),
    Op(Op),
    Lp,
    Rp,
    Lb,
    Rb,
    Comma,
    Bang,
}

fn lex(src: &str) -> R<Vec<T>> {
    let ch: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < ch.len() {
        let c = ch[i];
        match c {
            ' ' | '\t' | '\n' | '\r' => i += 1,
            '"' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match ch.get(i) {
                        None => return Err("a text value is missing its closing quote".into()),
                        Some('"') if ch.get(i + 1) == Some(&'"') => {
                            s.push('"');
                            i += 2;
                        }
                        Some('"') => {
                            i += 1;
                            break;
                        }
                        Some(x) => {
                            s.push(*x);
                            i += 1;
                        }
                    }
                }
                out.push(T::Str(s));
            }
            '\'' | '[' => {
                let close = if c == '\'' { '\'' } else { ']' };
                let mut s = String::new();
                i += 1;
                loop {
                    match ch.get(i) {
                        None => return Err(format!("a name is missing its closing {close}")),
                        Some(x) if *x == close && ch.get(i + 1) == Some(&close) => {
                            s.push(close);
                            i += 2;
                        }
                        Some(x) if *x == close => {
                            i += 1;
                            break;
                        }
                        Some(x) => {
                            s.push(*x);
                            i += 1;
                        }
                    }
                }
                out.push(if c == '\'' { T::Quoted(s) } else { T::Br(s) });
            }
            '0'..='9' | '.' if c.is_ascii_digit() || ch.get(i + 1).is_some_and(|d| d.is_ascii_digit()) => {
                let st = i;
                while i < ch.len() && (ch[i].is_ascii_digit() || ch[i] == '.') {
                    i += 1;
                }
                if i < ch.len() && (ch[i] == 'e' || ch[i] == 'E') && ch.get(i + 1).is_some_and(|d| d.is_ascii_digit() || *d == '-' || *d == '+') {
                    i += 2;
                    while i < ch.len() && ch[i].is_ascii_digit() {
                        i += 1;
                    }
                }
                let t: String = ch[st..i].iter().collect();
                out.push(T::Num(t.parse().map_err(|_| format!("{t} is not a number"))?));
            }
            '(' => {
                out.push(T::Lp);
                i += 1;
            }
            ')' => {
                out.push(T::Rp);
                i += 1;
            }
            '{' => {
                out.push(T::Lb);
                i += 1;
            }
            '}' => {
                out.push(T::Rb);
                i += 1;
            }
            ',' | ';' => {
                out.push(T::Comma);
                i += 1;
            }
            '+' => {
                out.push(T::Op(Op::Add));
                i += 1;
            }
            '-' => {
                out.push(T::Op(Op::Sub));
                i += 1;
            }
            '*' => {
                out.push(T::Op(Op::Mul));
                i += 1;
            }
            '/' if ch.get(i + 1) == Some(&'/') => {
                while i < ch.len() && ch[i] != '\n' {
                    i += 1;
                }
            }
            '/' => {
                out.push(T::Op(Op::Div));
                i += 1;
            }
            '^' => {
                out.push(T::Op(Op::Pow));
                i += 1;
            }
            '&' if ch.get(i + 1) == Some(&'&') => {
                out.push(T::Op(Op::And));
                i += 2;
            }
            '&' => {
                out.push(T::Op(Op::Cat));
                i += 1;
            }
            '|' if ch.get(i + 1) == Some(&'|') => {
                out.push(T::Op(Op::Or));
                i += 2;
            }
            '=' => {
                out.push(T::Op(Op::Eq));
                i += 1;
            }
            '<' => match ch.get(i + 1) {
                Some('=') => {
                    out.push(T::Op(Op::Le));
                    i += 2;
                }
                Some('>') => {
                    out.push(T::Op(Op::Ne));
                    i += 2;
                }
                _ => {
                    out.push(T::Op(Op::Lt));
                    i += 1;
                }
            },
            '>' => {
                if ch.get(i + 1) == Some(&'=') {
                    out.push(T::Op(Op::Ge));
                    i += 2;
                } else {
                    out.push(T::Op(Op::Gt));
                    i += 1;
                }
            }
            '!' => {
                out.push(T::Bang);
                i += 1;
            }
            c if c.is_alphabetic() || c == '_' => {
                let st = i;
                while i < ch.len() && (ch[i].is_alphanumeric() || ch[i] == '_' || ch[i] == '.') {
                    i += 1;
                }
                out.push(T::Id(ch[st..i].iter().collect()));
            }
            c => return Err(format!("unexpected character {c}")),
        }
    }
    Ok(out)
}

struct P {
    t: Vec<T>,
    i: usize,
}

impl P {
    fn peek(&self) -> Option<&T> {
        self.t.get(self.i)
    }

    fn next(&mut self) -> Option<T> {
        let x = self.t.get(self.i).cloned();
        self.i += 1;
        x
    }

    fn eat(&mut self, t: &T) -> bool {
        if self.peek() == Some(t) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    fn or(&mut self) -> R<D> {
        let mut l = self.and()?;
        while self.eat(&T::Op(Op::Or)) {
            l = D::Bin(Op::Or, Box::new(l), Box::new(self.and()?));
        }
        Ok(l)
    }

    fn and(&mut self) -> R<D> {
        let mut l = self.cmp()?;
        while self.eat(&T::Op(Op::And)) {
            l = D::Bin(Op::And, Box::new(l), Box::new(self.cmp()?));
        }
        Ok(l)
    }

    fn cmp(&mut self) -> R<D> {
        let mut l = self.cat()?;
        loop {
            match self.peek().cloned() {
                Some(T::Op(o @ (Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge))) => {
                    self.i += 1;
                    l = D::Bin(o, Box::new(l), Box::new(self.cat()?));
                }
                Some(T::Id(w)) if w.eq_ignore_ascii_case("IN") => {
                    self.i += 1;
                    let close = match self.next() {
                        Some(T::Lb) => T::Rb,
                        Some(T::Lp) => T::Rp,
                        _ => return Err("IN needs a list in braces".into()),
                    };
                    let mut items = Vec::new();
                    if !self.eat(&close) {
                        loop {
                            items.push(self.or()?);
                            if self.eat(&close) {
                                break;
                            }
                            if !self.eat(&T::Comma) {
                                return Err("IN list is not closed".into());
                            }
                        }
                    }
                    l = D::In(Box::new(l), items);
                }
                _ => return Ok(l),
            }
        }
    }

    fn cat(&mut self) -> R<D> {
        let mut l = self.add()?;
        while self.eat(&T::Op(Op::Cat)) {
            l = D::Bin(Op::Cat, Box::new(l), Box::new(self.add()?));
        }
        Ok(l)
    }

    fn add(&mut self) -> R<D> {
        let mut l = self.mul()?;
        loop {
            let o = match self.peek() {
                Some(T::Op(Op::Add)) => Op::Add,
                Some(T::Op(Op::Sub)) => Op::Sub,
                _ => return Ok(l),
            };
            self.i += 1;
            l = D::Bin(o, Box::new(l), Box::new(self.mul()?));
        }
    }

    fn mul(&mut self) -> R<D> {
        let mut l = self.pow()?;
        loop {
            let o = match self.peek() {
                Some(T::Op(Op::Mul)) => Op::Mul,
                Some(T::Op(Op::Div)) => Op::Div,
                _ => return Ok(l),
            };
            self.i += 1;
            l = D::Bin(o, Box::new(l), Box::new(self.pow()?));
        }
    }

    fn pow(&mut self) -> R<D> {
        let l = self.unary()?;
        if self.eat(&T::Op(Op::Pow)) {
            return Ok(D::Bin(Op::Pow, Box::new(l), Box::new(self.pow()?)));
        }
        Ok(l)
    }

    fn unary(&mut self) -> R<D> {
        if self.eat(&T::Op(Op::Sub)) {
            return Ok(D::Neg(Box::new(self.unary()?)));
        }
        if self.eat(&T::Op(Op::Add)) {
            return self.unary();
        }
        if self.eat(&T::Bang) {
            return Ok(D::Not(Box::new(self.unary()?)));
        }
        self.primary()
    }

    fn primary(&mut self) -> R<D> {
        match self.next() {
            Some(T::Num(n)) => Ok(D::Num(n)),
            Some(T::Str(s)) => Ok(D::Str(s)),
            Some(T::Br(n)) => Ok(D::Col(None, n)),
            Some(T::Quoted(t)) => match self.peek().cloned() {
                Some(T::Br(c)) => {
                    self.i += 1;
                    Ok(D::Col(Some(t), c))
                }
                _ => Ok(D::Name(t)),
            },
            Some(T::Id(id)) => match self.peek().cloned() {
                Some(T::Lp) => {
                    self.i += 1;
                    let mut args = Vec::new();
                    if !self.eat(&T::Rp) {
                        loop {
                            if matches!(self.peek(), Some(T::Comma)) {
                                args.push(D::Call("BLANK".into(), Vec::new()));
                            } else {
                                args.push(self.or()?);
                            }
                            if self.eat(&T::Rp) {
                                break;
                            }
                            if !self.eat(&T::Comma) {
                                return Err(format!("{id} is missing a closing parenthesis"));
                            }
                        }
                    }
                    Ok(D::Call(id.to_ascii_uppercase(), args))
                }
                Some(T::Br(c)) => {
                    self.i += 1;
                    Ok(D::Col(Some(id), c))
                }
                _ => match id.to_ascii_uppercase().as_str() {
                    "TRUE" => Ok(D::Bool(true)),
                    "FALSE" => Ok(D::Bool(false)),
                    _ => Ok(D::Name(id)),
                },
            },
            Some(T::Lp) => {
                let e = self.or()?;
                if !self.eat(&T::Rp) {
                    return Err("a parenthesis is not closed".into());
                }
                Ok(e)
            }
            Some(t) => Err(format!("unexpected {}", describe(&t))),
            None => Err("the formula ends too soon".into()),
        }
    }
}

fn describe(t: &T) -> String {
    match t {
        T::Rp => "closing parenthesis".into(),
        T::Comma => "comma".into(),
        T::Op(_) => "operator".into(),
        T::Rb | T::Lb => "brace".into(),
        _ => "token".into(),
    }
}

pub fn parse(src: &str) -> R<D> {
    let s = src.trim().trim_start_matches('=');
    if s.trim().is_empty() {
        return Err("the formula is empty".into());
    }
    let mut p = P { t: lex(s)?, i: 0 };
    let e = p.or()?;
    if p.i < p.t.len() {
        return Err(format!("unexpected {} after the end of the formula", describe(&p.t[p.i])));
    }
    Ok(e)
}

pub struct Flt {
    pub t: usize,
    pub c: usize,
    pub keys: Vec<String>,
}

#[derive(Clone, Default)]
struct Tf {
    rows: Option<Rc<Vec<bool>>>,
    cols: Vec<(usize, Rc<HashSet<String>>)>,
}

struct Tv {
    t: usize,
    rows: Vec<usize>,
    col: Option<usize>,
}

enum Val {
    S(Value),
    T(Tv),
}

pub struct Env<'a> {
    m: &'a Model,
    tf: Vec<Tf>,
    act: Vec<bool>,
    rows: Vec<(usize, usize)>,
    memo: RefCell<HashMap<usize, Option<Rc<Vec<bool>>>>>,
    depth: Cell<u32>,
}

fn num_of(v: &Value) -> R<f64> {
    match v {
        Value::Empty => Ok(0.0),
        Value::Number(n) => Ok(*n),
        Value::Bool(b) => Ok(f64::from(u8::from(*b))),
        Value::Text(t) => t.trim().parse().map_err(|_| format!("cannot convert the text \"{t}\" to a number")),
        Value::Error(_) => Err(v.to_string()),
    }
}

fn text_of(v: &Value) -> String {
    match v {
        Value::Empty => String::new(),
        o => o.to_string(),
    }
}

fn truth(v: &Value) -> R<bool> {
    match v {
        Value::Bool(b) => Ok(*b),
        Value::Number(n) => Ok(*n != 0.0),
        Value::Empty => Ok(false),
        Value::Text(t) if t.eq_ignore_ascii_case("true") => Ok(true),
        Value::Text(t) if t.eq_ignore_ascii_case("false") => Ok(false),
        Value::Text(_) => Err("a text value cannot be used as true or false".into()),
        Value::Error(_) => Err(v.to_string()),
    }
}

fn order(a: &Value, b: &Value) -> Ordering {
    let rank = |v: &Value| match v {
        Value::Empty | Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Bool(_) => 2,
        Value::Error(_) => 3,
    };
    match (a, b) {
        (Value::Text(x), Value::Text(y)) => x.to_lowercase().cmp(&y.to_lowercase()),
        (Value::Text(x), Value::Empty) => x.is_empty().then_some(Ordering::Equal).unwrap_or(Ordering::Greater),
        (Value::Empty, Value::Text(y)) => y.is_empty().then_some(Ordering::Equal).unwrap_or(Ordering::Less),
        (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
        _ if rank(a) != rank(b) => rank(a).cmp(&rank(b)),
        _ => num_of(a).unwrap_or(0.0).partial_cmp(&num_of(b).unwrap_or(0.0)).unwrap_or(Ordering::Equal),
    }
}

fn clean(n: f64) -> Value {
    Value::Number(if n == 0.0 { 0.0 } else { n })
}

impl<'a> Env<'a> {
    pub fn new(m: &'a Model) -> Env<'a> {
        Env { m, tf: vec![Tf::default(); m.tables.len()], act: m.rels.iter().map(|r| r.active).collect(), rows: Vec::new(), memo: RefCell::new(HashMap::new()), depth: Cell::new(0) }
    }

    fn fork(&self) -> Env<'a> {
        Env { m: self.m, tf: self.tf.clone(), act: self.act.clone(), rows: self.rows.clone(), memo: RefCell::new(HashMap::new()), depth: Cell::new(self.depth.get()) }
    }

    pub fn filter(&mut self, f: &Flt) {
        self.memo.borrow_mut().clear();
        let tf = &mut self.tf[f.t];
        tf.cols.retain(|(c, _)| *c != f.c);
        tf.cols.push((f.c, Rc::new(f.keys.iter().cloned().collect())));
    }

    fn mask(&self, t: usize, depth: u32) -> Option<Rc<Vec<bool>>> {
        if depth > 8 {
            return None;
        }
        if let Some(x) = self.memo.borrow().get(&t) {
            return x.clone();
        }
        let n = self.m.tables[t].rows;
        let mut cur: Option<Vec<bool>> = None;
        let f = &self.tf[t];
        if let Some(r) = &f.rows {
            cur = Some((**r).clone());
        }
        for (c, keys) in &f.cols {
            let col = &self.m.tables[t].cols[*c].data;
            let v = cur.get_or_insert_with(|| vec![true; n]);
            for i in 0..n {
                if v[i] && !keys.contains(&key_of(&col[i])) {
                    v[i] = false;
                }
            }
        }
        for (ri, rel) in self.m.rels.iter().enumerate() {
            if !self.act[ri] || rel.fi != t || rel.err.is_some() {
                continue;
            }
            if let Some(um) = self.mask(rel.ti, depth + 1) {
                let link = &self.m.links[ri];
                let v = cur.get_or_insert_with(|| vec![true; n]);
                for i in 0..n {
                    if v[i] && !link[i].is_some_and(|k| um[k as usize]) {
                        v[i] = false;
                    }
                }
            }
        }
        let out = cur.map(Rc::new);
        self.memo.borrow_mut().insert(t, out.clone());
        out
    }

    fn visible(&self, t: usize) -> Vec<usize> {
        match self.mask(t, 0) {
            Some(m) => (0..self.m.tables[t].rows).filter(|i| m[*i]).collect(),
            None => (0..self.m.tables[t].rows).collect(),
        }
    }

    fn table_of(&self, name: &str) -> R<usize> {
        self.m.tidx(name).ok_or_else(|| format!("the table '{name}' does not exist"))
    }

    fn col_of(&self, t: Option<&str>, c: &str) -> R<(usize, usize)> {
        match t {
            Some(tn) => {
                let ti = self.table_of(tn)?;
                let ci = self.m.cidx(ti, c).ok_or_else(|| format!("the column '{c}' does not exist in the table '{tn}'"))?;
                Ok((ti, ci))
            }
            None => {
                for (ti, _) in self.rows.iter().rev() {
                    if let Some(ci) = self.m.cidx(*ti, c) {
                        return Ok((*ti, ci));
                    }
                }
                Err(format!("the column [{c}] needs a table name"))
            }
        }
    }

    fn transitioned(&self) -> Env<'a> {
        let mut e = self.fork();
        for (t, r) in self.rows.clone() {
            let mut mask = vec![false; self.m.tables[t].rows];
            mask[r] = true;
            e.tf[t] = Tf { rows: Some(Rc::new(mask)), cols: Vec::new() };
        }
        e
    }

    fn measure_val(&self, mi: usize) -> R<Val> {
        if self.depth.get() > 40 {
            return Err("a measure refers to itself".into());
        }
        let Some(ast) = &self.m.measures[mi].ast else { return Err(self.m.measures[mi].err.clone().unwrap_or_else(|| "the measure has no formula".into())) };
        let mut e = if self.rows.is_empty() { self.fork() } else { self.transitioned() };
        e.rows.clear();
        e.depth.set(self.depth.get() + 1);
        e.eval(ast)
    }

    fn col_val(&self, t: Option<&str>, c: &str) -> R<Val> {
        if t.is_none() {
            let in_row = self.rows.iter().rev().find_map(|(ti, r)| self.m.cidx(*ti, c).map(|ci| (*ti, ci, *r)));
            if let Some((ti, ci, r)) = in_row {
                return Ok(Val::S(self.m.tables[ti].cols[ci].data[r].clone()));
            }
            if let Some(mi) = self.m.midx(c) {
                return self.measure_val(mi);
            }
            return Err(format!("[{c}] is not a column of the current table or a measure"));
        }
        let (ti, ci) = self.col_of(t, c)?;
        if let Some((_, r)) = self.rows.iter().rev().find(|(x, _)| *x == ti) {
            return Ok(Val::S(self.m.tables[ti].cols[ci].data[*r].clone()));
        }
        let mut seen: Vec<Value> = Vec::new();
        for r in self.visible(ti) {
            let v = &self.m.tables[ti].cols[ci].data[r];
            if !seen.iter().any(|x| key_of(x) == key_of(v)) {
                seen.push(v.clone());
            }
            if seen.len() > 1 {
                return Err(format!("a single value for the column '{c}' cannot be determined"));
            }
        }
        Ok(Val::S(seen.pop().unwrap_or(Value::Empty)))
    }

    fn sc(&self, e: &D) -> R<Value> {
        match self.eval(e)? {
            Val::S(v) => Ok(v),
            Val::T(_) => Err("a table of values was supplied where a single value was expected".into()),
        }
    }

    fn tv(&self, e: &D) -> R<Tv> {
        match e {
            D::Name(n) => {
                let t = self.table_of(n)?;
                Ok(Tv { t, rows: self.visible(t), col: None })
            }
            D::Col(t, c) => {
                let (ti, ci) = self.col_of(t.as_deref(), c)?;
                Ok(Tv { t: ti, rows: self.visible(ti), col: Some(ci) })
            }
            o => match self.eval(o)? {
                Val::T(t) => Ok(t),
                Val::S(_) => Err("a table was expected".into()),
            },
        }
    }

    fn distinct(&self, t: usize, c: usize, rows: &[usize]) -> Vec<usize> {
        let col = &self.m.tables[t].cols[c].data;
        let mut seen = HashSet::new();
        rows.iter().copied().filter(|r| seen.insert(key_of(&col[*r]))).collect()
    }

    fn values_of(&self, e: &D) -> R<Vec<Value>> {
        let tv = self.tv(e)?;
        let Some(c) = tv.col else { return Err("a column was expected".into()) };
        let col = &self.m.tables[tv.t].cols[c].data;
        Ok(tv.rows.iter().map(|r| col[*r].clone()).collect())
    }

    fn eval(&self, e: &D) -> R<Val> {
        Ok(match e {
            D::Num(n) => Val::S(Value::Number(*n)),
            D::Str(s) => Val::S(Value::Text(s.clone())),
            D::Bool(b) => Val::S(Value::Bool(*b)),
            D::Col(t, c) => return self.col_val(t.as_deref(), c),
            D::Name(_) => Val::T(self.tv(e)?),
            D::Neg(x) => Val::S(clean(-num_of(&self.sc(x)?)?)),
            D::Not(x) => Val::S(Value::Bool(!truth(&self.sc(x)?)?)),
            D::In(x, list) => {
                let v = self.sc(x)?;
                let mut hit = false;
                for i in list {
                    if order(&v, &self.sc(i)?) == Ordering::Equal {
                        hit = true;
                        break;
                    }
                }
                Val::S(Value::Bool(hit))
            }
            D::Bin(op, a, b) => Val::S(self.bin(*op, a, b)?),
            D::Call(n, a) => return self.call(n, a),
        })
    }

    fn bin(&self, op: Op, a: &D, b: &D) -> R<Value> {
        if op == Op::And || op == Op::Or {
            let l = truth(&self.sc(a)?)?;
            if (op == Op::And && !l) || (op == Op::Or && l) {
                return Ok(Value::Bool(l));
            }
            return Ok(Value::Bool(truth(&self.sc(b)?)?));
        }
        let (x, y) = (self.sc(a)?, self.sc(b)?);
        Ok(match op {
            Op::Add => clean(num_of(&x)? + num_of(&y)?),
            Op::Sub => clean(num_of(&x)? - num_of(&y)?),
            Op::Mul => clean(num_of(&x)? * num_of(&y)?),
            Op::Div => {
                let d = num_of(&y)?;
                if d == 0.0 {
                    return Err("division by zero".into());
                }
                clean(num_of(&x)? / d)
            }
            Op::Pow => clean(num_of(&x)?.powf(num_of(&y)?)),
            Op::Cat => Value::Text(format!("{}{}", text_of(&x), text_of(&y))),
            Op::Eq => Value::Bool(order(&x, &y) == Ordering::Equal),
            Op::Ne => Value::Bool(order(&x, &y) != Ordering::Equal),
            Op::Lt => Value::Bool(order(&x, &y) == Ordering::Less),
            Op::Le => Value::Bool(order(&x, &y) != Ordering::Greater),
            Op::Gt => Value::Bool(order(&x, &y) == Ordering::Greater),
            Op::Ge => Value::Bool(order(&x, &y) != Ordering::Less),
            Op::And | Op::Or => Value::Empty,
        })
    }

    fn aggregate(&self, name: &str, vals: Vec<Value>) -> R<Value> {
        let nums: Vec<f64> = vals.iter().filter_map(|v| if let Value::Number(n) = v { Some(*n) } else { None }).collect();
        Ok(match name {
            "SUM" | "SUMX" => {
                if nums.is_empty() {
                    Value::Empty
                } else {
                    clean(nums.iter().sum())
                }
            }
            "AVERAGE" | "AVERAGEX" => {
                if nums.is_empty() {
                    Value::Empty
                } else {
                    clean(nums.iter().sum::<f64>() / nums.len() as f64)
                }
            }
            "MIN" | "MINX" => nums.iter().copied().reduce(f64::min).map_or(Value::Empty, clean),
            "MAX" | "MAXX" => nums.iter().copied().reduce(f64::max).map_or(Value::Empty, clean),
            "COUNT" | "COUNTX" => Value::Number(nums.len() as f64),
            "COUNTA" => Value::Number(vals.iter().filter(|v| **v != Value::Empty).count() as f64),
            "DISTINCTCOUNT" => Value::Number(vals.iter().map(key_of).collect::<HashSet<_>>().len() as f64),
            _ => return Err(format!("{name} is not available")),
        })
    }

    fn call(&self, name: &str, a: &[D]) -> R<Val> {
        let need = |lo: usize, hi: usize| -> R<()> {
            if a.len() < lo || a.len() > hi {
                Err(format!("{name} needs {} argument{}", if lo == hi { lo.to_string() } else { format!("{lo} to {hi}") }, if hi == 1 { "" } else { "s" }))
            } else {
                Ok(())
            }
        };
        let s = |v: Value| Ok(Val::S(v));
        match name {
            "SUM" | "AVERAGE" | "COUNT" | "COUNTA" | "DISTINCTCOUNT" => {
                need(1, 1)?;
                s(self.aggregate(name, self.values_of(&a[0])?)?)
            }
            "MIN" | "MAX" => {
                need(1, 2)?;
                if a.len() == 2 {
                    let (x, y) = (self.sc(&a[0])?, self.sc(&a[1])?);
                    let pick = (order(&x, &y) == Ordering::Less) == (name == "MIN");
                    return s(if pick { x } else { y });
                }
                s(self.aggregate(name, self.values_of(&a[0])?)?)
            }
            "COUNTROWS" => {
                need(1, 1)?;
                s(Value::Number(self.tv(&a[0])?.rows.len() as f64))
            }
            "SUMX" | "AVERAGEX" | "MINX" | "MAXX" | "COUNTX" => {
                need(2, 2)?;
                let tv = self.tv(&a[0])?;
                let mut vals = Vec::with_capacity(tv.rows.len());
                let mut e = self.fork();
                e.rows.push((tv.t, 0));
                let last = e.rows.len() - 1;
                for r in &tv.rows {
                    e.rows[last].1 = *r;
                    vals.push(e.sc(&a[1])?);
                }
                s(self.aggregate(name, vals)?)
            }
            "FILTER" => {
                need(2, 2)?;
                let tv = self.tv(&a[0])?;
                let mut e = self.fork();
                e.rows.push((tv.t, 0));
                let last = e.rows.len() - 1;
                let mut keep = Vec::new();
                for r in &tv.rows {
                    e.rows[last].1 = *r;
                    if truth(&e.sc(&a[1])?)? {
                        keep.push(*r);
                    }
                }
                Ok(Val::T(Tv { t: tv.t, rows: keep, col: tv.col }))
            }
            "ALL" | "ALLSELECTED" => {
                need(1, 1)?;
                match &a[0] {
                    D::Name(n) => {
                        let t = self.table_of(n)?;
                        Ok(Val::T(Tv { t, rows: (0..self.m.tables[t].rows).collect(), col: None }))
                    }
                    D::Col(t, c) => {
                        let (ti, ci) = self.col_of(t.as_deref(), c)?;
                        let all: Vec<usize> = (0..self.m.tables[ti].rows).collect();
                        Ok(Val::T(Tv { t: ti, rows: self.distinct(ti, ci, &all), col: Some(ci) }))
                    }
                    _ => Err("ALL needs a table or a column".into()),
                }
            }
            "VALUES" | "DISTINCT" => {
                need(1, 1)?;
                let tv = self.tv(&a[0])?;
                match tv.col {
                    Some(c) => Ok(Val::T(Tv { t: tv.t, rows: self.distinct(tv.t, c, &tv.rows), col: Some(c) })),
                    None => Ok(Val::T(tv)),
                }
            }
            "SELECTEDVALUE" => {
                need(1, 2)?;
                let tv = self.tv(&a[0])?;
                let c = tv.col.ok_or("SELECTEDVALUE needs a column")?;
                let d = self.distinct(tv.t, c, &tv.rows);
                if d.len() == 1 {
                    s(self.m.tables[tv.t].cols[c].data[d[0]].clone())
                } else if a.len() == 2 {
                    s(self.sc(&a[1])?)
                } else {
                    s(Value::Empty)
                }
            }
            "HASONEVALUE" => {
                need(1, 1)?;
                let tv = self.tv(&a[0])?;
                let c = tv.col.ok_or("HASONEVALUE needs a column")?;
                s(Value::Bool(self.distinct(tv.t, c, &tv.rows).len() == 1))
            }
            "RELATED" => {
                need(1, 1)?;
                let D::Col(t, c) = &a[0] else { return Err("RELATED needs a column".into()) };
                let (target, ci) = self.col_of(t.as_deref(), c)?;
                let Some(&(t0, r0)) = self.rows.last() else { return Err("RELATED needs a row context".into()) };
                if t0 == target {
                    return s(self.m.tables[target].cols[ci].data[r0].clone());
                }
                let mut at = (t0, r0);
                let mut guard = 0;
                while at.0 != target && guard < 8 {
                    guard += 1;
                    let Some((ri, rel)) = self.m.rels.iter().enumerate().find(|(ri, r)| self.act[*ri] && r.fi == at.0 && r.err.is_none() && self.m.reaches(r.ti, target, &self.act, 0)) else { return Err(format!("the table '{}' is not related to '{}'", self.m.tables[t0].name, self.m.tables[target].name)) };
                    match self.m.links[ri][at.1] {
                        Some(k) => at = (rel.ti, k as usize),
                        None => return s(Value::Empty),
                    }
                }
                s(self.m.tables[target].cols[ci].data[at.1].clone())
            }
            "DIVIDE" => {
                need(2, 3)?;
                let (x, y) = (self.sc(&a[0])?, self.sc(&a[1])?);
                let d = num_of(&y)?;
                if d == 0.0 || y == Value::Empty {
                    return s(if a.len() == 3 { self.sc(&a[2])? } else { Value::Empty });
                }
                s(clean(num_of(&x)? / d))
            }
            "IF" => {
                need(2, 3)?;
                if truth(&self.sc(&a[0])?)? {
                    Ok(Val::S(self.sc(&a[1])?))
                } else if a.len() == 3 {
                    Ok(Val::S(self.sc(&a[2])?))
                } else {
                    s(Value::Empty)
                }
            }
            "IFERROR" => {
                need(2, 2)?;
                match self.sc(&a[0]) {
                    Ok(v) => s(v),
                    Err(_) => Ok(Val::S(self.sc(&a[1])?)),
                }
            }
            "SWITCH" => {
                if a.len() < 3 {
                    return Err("SWITCH needs a value, a match and a result".into());
                }
                let v = self.sc(&a[0])?;
                let mut i = 1;
                while i + 1 < a.len() {
                    if order(&v, &self.sc(&a[i])?) == Ordering::Equal {
                        return Ok(Val::S(self.sc(&a[i + 1])?));
                    }
                    i += 2;
                }
                if i < a.len() {
                    Ok(Val::S(self.sc(&a[i])?))
                } else {
                    s(Value::Empty)
                }
            }
            "AND" | "OR" => {
                need(2, 2)?;
                s(Value::Bool(self.bin(if name == "AND" { Op::And } else { Op::Or }, &a[0], &a[1])? == Value::Bool(true)))
            }
            "NOT" => {
                need(1, 1)?;
                s(Value::Bool(!truth(&self.sc(&a[0])?)?))
            }
            "TRUE" => s(Value::Bool(true)),
            "FALSE" => s(Value::Bool(false)),
            "BLANK" => s(Value::Empty),
            "ISBLANK" => {
                need(1, 1)?;
                s(Value::Bool(self.sc(&a[0])? == Value::Empty))
            }
            "ROUND" => {
                need(2, 2)?;
                let (x, d) = (num_of(&self.sc(&a[0])?)?, num_of(&self.sc(&a[1])?)?);
                let k = 10f64.powi(d as i32);
                s(clean((x * k).round() / k))
            }
            "ABS" => {
                need(1, 1)?;
                s(clean(num_of(&self.sc(&a[0])?)?.abs()))
            }
            "INT" => {
                need(1, 1)?;
                s(clean(num_of(&self.sc(&a[0])?)?.floor()))
            }
            "CONCATENATE" => {
                need(2, 2)?;
                s(Value::Text(format!("{}{}", text_of(&self.sc(&a[0])?), text_of(&self.sc(&a[1])?))))
            }
            "CALCULATE" => {
                if a.is_empty() {
                    return Err("CALCULATE needs an expression".into());
                }
                let mut e = if self.rows.is_empty() { self.fork() } else { self.transitioned() };
                for f in &a[1..] {
                    self.apply(&mut e, f)?;
                }
                e.rows.clear();
                e.eval(&a[0])
            }
            "USERELATIONSHIP" | "ALLEXCEPT" | "KEEPFILTERS" => Err(format!("{name} can only be used as a filter of CALCULATE")),
            _ => Err(format!("the function {name} is not available in FormCel's DAX")),
        }
    }

    fn apply(&self, e: &mut Env<'a>, f: &D) -> R<()> {
        e.memo.borrow_mut().clear();
        match f {
            D::Call(n, args) if n == "ALL" || n == "ALLSELECTED" => {
                if args.is_empty() {
                    for t in e.tf.iter_mut() {
                        *t = Tf::default();
                    }
                }
                for x in args {
                    match x {
                        D::Name(t) => {
                            let ti = self.table_of(t)?;
                            e.tf[ti] = Tf::default();
                        }
                        D::Col(t, c) => {
                            let (ti, ci) = self.col_of(t.as_deref(), c)?;
                            e.tf[ti].cols.retain(|(k, _)| *k != ci);
                        }
                        _ => return Err("ALL needs a table or a column".into()),
                    }
                }
                Ok(())
            }
            D::Call(n, args) if n == "ALLEXCEPT" => {
                let Some(D::Name(t)) = args.first() else { return Err("ALLEXCEPT needs a table first".into()) };
                let ti = self.table_of(t)?;
                let mut keep = Vec::new();
                for x in &args[1..] {
                    if let D::Col(tt, c) = x {
                        keep.push(self.col_of(tt.as_deref().or(Some(t)), c)?.1);
                    }
                }
                let old = std::mem::take(&mut e.tf[ti].cols);
                e.tf[ti] = Tf { rows: None, cols: old.into_iter().filter(|(c, _)| keep.contains(c)).collect() };
                Ok(())
            }
            D::Call(n, args) if n == "USERELATIONSHIP" => {
                let (D::Col(t1, c1), Some(D::Col(t2, c2))) = (args.first().ok_or("USERELATIONSHIP needs two columns")?, args.get(1)) else { return Err("USERELATIONSHIP needs two columns".into()) };
                let (a, b) = (self.col_of(t1.as_deref(), c1)?, self.col_of(t2.as_deref(), c2)?);
                let hit = self.m.rels.iter().position(|r| (r.fi, r.fci, r.ti, r.tci) == (a.0, a.1, b.0, b.1) || (r.fi, r.fci, r.ti, r.tci) == (b.0, b.1, a.0, a.1)).ok_or("there is no relationship between those columns")?;
                let (fi, ti) = (self.m.rels[hit].fi, self.m.rels[hit].ti);
                for (i, r) in self.m.rels.iter().enumerate() {
                    if (r.fi == fi && r.ti == ti) || (r.fi == ti && r.ti == fi) {
                        e.act[i] = i == hit;
                    }
                }
                Ok(())
            }
            D::Call(n, args) if n == "KEEPFILTERS" && args.len() == 1 => self.apply(e, &args[0]),
            D::Bin(Op::And, x, y) => {
                self.apply(e, x)?;
                self.apply(e, y)
            }
            D::Bin(op @ (Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge), x, y) if matches!(**x, D::Col(..)) && !has_col(y) => self.apply_cmp(e, x, *op, y),
            D::Bin(op @ (Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge), x, y) if matches!(**y, D::Col(..)) && !has_col(x) => {
                let flip = match op {
                    Op::Lt => Op::Gt,
                    Op::Le => Op::Ge,
                    Op::Gt => Op::Lt,
                    Op::Ge => Op::Le,
                    o => *o,
                };
                self.apply_cmp(e, y, flip, x)
            }
            D::In(x, list) if matches!(**x, D::Col(..)) && !list.iter().any(has_col) => {
                let D::Col(t, c) = &**x else { return Ok(()) };
                let (ti, ci) = self.col_of(t.as_deref(), c)?;
                let mut vals = Vec::new();
                for i in list {
                    vals.push(self.sc(i)?);
                }
                self.set_keys(e, ti, ci, |v| vals.iter().any(|w| order(v, w) == Ordering::Equal));
                Ok(())
            }
            D::Bin(..) | D::In(..) | D::Not(_) | D::Bool(_) => self.apply_rows(e, f),
            other => {
                let tv = self.tv(other)?;
                match tv.col {
                    Some(c) => {
                        let col = &self.m.tables[tv.t].cols[c].data;
                        let keys: HashSet<String> = tv.rows.iter().map(|r| key_of(&col[*r])).collect();
                        e.tf[tv.t].cols.retain(|(k, _)| *k != c);
                        e.tf[tv.t].cols.push((c, Rc::new(keys)));
                    }
                    None => {
                        let mut mask = vec![false; self.m.tables[tv.t].rows];
                        for r in &tv.rows {
                            mask[*r] = true;
                        }
                        e.tf[tv.t] = Tf { rows: Some(Rc::new(mask)), cols: Vec::new() };
                    }
                }
                Ok(())
            }
        }
    }

    fn set_keys(&self, e: &mut Env<'a>, t: usize, c: usize, ok: impl Fn(&Value) -> bool) {
        let col = &self.m.tables[t].cols[c].data;
        let keys: HashSet<String> = col.iter().filter(|v| ok(v)).map(key_of).collect();
        e.tf[t].cols.retain(|(k, _)| *k != c);
        e.tf[t].cols.push((c, Rc::new(keys)));
    }

    fn apply_cmp(&self, e: &mut Env<'a>, col: &D, op: Op, rhs: &D) -> R<()> {
        let D::Col(t, c) = col else { return Ok(()) };
        let (ti, ci) = self.col_of(t.as_deref(), c)?;
        let w = self.sc(rhs)?;
        self.set_keys(e, ti, ci, |v| {
            let o = order(v, &w);
            match op {
                Op::Eq => o == Ordering::Equal,
                Op::Ne => o != Ordering::Equal,
                Op::Lt => o == Ordering::Less,
                Op::Le => o != Ordering::Greater,
                Op::Gt => o == Ordering::Greater,
                _ => o != Ordering::Less,
            }
        });
        Ok(())
    }

    fn apply_rows(&self, e: &mut Env<'a>, cond: &D) -> R<()> {
        let mut tabs = Vec::new();
        tables_in(cond, &mut tabs);
        tabs.sort();
        tabs.dedup();
        let [name] = tabs.as_slice() else { return Err("a filter must use columns of exactly one table".into()) };
        let t = self.table_of(name)?;
        let mut probe = self.fork();
        probe.tf[t] = Tf::default();
        probe.rows.push((t, 0));
        let mut mask = vec![false; self.m.tables[t].rows];
        for (r, m) in mask.iter_mut().enumerate() {
            probe.rows[0].1 = r;
            *m = truth(&probe.sc(cond)?)?;
        }
        e.tf[t] = Tf { rows: Some(Rc::new(mask)), cols: Vec::new() };
        Ok(())
    }
}

fn has_col(e: &D) -> bool {
    match e {
        D::Col(..) | D::Name(_) => true,
        D::Neg(x) | D::Not(x) => has_col(x),
        D::Bin(_, x, y) => has_col(x) || has_col(y),
        D::In(x, l) => has_col(x) || l.iter().any(has_col),
        D::Call(_, a) => a.iter().any(has_col),
        _ => false,
    }
}

fn tables_in(e: &D, out: &mut Vec<String>) {
    match e {
        D::Col(Some(t), _) => out.push(t.to_ascii_lowercase()),
        D::Neg(x) | D::Not(x) => tables_in(x, out),
        D::Bin(_, x, y) => {
            tables_in(x, out);
            tables_in(y, out);
        }
        D::In(x, l) => {
            tables_in(x, out);
            l.iter().for_each(|i| tables_in(i, out));
        }
        D::Call(_, a) => a.iter().for_each(|i| tables_in(i, out)),
        _ => {}
    }
}

pub fn refs(e: &D, out: &mut Vec<(Option<String>, String)>) {
    match e {
        D::Col(t, c) => out.push((t.clone(), c.clone())),
        D::Name(n) => out.push((Some(n.clone()), String::new())),
        D::Neg(x) | D::Not(x) => refs(x, out),
        D::Bin(_, x, y) => {
            refs(x, out);
            refs(y, out);
        }
        D::In(x, l) => {
            refs(x, out);
            l.iter().for_each(|i| refs(i, out));
        }
        D::Call(_, a) => a.iter().for_each(|i| refs(i, out)),
        _ => {}
    }
}

fn scalar(v: Val) -> R<Value> {
    match v {
        Val::S(v) => Ok(v),
        Val::T(_) => Err("the formula returns a table, not a value".into()),
    }
}

pub fn measure(m: &Model, mi: usize, filters: &[Flt]) -> R<Value> {
    let mut e = Env::new(m);
    for f in filters {
        e.filter(f);
    }
    scalar(e.measure_val(mi)?)
}

pub fn expr(m: &Model, d: &D, filters: &[Flt]) -> R<Value> {
    let mut e = Env::new(m);
    for f in filters {
        e.filter(f);
    }
    scalar(e.eval(d)?)
}

pub fn column(m: &Model, t: usize, d: &D) -> R<Vec<Value>> {
    let mut e = Env::new(m);
    e.rows.push((t, 0));
    let mut out = Vec::with_capacity(m.tables[t].rows);
    for r in 0..m.tables[t].rows {
        e.rows[0].1 = r;
        out.push(match e.sc(d) {
            Ok(v) => v,
            Err(msg) => return Err(msg),
        });
    }
    Ok(out)
}

pub fn check_names(m: &Model, d: &D, home: Option<&str>) -> R<()> {
    let mut list = Vec::new();
    refs(d, &mut list);
    for (t, c) in list {
        match (t, c.as_str()) {
            (Some(t), "") => {
                m.tidx(&t).ok_or_else(|| format!("the table '{t}' does not exist"))?;
            }
            (Some(t), c) => {
                let ti = m.tidx(&t).ok_or_else(|| format!("the table '{t}' does not exist"))?;
                m.cidx(ti, c).ok_or_else(|| format!("the column '{c}' does not exist in the table '{t}'"))?;
            }
            (None, c) => {
                let col = home.and_then(|h| m.tidx(h)).is_some_and(|ti| m.cidx(ti, c).is_some());
                if !col && m.midx(c).is_none() {
                    return Err(format!("[{c}] is not a column of the table or a measure"));
                }
            }
        }
    }
    Ok(())
}
