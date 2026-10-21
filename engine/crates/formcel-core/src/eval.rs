use crate::formula::{Area, ErrKind, Expr, Op};
use crate::{numfmt, Addr, Value};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

pub trait Ctx {
    fn sheet_index(&self, name: &str) -> Option<usize>;
    fn cell(&self, sheet: usize, a: Addr) -> Value;
    fn each(&self, sheet: usize, area: Area, f: &mut dyn FnMut(Addr, &Value));
    fn name(&self, name: &str) -> Option<&Expr>;
}

#[derive(Debug)]
pub struct Lambda {
    params: Vec<String>,
    body: Expr,
    env: Vec<(String, Arg)>,
}

const MAX_DEPTH: u32 = 200;

#[derive(Clone, Debug, PartialEq)]
pub struct Array {
    pub rows: usize,
    pub cols: usize,
    pub data: Vec<Value>,
}

impl Array {
    fn get(&self, r: usize, c: usize) -> &Value {
        &self.data[r * self.cols + c]
    }

    fn pick(&self, r: usize, c: usize) -> Value {
        let rr = if self.rows == 1 { 0 } else { r };
        let cc = if self.cols == 1 { 0 } else { c };
        if rr < self.rows && cc < self.cols {
            self.get(rr, cc).clone()
        } else {
            err(ErrKind::Na)
        }
    }
}

enum Src {
    R(usize, Area),
    A(Array),
}

impl Src {
    fn dims(&self) -> (u32, u32) {
        match self {
            Src::R(_, t) => (t.r1 - t.r0 + 1, t.c1 - t.c0 + 1),
            Src::A(x) => (x.rows as u32, x.cols as u32),
        }
    }
}

pub enum Out {
    V(Value),
    A(Array),
}

const MAX_ARRAY: u64 = 2_000_000;

#[derive(Clone, Debug)]
enum Arg {
    V(Value),
    R(usize, Area),
    A(Array),
    F(Rc<Lambda>),
}

fn multi(a: &Arg) -> bool {
    match a {
        Arg::V(_) | Arg::F(_) => false,
        Arg::R(_, ar) => ar.r0 != ar.r1 || ar.c0 != ar.c1,
        Arg::A(x) => x.rows * x.cols != 1,
    }
}

const SCOPED_FNS: [&str; 2] = ["LET", "LAMBDA"];

fn zero(v: Value) -> Value {
    if v == Value::Empty {
        Value::Number(0.0)
    } else {
        v
    }
}

fn hull(a: Area, b: Area) -> Area {
    Area { r0: a.r0.min(b.r0), c0: a.c0.min(b.c0), r1: a.r1.max(b.r1), c1: a.c1.max(b.c1) }
}

const ARRAY_FNS: [&str; 27] = [
    "INDEX", "CHOOSE", "SEQUENCE", "TRANSPOSE", "IF", "FILTER", "SORT", "SORTBY", "UNIQUE", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL", "MAKEARRAY", "VSTACK", "HSTACK", "TOCOL", "TOROW", "TAKE",
    "DROP", "CHOOSECOLS", "CHOOSEROWS", "WRAPROWS", "WRAPCOLS", "EXPAND", "TEXTSPLIT",
];

fn split_on(s: &str, delims: &[String], fold: bool) -> Vec<String> {
    let cs: Vec<char> = s.chars().collect();
    let ds: Vec<Vec<char>> = delims.iter().map(|d| d.chars().collect()).collect();
    let same = |a: char, b: char| a == b || (fold && a.to_lowercase().eq(b.to_lowercase()));
    let mut out = vec![String::new()];
    let mut i = 0;
    while i < cs.len() {
        let hit = ds.iter().filter(|d| !d.is_empty() && i + d.len() <= cs.len() && d.iter().enumerate().all(|(k, &c)| same(cs[i + k], c))).map(Vec::len).max();
        match hit {
            Some(n) => {
                out.push(String::new());
                i += n;
            }
            None => {
                if let Some(x) = out.last_mut() {
                    x.push(cs[i]);
                }
                i += 1;
            }
        }
    }
    out
}

fn transposed(g: &Array) -> Array {
    let mut data = Vec::with_capacity(g.data.len());
    for c in 0..g.cols {
        for r in 0..g.rows {
            data.push(g.get(r, c).clone());
        }
    }
    Array { rows: g.cols, cols: g.rows, data }
}

fn pick_rows(g: &Array, keep: &[usize]) -> Array {
    let mut data = Vec::with_capacity(keep.len() * g.cols);
    for &r in keep {
        data.extend_from_slice(&g.data[r * g.cols..(r + 1) * g.cols]);
    }
    Array { rows: keep.len(), cols: g.cols, data }
}

fn sort_key(a: &Value, b: &Value) -> std::cmp::Ordering {
    match (a, b) {
        (Value::Empty, Value::Empty) => std::cmp::Ordering::Equal,
        (Value::Empty, _) => std::cmp::Ordering::Greater,
        (_, Value::Empty) => std::cmp::Ordering::Less,
        (Value::Error(_), Value::Error(_)) => std::cmp::Ordering::Equal,
        (Value::Error(_), _) => std::cmp::Ordering::Greater,
        (_, Value::Error(_)) => std::cmp::Ordering::Less,
        _ => compare(a, b),
    }
}

fn err(e: ErrKind) -> Value {
    Value::Error(e)
}

pub fn number_of(v: &Value) -> Result<f64, ErrKind> {
    match v {
        Value::Empty => Ok(0.0),
        Value::Number(n) => Ok(*n),
        Value::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
        Value::Text(s) => match Value::parse_input(s) {
            Value::Number(n) => Ok(n),
            Value::Empty => Err(ErrKind::Value),
            _ => Err(ErrKind::Value),
        },
        Value::Error(e) => Err(*e),
    }
}

fn bool_of(v: &Value) -> Result<bool, ErrKind> {
    match v {
        Value::Empty => Ok(false),
        Value::Bool(b) => Ok(*b),
        Value::Number(n) => Ok(*n != 0.0),
        Value::Text(s) => match s.trim().to_ascii_uppercase().as_str() {
            "TRUE" => Ok(true),
            "FALSE" => Ok(false),
            _ => Err(ErrKind::Value),
        },
        Value::Error(e) => Err(*e),
    }
}

fn text_of(v: &Value) -> Result<String, ErrKind> {
    match v {
        Value::Error(e) => Err(*e),
        o => Ok(o.to_string()),
    }
}

fn num(n: f64) -> Value {
    if n.is_finite() {
        Value::Number(if n == 0.0 { 0.0 } else { n })
    } else {
        err(ErrKind::Num)
    }
}

pub struct Eval<'a> {
    ctx: &'a dyn Ctx,
    sheet: usize,
    env: RefCell<Vec<(String, Arg)>>,
    depth: Cell<u32>,
}

impl<'a> Eval<'a> {
    pub fn new(ctx: &'a dyn Ctx, sheet: usize) -> Self {
        Eval { ctx, sheet, env: RefCell::new(Vec::new()), depth: Cell::new(0) }
    }

    fn local(&self, name: &str) -> Option<Arg> {
        let env = self.env.borrow();
        env.iter().rev().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, a)| a.clone())
    }

    fn user(&self, name: &str) -> bool {
        crate::formula::FUNCTIONS.binary_search(&name).is_err() && (self.local(name).is_some() || self.ctx.name(name).is_some())
    }

    fn routed(&self, name: &str) -> bool {
        ARRAY_FNS.contains(&name) || SCOPED_FNS.contains(&name) || self.user(name)
    }

    fn deeper<T>(&self, f: impl FnOnce() -> Result<T, ErrKind>) -> Result<T, ErrKind> {
        let d = self.depth.get();
        if d >= MAX_DEPTH {
            return Err(ErrKind::Num);
        }
        self.depth.set(d + 1);
        let r = f();
        self.depth.set(d);
        r
    }

    fn named(&self, name: &str) -> Result<Arg, ErrKind> {
        if let Some(a) = self.local(name) {
            return Ok(a);
        }
        let e = self.ctx.name(name).ok_or(ErrKind::Name)?;
        self.deeper(|| {
            let saved = std::mem::take(&mut *self.env.borrow_mut());
            let a = self.arg(e);
            *self.env.borrow_mut() = saved;
            Ok(a)
        })
    }

    fn invoke(&self, f: Arg, args: &[Expr]) -> Result<Arg, ErrKind> {
        let f = match f {
            Arg::F(f) => f,
            Arg::V(Value::Error(k)) => return Err(k),
            _ => return Err(ErrKind::Value),
        };
        if f.params.len() != args.len() {
            return Err(ErrKind::Value);
        }
        let vals: Vec<Arg> = args.iter().map(|a| self.arg(a)).collect();
        self.apply(&f, vals)
    }

    fn lambda(&self, e: &Expr, params: usize) -> Result<Rc<Lambda>, ErrKind> {
        match self.arg(e) {
            Arg::F(f) if f.params.len() == params => Ok(f),
            Arg::V(Value::Error(k)) => Err(k),
            _ => Err(ErrKind::Value),
        }
    }

    fn apply(&self, f: &Rc<Lambda>, vals: Vec<Arg>) -> Result<Arg, ErrKind> {
        self.deeper(|| {
            let mut env = f.env.clone();
            env.extend(f.params.iter().cloned().zip(vals));
            let saved = std::mem::replace(&mut *self.env.borrow_mut(), env);
            let a = self.arg(&f.body);
            *self.env.borrow_mut() = saved;
            Ok(a)
        })
    }

    fn scoped(&self, name: &str, a: &[Expr]) -> Result<Arg, ErrKind> {
        let ident = |e: &Expr| match e {
            Expr::Name(n) if crate::formula::valid_local(n) => Ok(n.to_ascii_uppercase()),
            _ => Err(ErrKind::Value),
        };
        if name == "LAMBDA" {
            let (body, params) = a.split_last().ok_or(ErrKind::Value)?;
            if params.len() > 253 {
                return Err(ErrKind::Value);
            }
            let params = params.iter().map(ident).collect::<Result<Vec<_>, _>>()?;
            return Ok(Arg::F(Rc::new(Lambda { params, body: body.clone(), env: self.env.borrow().clone() })));
        }
        if a.len() < 3 || a.len().is_multiple_of(2) {
            return Err(ErrKind::Value);
        }
        let base = self.env.borrow().len();
        for p in a[..a.len() - 1].chunks(2) {
            match ident(&p[0]) {
                Ok(n) => {
                    let v = self.arg(&p[1]);
                    self.env.borrow_mut().push((n, v));
                }
                Err(k) => {
                    self.env.borrow_mut().truncate(base);
                    return Err(k);
                }
            }
        }
        let out = self.arg(&a[a.len() - 1]);
        self.env.borrow_mut().truncate(base);
        Ok(out)
    }
    pub fn formula(&self, e: &Expr) -> Out {
        let a = self.arg(e);
        if !multi(&a) {
            return Out::V(zero(self.deref(a)));
        }
        match self.grid(a) {
            Ok(g) => Out::A(Array { data: g.data.into_iter().map(zero).collect(), ..g }),
            Err(k) => Out::V(err(k)),
        }
    }

    fn grid(&self, a: Arg) -> Result<Array, ErrKind> {
        match a {
            Arg::V(v) => Ok(Array { rows: 1, cols: 1, data: vec![v] }),
            Arg::A(x) => Ok(x),
            Arg::F(_) => Err(ErrKind::Calc),
            Arg::R(s, ar) => {
                let (h, w) = ((ar.r1 - ar.r0 + 1) as usize, (ar.c1 - ar.c0 + 1) as usize);
                if (h as u64) * (w as u64) > MAX_ARRAY {
                    return Err(ErrKind::Value);
                }
                let mut data = vec![Value::Empty; h * w];
                self.ctx.each(s, ar, &mut |p, v| data[(p.row - ar.r0) as usize * w + (p.col - ar.c0) as usize] = v.clone());
                Ok(Array { rows: h, cols: w, data })
            }
        }
    }

    fn lift(&self, x: Arg, y: Option<Arg>, f: &dyn Fn(&Value, &Value) -> Value) -> Arg {
        let gx = match self.grid(x) {
            Ok(g) => g,
            Err(k) => return Arg::V(err(k)),
        };
        let gy = match y.map(|y| self.grid(y)) {
            Some(Ok(g)) => g,
            Some(Err(k)) => return Arg::V(err(k)),
            None => Array { rows: 1, cols: 1, data: vec![Value::Empty] },
        };
        let (rows, cols) = (gx.rows.max(gy.rows), gx.cols.max(gy.cols));
        let mut data = Vec::with_capacity(rows * cols);
        for r in 0..rows {
            for c in 0..cols {
                data.push(f(&gx.pick(r, c), &gy.pick(r, c)));
            }
        }
        Arg::A(Array { rows, cols, data })
    }

    fn arg(&self, e: &Expr) -> Arg {
        match e {
            Expr::Ref(sheet, kind) => match self.resolve(sheet.as_deref()) {
                Some(s) => Arg::R(s, kind.area()),
                None => Arg::V(err(ErrKind::Ref)),
            },
            Expr::Paren(x) => self.arg(x),
            Expr::Array(rows) => Arg::A(Array { rows: rows.len(), cols: rows[0].len(), data: rows.iter().flatten().map(|x| self.scalar(x)).collect() }),
            Expr::Range(a, b) => match (self.arg(a), self.arg(b)) {
                (Arg::R(s1, x), Arg::R(s2, y)) if s1 == s2 => Arg::R(s1, hull(x, y)),
                (Arg::V(Value::Error(k)), _) | (_, Arg::V(Value::Error(k))) => Arg::V(err(k)),
                _ => Arg::V(err(ErrKind::Ref)),
            },
            Expr::Bin(op, a, b) => {
                let (x, y) = (self.arg(a), self.arg(b));
                if multi(&x) || multi(&y) {
                    self.lift(x, Some(y), &|p, q| self.binary(*op, p, q))
                } else {
                    Arg::V(self.binary(*op, &self.deref(x), &self.deref(y)))
                }
            }
            Expr::Neg(x) | Expr::Pct(x) => {
                let pct = matches!(e, Expr::Pct(_));
                let f = |v: &Value, _: &Value| match number_of(v) {
                    Ok(n) => num(if pct { n / 100.0 } else { -n }),
                    Err(k) => err(k),
                };
                let a = self.arg(x);
                if multi(&a) {
                    self.lift(a, None, &f)
                } else {
                    Arg::V(f(&self.deref(a), &Value::Empty))
                }
            }
            Expr::Call(name, args) if self.routed(name) => {
                let r = if self.user(name) {
                    self.named(name).and_then(|f| self.invoke(f, args))
                } else if SCOPED_FNS.contains(&name.as_str()) {
                    self.scoped(name, args)
                } else {
                    self.call_arg(name, args)
                };
                r.unwrap_or_else(|k| Arg::V(err(k)))
            }
            Expr::Name(n) => self.named(n).unwrap_or_else(|k| Arg::V(err(k))),
            Expr::Invoke(f, args) => self.invoke(self.arg(f), args).unwrap_or_else(|k| Arg::V(err(k))),
            o => Arg::V(self.scalar(o)),
        }
    }

    fn resolve(&self, sheet: Option<&str>) -> Option<usize> {
        match sheet {
            None => Some(self.sheet),
            Some(n) => self.ctx.sheet_index(n),
        }
    }

    fn deref(&self, a: Arg) -> Value {
        match a {
            Arg::V(v) => v,
            Arg::R(s, ar) => {
                if ar.r0 == ar.r1 && ar.c0 == ar.c1 {
                    self.ctx.cell(s, Addr { row: ar.r0, col: ar.c0 })
                } else {
                    err(ErrKind::Value)
                }
            }
            Arg::A(x) => {
                if x.rows * x.cols == 1 {
                    x.data[0].clone()
                } else {
                    err(ErrKind::Value)
                }
            }
            Arg::F(_) => err(ErrKind::Calc),
        }
    }

    pub fn scalar(&self, e: &Expr) -> Value {
        match e {
            Expr::Num(n) => Value::Number(*n),
            Expr::Str(s) => Value::Text(s.clone()),
            Expr::Bool(b) => Value::Bool(*b),
            Expr::Err(k) => err(*k),
            Expr::Missing => Value::Empty,
            Expr::Pos(x) => self.scalar(x),
            Expr::Union(_) => err(ErrKind::Value),
            Expr::Call(name, args) if !self.routed(name) => self.call(name, args),
            _ => {
                let a = self.arg(e);
                self.deref(a)
            }
        }
    }

    fn binary(&self, op: Op, a: &Value, b: &Value) -> Value {
        if let Value::Error(k) = a {
            return err(*k);
        }
        if let Value::Error(k) = b {
            return err(*k);
        }
        match op {
            Op::Cat => Value::Text(format!("{}{}", a, b)),
            Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => {
                let o = compare(a, b);
                Value::Bool(match op {
                    Op::Eq => o == std::cmp::Ordering::Equal,
                    Op::Ne => o != std::cmp::Ordering::Equal,
                    Op::Lt => o == std::cmp::Ordering::Less,
                    Op::Le => o != std::cmp::Ordering::Greater,
                    Op::Gt => o == std::cmp::Ordering::Greater,
                    _ => o != std::cmp::Ordering::Less,
                })
            }
            _ => {
                let (x, y) = match (number_of(a), number_of(b)) {
                    (Ok(x), Ok(y)) => (x, y),
                    (Err(k), _) | (_, Err(k)) => return err(k),
                };
                match op {
                    Op::Add => num(x + y),
                    Op::Sub => num(x - y),
                    Op::Mul => num(x * y),
                    Op::Div => {
                        if y == 0.0 {
                            err(ErrKind::Div0)
                        } else {
                            num(x / y)
                        }
                    }
                    _ => {
                        if x == 0.0 && y == 0.0 {
                            err(ErrKind::Num)
                        } else {
                            num(x.powf(y))
                        }
                    }
                }
            }
        }
    }

    fn values(&self, args: &[Expr], f: &mut dyn FnMut(&Value, bool) -> Result<(), ErrKind>) -> Result<(), ErrKind> {
        for a in args {
            match self.arg(a) {
                Arg::V(v) => f(&v, true)?,
                Arg::R(s, ar) => {
                    let mut out = Ok(());
                    self.ctx.each(s, ar, &mut |_, v| {
                        if out.is_ok() {
                            out = f(v, false);
                        }
                    });
                    out?;
                }
                Arg::A(x) => {
                    for v in &x.data {
                        f(v, false)?;
                    }
                }
                Arg::F(_) => f(&err(ErrKind::Calc), true)?,
            }
        }
        Ok(())
    }

    fn numbers(&self, args: &[Expr]) -> Result<Vec<f64>, ErrKind> {
        let mut out = Vec::new();
        self.values(args, &mut |v, direct| {
            match v {
                Value::Error(k) => return Err(*k),
                Value::Number(n) => out.push(*n),
                Value::Bool(_) | Value::Text(_) if direct => out.push(number_of(v)?),
                Value::Empty if direct => out.push(0.0),
                _ => {}
            }
            Ok(())
        })?;
        Ok(out)
    }

    fn n(&self, args: &[Expr], i: usize) -> Result<f64, ErrKind> {
        args.get(i).map_or(Ok(0.0), |e| number_of(&self.scalar(e)))
    }

    fn t(&self, args: &[Expr], i: usize) -> Result<String, ErrKind> {
        args.get(i).map_or(Ok(String::new()), |e| text_of(&self.scalar(e)))
    }

    fn call(&self, name: &str, a: &[Expr]) -> Value {
        let count = |min: usize, max: usize| a.len() >= min && a.len() <= max;
        let r: Result<Value, ErrKind> = (|| {
            Ok(match name {
                "IFERROR" | "IFNA" => {
                    if !count(2, 2) {
                        return Err(ErrKind::Na);
                    }
                    match self.scalar(&a[0]) {
                        Value::Error(k) if name == "IFERROR" || k == ErrKind::Na => self.scalar(&a[1]),
                        v => v,
                    }
                }
                "SUM" => num(self.numbers(a)?.iter().sum()),
                "SUMSQ" => num(self.numbers(a)?.iter().map(|x| x * x).sum()),
                "PRODUCT" => num(self.numbers(a)?.iter().product()),
                "AVERAGE" => {
                    let v = self.numbers(a)?;
                    if v.is_empty() {
                        return Err(ErrKind::Div0);
                    }
                    num(v.iter().sum::<f64>() / v.len() as f64)
                }
                "MIN" => num(self.numbers(a)?.into_iter().reduce(f64::min).unwrap_or(0.0)),
                "MAX" => num(self.numbers(a)?.into_iter().reduce(f64::max).unwrap_or(0.0)),
                "COUNT" => {
                    let mut c = 0.0;
                    self.values(a, &mut |v, direct| {
                        if matches!(v, Value::Number(_)) || (direct && number_of(v).is_ok() && !matches!(v, Value::Empty)) {
                            c += 1.0;
                        }
                        Ok(())
                    })?;
                    Value::Number(c)
                }
                "COUNTA" => {
                    let mut c = 0.0;
                    for e in a {
                        match self.arg(e) {
                            Arg::V(v) => {
                                if !matches!(e, Expr::Missing) || v != Value::Empty {
                                    c += 1.0;
                                }
                            }
                            Arg::R(s, ar) => self.ctx.each(s, ar, &mut |_, v| {
                                if *v != Value::Empty {
                                    c += 1.0;
                                }
                            }),
                            Arg::A(x) => c += x.data.len() as f64,
                            Arg::F(_) => c += 1.0,
                        }
                    }
                    Value::Number(c)
                }
                "COUNTBLANK" => {
                    let Some(Arg::R(s, ar)) = a.first().map(|e| self.arg(e)) else { return Err(ErrKind::Value) };
                    let mut filled = 0.0;
                    self.ctx.each(s, ar, &mut |_, v| {
                        if !matches!(v, Value::Text(t) if t.is_empty()) {
                            filled += 1.0;
                        }
                    });
                    let total = f64::from(ar.r1 - ar.r0 + 1) * f64::from(ar.c1 - ar.c0 + 1);
                    Value::Number(total - filled)
                }
                "AND" | "OR" | "XOR" => {
                    let mut seen = 0usize;
                    let mut trues = 0usize;
                    self.values(a, &mut |v, direct| {
                        match v {
                            Value::Error(k) => return Err(*k),
                            Value::Bool(b) => {
                                seen += 1;
                                trues += usize::from(*b);
                            }
                            Value::Number(n) => {
                                seen += 1;
                                trues += usize::from(*n != 0.0);
                            }
                            Value::Text(_) if direct => {
                                let b = bool_of(v)?;
                                seen += 1;
                                trues += usize::from(b);
                            }
                            _ => {}
                        }
                        Ok(())
                    })?;
                    if seen == 0 {
                        return Err(ErrKind::Value);
                    }
                    Value::Bool(match name {
                        "AND" => trues == seen,
                        "OR" => trues > 0,
                        _ => trues % 2 == 1,
                    })
                }
                "NOT" => Value::Bool(!bool_of(&self.scalar(a.first().ok_or(ErrKind::Na)?))?),
                "TRUE" => Value::Bool(true),
                "FALSE" => Value::Bool(false),
                "ABS" => num(self.n(a, 0)?.abs()),
                "INT" => num(self.n(a, 0)?.floor()),
                "SQRT" => {
                    let x = self.n(a, 0)?;
                    if x < 0.0 {
                        return Err(ErrKind::Num);
                    }
                    num(x.sqrt())
                }
                "POWER" => self.binary(Op::Pow, &Value::Number(self.n(a, 0)?), &Value::Number(self.n(a, 1)?)),
                "MOD" => {
                    let (x, y) = (self.n(a, 0)?, self.n(a, 1)?);
                    if y == 0.0 {
                        return Err(ErrKind::Div0);
                    }
                    num(x - y * (x / y).floor())
                }
                "PI" => Value::Number(std::f64::consts::PI),
                "ROUND" | "ROUNDUP" | "ROUNDDOWN" => {
                    let (x, d) = (self.n(a, 0)?, self.n(a, 1)?.trunc());
                    let m = 10f64.powf(d);
                    let s = sig15(x * m);
                    let r = match name {
                        "ROUND" => (s.abs() + 0.5).floor() * s.signum(),
                        "ROUNDUP" => s.abs().ceil() * s.signum(),
                        _ => s.abs().floor() * s.signum(),
                    };
                    num(r / m)
                }
                "LEN" => Value::Number(self.t(a, 0)?.chars().count() as f64),
                "UPPER" => Value::Text(self.t(a, 0)?.to_uppercase()),
                "LOWER" => Value::Text(self.t(a, 0)?.to_lowercase()),
                "TRIM" => Value::Text(self.t(a, 0)?.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")),
                "LEFT" | "RIGHT" => {
                    let s: Vec<char> = self.t(a, 0)?.chars().collect();
                    let k = if a.len() > 1 { self.n(a, 1)? } else { 1.0 };
                    if k < 0.0 {
                        return Err(ErrKind::Value);
                    }
                    let k = (k as usize).min(s.len());
                    let part = if name == "LEFT" { &s[..k] } else { &s[s.len() - k..] };
                    Value::Text(part.iter().collect())
                }
                "MID" => {
                    let s: Vec<char> = self.t(a, 0)?.chars().collect();
                    let (st, k) = (self.n(a, 1)?, self.n(a, 2)?);
                    if st < 1.0 || k < 0.0 {
                        return Err(ErrKind::Value);
                    }
                    Value::Text(s.iter().skip(st as usize - 1).take(k as usize).collect())
                }
                "SUBSTITUTE" => {
                    if !count(3, 4) {
                        return Err(ErrKind::Na);
                    }
                    let (s, old, new) = (self.t(a, 0)?, self.t(a, 1)?, self.t(a, 2)?);
                    if old.is_empty() {
                        return Ok(Value::Text(s));
                    }
                    if a.len() == 3 {
                        return Ok(Value::Text(s.replace(&old, &new)));
                    }
                    let k = self.n(a, 3)?.trunc();
                    if k < 1.0 {
                        return Err(ErrKind::Value);
                    }
                    match s.match_indices(&old).nth(k as usize - 1) {
                        Some((i, _)) => Value::Text(format!("{}{}{}", &s[..i], new, &s[i + old.len()..])),
                        None => Value::Text(s),
                    }
                }
                "CONCAT" | "CONCATENATE" => {
                    let mut out = String::new();
                    for e in a {
                        match self.arg(e) {
                            Arg::V(v) => out.push_str(&text_of(&v)?),
                            Arg::R(s, ar) if name == "CONCAT" => {
                                let mut bad = None;
                                self.ctx.each(s, ar, &mut |_, v| match v {
                                    Value::Error(k) => bad = bad.or(Some(*k)),
                                    o => out.push_str(&o.to_string()),
                                });
                                if let Some(k) = bad {
                                    return Err(k);
                                }
                            }
                            Arg::A(x) if name == "CONCAT" => {
                                for v in &x.data {
                                    out.push_str(&text_of(v)?);
                                }
                            }
                            r => out.push_str(&text_of(&self.deref(r))?),
                        }
                    }
                    Value::Text(out)
                }
                "ISBLANK" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Empty)),
                "ISNUMBER" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Number(_))),
                "ISTEXT" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Text(_))),
                "ISERROR" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Error(_))),
                "ISNA" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Error(ErrKind::Na))),
                "ISERR" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Error(k) if k != ErrKind::Na)),
                "ISLOGICAL" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Bool(_))),
                "ISNONTEXT" => Value::Bool(!matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Text(_))),
                "ISREF" => Value::Bool(matches!(self.arg(a.first().ok_or(ErrKind::Na)?), Arg::R(..))),
                "NA" => return Err(ErrKind::Na),
                "DATE" => {
                    if !count(3, 3) {
                        return Err(ErrKind::Na);
                    }
                    let mut y = self.n(a, 0)?.trunc() as i64;
                    if (0..1900).contains(&y) {
                        y += 1900;
                    }
                    if !(1900..10000).contains(&y) {
                        return Err(ErrKind::Num);
                    }
                    let s = numfmt::serial(y, self.n(a, 1)?.trunc() as i64, self.n(a, 2)?.trunc() as i64).ok_or(ErrKind::Num)?;
                    Value::Number(s)
                }
                "YEAR" | "MONTH" | "DAY" => {
                    let (y, m, d) = numfmt::ymd(self.date_arg(a, 0)?).ok_or(ErrKind::Num)?;
                    Value::Number(match name {
                        "YEAR" => y,
                        "MONTH" => m,
                        _ => d,
                    } as f64)
                }
                "HOUR" | "MINUTE" | "SECOND" => {
                    let (h, m, s) = numfmt::hms(self.date_arg(a, 0)?);
                    Value::Number(match name {
                        "HOUR" => h,
                        "MINUTE" => m,
                        _ => s,
                    } as f64)
                }
                "WEEKDAY" => {
                    let serial = self.date_arg(a, 0)?;
                    let w = numfmt::weekday(serial);
                    let t = if a.len() > 1 { self.n(a, 1)?.trunc() as i64 } else { 1 };
                    let r = match t {
                        1 | 17 => w,
                        2 | 11 => (w + 5) % 7 + 1,
                        3 => (w + 5) % 7,
                        12..=16 => (w - (t - 10) + 7) % 7 + 1,
                        _ => return Err(ErrKind::Num),
                    };
                    Value::Number(r as f64)
                }
                "TODAY" => Value::Number(numfmt::now().floor()),
                "NOW" => Value::Number(numfmt::now()),
                "TIME" => {
                    let (h, m, s) = (self.n(a, 0)?.trunc(), self.n(a, 1)?.trunc(), self.n(a, 2)?.trunc());
                    let t = (h * 3600.0 + m * 60.0 + s) / 86_400.0;
                    if t < 0.0 {
                        return Err(ErrKind::Num);
                    }
                    num(t - t.floor())
                }
                "DATEVALUE" | "TIMEVALUE" => {
                    let s = self.t(a, 0)?;
                    let (v, _) = numfmt::parse(&s).ok_or(ErrKind::Value)?;
                    num(if name == "DATEVALUE" { v.floor() } else { v - v.floor() })
                }
                "EDATE" | "EOMONTH" => {
                    let (y, m, d) = numfmt::ymd(self.date_arg(a, 0)?).ok_or(ErrKind::Num)?;
                    let k = self.n(a, 1)?.trunc() as i64;
                    let s = if name == "EDATE" {
                        let target = numfmt::serial(y, m + k, 1).ok_or(ErrKind::Num)?;
                        let last = numfmt::serial(y, m + k + 1, 1).ok_or(ErrKind::Num)? - target;
                        target + (d.min(last as i64) - 1) as f64
                    } else {
                        numfmt::serial(y, m + k + 1, 1).ok_or(ErrKind::Num)? - 1.0
                    };
                    num(s)
                }
                "DAYS" => num(self.date_arg(a, 0)?.floor() - self.date_arg(a, 1)?.floor()),
                "IFS" => {
                    if a.len() < 2 || !a.len().is_multiple_of(2) {
                        return Err(ErrKind::Na);
                    }
                    for p in a.chunks(2) {
                        if bool_of(&self.scalar(&p[0]))? {
                            return Ok(self.scalar(&p[1]));
                        }
                    }
                    return Err(ErrKind::Na);
                }
                "SWITCH" => {
                    if a.len() < 3 {
                        return Err(ErrKind::Na);
                    }
                    let v = self.scalar(&a[0]);
                    if let Value::Error(k) = v {
                        return Err(k);
                    }
                    let rest = &a[1..];
                    for p in rest.chunks(2) {
                        if p.len() == 1 {
                            return Ok(self.scalar(&p[0]));
                        }
                        if same(&v, &self.scalar(&p[0])) {
                            return Ok(self.scalar(&p[1]));
                        }
                    }
                    return Err(ErrKind::Na);
                }
                "SUMIF" | "AVERAGEIF" | "COUNTIF" => {
                    if !count(2, if name == "COUNTIF" { 2 } else { 3 }) {
                        return Err(ErrKind::Na);
                    }
                    let (s, area) = self.range(&a[0])?;
                    let hits = self.matching(&[(s, area, self.scalar(&a[1]))])?;
                    let target = if a.len() == 3 { self.range(&a[2])? } else { (s, area) };
                    self.aggregate(name, &hits, target)?
                }
                "SUMIFS" | "AVERAGEIFS" | "COUNTIFS" => {
                    let start = usize::from(name != "COUNTIFS");
                    if a.len() < start + 2 || !(a.len() - start).is_multiple_of(2) {
                        return Err(ErrKind::Na);
                    }
                    let mut pairs = Vec::new();
                    for p in a[start..].chunks(2) {
                        let (s, area) = self.range(&p[0])?;
                        pairs.push((s, area, self.scalar(&p[1])));
                    }
                    let shape = |ar: &Area| (ar.r1 - ar.r0, ar.c1 - ar.c0);
                    if pairs.iter().any(|p| shape(&p.1) != shape(&pairs[0].1)) {
                        return Err(ErrKind::Value);
                    }
                    let hits = self.matching(&pairs)?;
                    let target = if start == 1 { self.range(&a[0])? } else { (pairs[0].0, pairs[0].1) };
                    if start == 1 && shape(&target.1) != shape(&pairs[0].1) {
                        return Err(ErrKind::Value);
                    }
                    self.aggregate(name, &hits, target)?
                }
                "VLOOKUP" | "HLOOKUP" => {
                    if !count(3, 4) {
                        return Err(ErrKind::Na);
                    }
                    let key = self.scalar(&a[0]);
                    if let Value::Error(k) = key {
                        return Err(k);
                    }
                    let t = self.table(&a[1])?;
                    let (h, w) = t.dims();
                    let k = self.n(a, 2)?.trunc();
                    let approx = a.len() < 4 || matches!(a[3], Expr::Missing) || bool_of(&self.scalar(&a[3]))?;
                    let vertical = name == "VLOOKUP";
                    let width = if vertical { w } else { h };
                    if k < 1.0 {
                        return Err(ErrKind::Value);
                    }
                    if k as u32 > width {
                        return Err(ErrKind::Ref);
                    }
                    let pos = self.find(&key, self.line(&t, vertical, 0), if approx { 1 } else { 2 }, false)?.ok_or(ErrKind::Na)?;
                    let off = k as u32 - 1;
                    if vertical {
                        self.at(&t, pos, off)
                    } else {
                        self.at(&t, off, pos)
                    }
                }
                "MATCH" | "XMATCH" => {
                    if !count(2, if name == "MATCH" { 3 } else { 4 }) {
                        return Err(ErrKind::Na);
                    }
                    let key = self.scalar(&a[0]);
                    if let Value::Error(k) = key {
                        return Err(k);
                    }
                    let t = self.table(&a[1])?;
                    let (h, w) = t.dims();
                    if h != 1 && w != 1 {
                        return Err(ErrKind::Na);
                    }
                    let opt = |i: usize, d: f64| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { self.n(a, i) } else { Ok(d) } };
                    let (mode, back) = if name == "MATCH" {
                        (match opt(2, 1.0)? { m if m > 0.0 => 1, m if m < 0.0 => -1, _ => 2 }, false)
                    } else {
                        (xmode(opt(2, 0.0)?)?, opt(3, 1.0)? < 0.0)
                    };
                    let pos = self.find(&key, self.line(&t, w == 1, 0), mode, back)?.ok_or(ErrKind::Na)?;
                    Value::Number(f64::from(pos + 1))
                }
                "XLOOKUP" => {
                    if !count(3, 6) {
                        return Err(ErrKind::Na);
                    }
                    let key = self.scalar(&a[0]);
                    if let Value::Error(k) = key {
                        return Err(k);
                    }
                    let (look, ret) = (self.table(&a[1])?, self.table(&a[2])?);
                    let ((lh, lw), (rh, rw)) = (look.dims(), ret.dims());
                    let vertical = lw == 1;
                    if (lh != 1 && lw != 1) || (vertical && (lh != rh || rw != 1)) || (!vertical && (lw != rw || rh != 1)) {
                        return Err(ErrKind::Value);
                    }
                    let opt = |i: usize, d: f64| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { self.n(a, i) } else { Ok(d) } };
                    let mode = xmode(opt(4, 0.0)?)?;
                    let back = opt(5, 1.0)? < 0.0;
                    match self.find(&key, self.line(&look, vertical, 0), mode, back)? {
                        Some(p) => self.at(&ret, if vertical { p } else { 0 }, if vertical { 0 } else { p }),
                        None if a.len() > 3 && !matches!(a[3], Expr::Missing) => self.scalar(&a[3]),
                        None => return Err(ErrKind::Na),
                    }
                }
                _ => return Err(ErrKind::Name),
            })
        })();
        r.unwrap_or_else(err)
    }
}

impl Eval<'_> {
    fn date_arg(&self, a: &[Expr], i: usize) -> Result<f64, ErrKind> {
        let v = self.scalar(a.get(i).ok_or(ErrKind::Na)?);
        let n = match &v {
            Value::Text(s) => numfmt::parse(s).map(|p| p.0).ok_or(ErrKind::Value)?,
            o => number_of(o)?,
        };
        if n < 0.0 {
            return Err(ErrKind::Num);
        }
        Ok(n)
    }

    fn range(&self, e: &Expr) -> Result<(usize, Area), ErrKind> {
        match self.arg(e) {
            Arg::R(s, ar) => Ok((s, ar)),
            Arg::V(Value::Error(k)) => Err(k),
            _ => Err(ErrKind::Value),
        }
    }

    fn table(&self, e: &Expr) -> Result<Src, ErrKind> {
        match self.arg(e) {
            Arg::R(s, ar) => Ok(Src::R(s, ar)),
            Arg::A(x) => Ok(Src::A(x)),
            Arg::F(_) => Err(ErrKind::Calc),
            Arg::V(Value::Error(k)) => Err(k),
            Arg::V(v) => Ok(Src::A(Array { rows: 1, cols: 1, data: vec![v] })),
        }
    }

    fn at(&self, t: &Src, r: u32, c: u32) -> Value {
        match t {
            Src::R(s, ar) => self.ctx.cell(*s, Addr { row: ar.r0 + r, col: ar.c0 + c }),
            Src::A(x) => x.get(r as usize, c as usize).clone(),
        }
    }

    fn line(&self, t: &Src, vertical: bool, k: u32) -> Vec<(u32, Value)> {
        match t {
            Src::R(s, ar) => {
                let sub = if vertical { Area { c0: ar.c0 + k, c1: ar.c0 + k, ..*ar } } else { Area { r0: ar.r0 + k, r1: ar.r0 + k, ..*ar } };
                let mut cells = Vec::new();
                self.ctx.each(*s, sub, &mut |a, v| cells.push((if vertical { a.row - ar.r0 } else { a.col - ar.c0 }, v.clone())));
                cells.sort_by_key(|c| c.0);
                cells
            }
            Src::A(x) if vertical => (0..x.rows).map(|r| (r as u32, x.get(r, k as usize).clone())).collect(),
            Src::A(x) => (0..x.cols).map(|c| (c as u32, x.get(k as usize, c).clone())).collect(),
        }
    }

    fn call_arg(&self, name: &str, a: &[Expr]) -> Result<Arg, ErrKind> {
        match name {
            "IF" => {
                if a.len() < 2 || a.len() > 3 {
                    return Err(ErrKind::Na);
                }
                let branch = |yes: bool| if yes { self.arg(&a[1]) } else if a.len() == 3 { self.arg(&a[2]) } else { Arg::V(Value::Bool(false)) };
                let c = self.arg(&a[0]);
                if !multi(&c) {
                    return Ok(branch(bool_of(&self.deref(c))?));
                }
                let g = self.grid(c)?;
                let (y, n) = (self.grid(branch(true))?, self.grid(branch(false))?);
                let (rows, cols) = (g.rows.max(y.rows).max(n.rows), g.cols.max(y.cols).max(n.cols));
                let mut data = Vec::with_capacity(rows * cols);
                for r in 0..rows {
                    for col in 0..cols {
                        data.push(match bool_of(&g.pick(r, col)) {
                            Ok(true) => y.pick(r, col),
                            Ok(false) => n.pick(r, col),
                            Err(k) => err(k),
                        });
                    }
                }
                Ok(Arg::A(Array { rows, cols, data }))
            }
            "CHOOSE" => {
                let i = self.n(a, 0)?.trunc();
                if i < 1.0 || i as usize >= a.len() {
                    return Err(ErrKind::Value);
                }
                Ok(self.arg(&a[i as usize]))
            }
            "INDEX" => {
                if a.len() < 2 || a.len() > 4 {
                    return Err(ErrKind::Na);
                }
                let opt = |i: usize| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { Ok(self.n(a, i)?.trunc()) } else { Ok(0.0) } };
                let mut head = &a[0];
                while let Expr::Paren(x) = head {
                    head = x;
                }
                let t = match head {
                    Expr::Union(items) => {
                        let k = if a.len() == 4 { opt(3)? } else { 1.0 };
                        if k < 1.0 || k as usize > items.len() {
                            return Err(ErrKind::Ref);
                        }
                        self.table(&items[k as usize - 1])?
                    }
                    e => {
                        if a.len() == 4 && opt(3)? != 1.0 {
                            return Err(ErrKind::Ref);
                        }
                        self.table(e)?
                    }
                };
                let (h, w) = t.dims();
                let (i, j) = (opt(1)?, opt(2)?);
                let (r, c) = if a.len() == 2 && h == 1 { (1.0, i) } else if a.len() == 2 && w == 1 { (i, 1.0) } else { (i, j) };
                if r < 0.0 || c < 0.0 {
                    return Err(ErrKind::Value);
                }
                if r as u32 > h || c as u32 > w {
                    return Err(ErrKind::Ref);
                }
                let (r0, r1) = if r == 0.0 { (0, h - 1) } else { (r as u32 - 1, r as u32 - 1) };
                let (c0, c1) = if c == 0.0 { (0, w - 1) } else { (c as u32 - 1, c as u32 - 1) };
                Ok(match t {
                    Src::R(s, ar) => Arg::R(s, Area { r0: ar.r0 + r0, c0: ar.c0 + c0, r1: ar.r0 + r1, c1: ar.c0 + c1 }),
                    Src::A(x) => {
                        let mut data = Vec::new();
                        for rr in r0..=r1 {
                            for cc in c0..=c1 {
                                data.push(x.get(rr as usize, cc as usize).clone());
                            }
                        }
                        Arg::A(Array { rows: (r1 - r0 + 1) as usize, cols: (c1 - c0 + 1) as usize, data })
                    }
                })
            }
            "SEQUENCE" => {
                if a.is_empty() || a.len() > 4 {
                    return Err(ErrKind::Na);
                }
                let opt = |i: usize, d: f64| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { self.n(a, i) } else { Ok(d) } };
                let (rows, cols) = (opt(0, 1.0)?.trunc(), opt(1, 1.0)?.trunc());
                let (start, step) = (opt(2, 1.0)?, opt(3, 1.0)?);
                if rows < 1.0 || cols < 1.0 {
                    return Err(ErrKind::Calc);
                }
                if rows * cols > MAX_ARRAY as f64 {
                    return Err(ErrKind::Value);
                }
                let (rows, cols) = (rows as usize, cols as usize);
                Ok(Arg::A(Array { rows, cols, data: (0..rows * cols).map(|k| num(start + step * k as f64)).collect() }))
            }
            "TRANSPOSE" => {
                if a.len() != 1 {
                    return Err(ErrKind::Na);
                }
                let g = self.grid(self.arg(&a[0]))?;
                let mut data = Vec::with_capacity(g.data.len());
                for c in 0..g.cols {
                    for r in 0..g.rows {
                        data.push(zero(g.get(r, c).clone()));
                    }
                }
                Ok(Arg::A(Array { rows: g.cols, cols: g.rows, data }))
            }
            "FILTER" => {
                if a.len() < 2 || a.len() > 3 {
                    return Err(ErrKind::Na);
                }
                let g = self.grid(self.arg(&a[0]))?;
                let inc = self.grid(self.arg(&a[1]))?;
                let by_row = inc.cols == 1 && inc.rows == g.rows;
                if !by_row && !(inc.rows == 1 && inc.cols == g.cols) {
                    return Err(ErrKind::Value);
                }
                let mut keep = Vec::new();
                for (i, v) in inc.data.iter().enumerate() {
                    if bool_of(v)? {
                        keep.push(i);
                    }
                }
                if keep.is_empty() {
                    return match a.get(2) {
                        Some(e) if !matches!(e, Expr::Missing) => Ok(self.arg(e)),
                        _ => Err(ErrKind::Calc),
                    };
                }
                Ok(Arg::A(if by_row { pick_rows(&g, &keep) } else { transposed(&pick_rows(&transposed(&g), &keep)) }))
            }
            "SORT" | "SORTBY" => {
                let g = self.grid(self.arg(a.first().ok_or(ErrKind::Na)?))?;
                let opt = |i: usize, d: f64| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { self.n(a, i) } else { Ok(d) } };
                let order = |o: f64| match o as i64 {
                    1 => Ok(false),
                    -1 => Ok(true),
                    _ => Err(ErrKind::Value),
                };
                let (by_col, keys): (bool, Vec<(Vec<Value>, bool)>) = if name == "SORT" {
                    if a.len() > 4 {
                        return Err(ErrKind::Na);
                    }
                    let by_col = a.len() > 3 && !matches!(a[3], Expr::Missing) && bool_of(&self.scalar(&a[3]))?;
                    let t = if by_col { transposed(&g) } else { g.clone() };
                    let k = opt(1, 1.0)?.trunc();
                    if k < 1.0 || k as usize > t.cols {
                        return Err(ErrKind::Value);
                    }
                    let col = (0..t.rows).map(|r| t.get(r, k as usize - 1).clone()).collect();
                    (by_col, vec![(col, order(opt(2, 1.0)?)?)])
                } else {
                    if a.len() < 2 {
                        return Err(ErrKind::Na);
                    }
                    let mut keys = Vec::new();
                    let mut dir = None;
                    for (i, p) in a[1..].chunks(2).enumerate() {
                        let k = self.grid(self.arg(&p[0]))?;
                        let this = if k.cols == 1 && k.rows == g.rows { false } else if k.rows == 1 && k.cols == g.cols { true } else { return Err(ErrKind::Value) };
                        if *dir.get_or_insert(this) != this {
                            return Err(ErrKind::Value);
                        }
                        let desc = if p.len() > 1 { order(opt(2 + 2 * i, 1.0)?)? } else { false };
                        keys.push((k.data, desc));
                    }
                    (dir.unwrap_or(false), keys)
                };
                let t = if by_col { transposed(&g) } else { g };
                let mut idx: Vec<usize> = (0..t.rows).collect();
                idx.sort_by(|&x, &y| {
                    for (k, desc) in &keys {
                        let o = sort_key(&k[x], &k[y]);
                        let o = if *desc { o.reverse() } else { o };
                        if o != std::cmp::Ordering::Equal {
                            return o;
                        }
                    }
                    std::cmp::Ordering::Equal
                });
                let out = pick_rows(&t, &idx);
                Ok(Arg::A(if by_col { transposed(&out) } else { out }))
            }
            "UNIQUE" => {
                if a.is_empty() || a.len() > 3 {
                    return Err(ErrKind::Na);
                }
                let flag = |i: usize| -> Result<bool, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { bool_of(&self.scalar(&a[i])) } else { Ok(false) } };
                let (by_col, once) = (flag(1)?, flag(2)?);
                let g = self.grid(self.arg(&a[0]))?;
                let t = if by_col { transposed(&g) } else { g };
                let row = |r: usize| &t.data[r * t.cols..(r + 1) * t.cols];
                let same_row = |x: usize, y: usize| row(x).iter().zip(row(y)).all(|(p, q)| same(p, q) || (*p == Value::Empty && *q == Value::Empty));
                let mut firsts: Vec<(usize, usize)> = Vec::new();
                for r in 0..t.rows {
                    match firsts.iter_mut().find(|(f, _)| same_row(*f, r)) {
                        Some(e) => e.1 += 1,
                        None => firsts.push((r, 1)),
                    }
                }
                let keep: Vec<usize> = firsts.into_iter().filter(|&(_, n)| !once || n == 1).map(|(r, _)| r).collect();
                if keep.is_empty() {
                    return Err(ErrKind::Calc);
                }
                let out = pick_rows(&t, &keep);
                Ok(Arg::A(if by_col { transposed(&out) } else { out }))
            }
            "MAP" => {
                if a.len() < 2 {
                    return Err(ErrKind::Na);
                }
                let f = self.lambda(&a[a.len() - 1], a.len() - 1)?;
                let gs = a[..a.len() - 1].iter().map(|e| self.grid(self.arg(e))).collect::<Result<Vec<_>, _>>()?;
                let (rows, cols) = (gs[0].rows, gs[0].cols);
                let mut data = Vec::with_capacity(rows * cols);
                for r in 0..rows {
                    for c in 0..cols {
                        let vals = gs.iter().map(|g| Arg::V(g.pick(r, c))).collect();
                        data.push(self.deref(self.apply(&f, vals)?));
                    }
                }
                Ok(Arg::A(Array { rows, cols, data }))
            }
            "REDUCE" | "SCAN" => {
                if a.len() < 2 || a.len() > 3 {
                    return Err(ErrKind::Na);
                }
                let (init, arr, lam) = if a.len() == 3 { (Some(&a[0]), &a[1], &a[2]) } else { (None, &a[0], &a[1]) };
                let f = self.lambda(lam, 2)?;
                let g = self.grid(self.arg(arr))?;
                let mut items = g.data.iter();
                let mut acc = match init {
                    Some(e) => self.arg(e),
                    None => Arg::V(items.next().cloned().unwrap_or(Value::Empty)),
                };
                let mut steps = Vec::with_capacity(g.data.len());
                if init.is_none() && !g.data.is_empty() {
                    steps.push(self.deref(acc.clone()));
                }
                for v in items {
                    acc = self.apply(&f, vec![acc, Arg::V(v.clone())])?;
                    if name == "SCAN" {
                        steps.push(self.deref(acc.clone()));
                    }
                }
                if name == "REDUCE" {
                    return Ok(acc);
                }
                Ok(Arg::A(Array { rows: g.rows, cols: g.cols, data: steps }))
            }
            "BYROW" | "BYCOL" => {
                if a.len() != 2 {
                    return Err(ErrKind::Na);
                }
                let f = match self.arg(&a[1]) {
                    Arg::F(f) if f.params.len() == 1 => f,
                    Arg::F(_) => return Err(ErrKind::Value),
                    Arg::V(Value::Error(k)) => return Err(k),
                    _ => return Err(ErrKind::Calc),
                };
                let g = self.grid(self.arg(&a[0]))?;
                let t = if name == "BYCOL" { transposed(&g) } else { g };
                let mut data = Vec::with_capacity(t.rows);
                for r in 0..t.rows {
                    let line = Array { rows: 1, cols: t.cols, data: t.data[r * t.cols..(r + 1) * t.cols].to_vec() };
                    let line = if name == "BYCOL" { transposed(&line) } else { line };
                    let out = self.apply(&f, vec![Arg::A(line)])?;
                    data.push(if multi(&out) { err(ErrKind::Calc) } else { self.deref(out) });
                }
                Ok(Arg::A(if name == "BYCOL" { Array { rows: 1, cols: t.rows, data } } else { Array { rows: t.rows, cols: 1, data } }))
            }
            "MAKEARRAY" => {
                if a.len() != 3 {
                    return Err(ErrKind::Na);
                }
                let dim = |i: usize| -> Result<usize, ErrKind> {
                    match self.scalar(&a[i]) {
                        Value::Number(n) if n.trunc() >= 1.0 => Ok(n.trunc() as usize),
                        _ => Err(ErrKind::Value),
                    }
                };
                let (rows, cols) = (dim(0)?, dim(1)?);
                if (rows as u64) * (cols as u64) > MAX_ARRAY {
                    return Err(ErrKind::Value);
                }
                let f = self.lambda(&a[2], 2)?;
                let mut data = Vec::with_capacity(rows * cols);
                for r in 1..=rows {
                    for c in 1..=cols {
                        data.push(self.deref(self.apply(&f, vec![Arg::V(Value::Number(r as f64)), Arg::V(Value::Number(c as f64))])?));
                    }
                }
                Ok(Arg::A(Array { rows, cols, data }))
            }
            "VSTACK" | "HSTACK" => {
                if a.is_empty() {
                    return Err(ErrKind::Na);
                }
                let gs = a.iter().map(|e| self.grid(self.arg(e))).collect::<Result<Vec<_>, _>>()?;
                let gs: Vec<Array> = if name == "HSTACK" { gs.iter().map(transposed).collect() } else { gs };
                let cols = gs.iter().map(|g| g.cols).max().unwrap_or(0);
                let rows: usize = gs.iter().map(|g| g.rows).sum();
                let mut data = Vec::with_capacity(rows * cols);
                for g in &gs {
                    for r in 0..g.rows {
                        for c in 0..cols {
                            data.push(if c < g.cols { g.get(r, c).clone() } else { err(ErrKind::Na) });
                        }
                    }
                }
                let out = Array { rows, cols, data };
                Ok(Arg::A(if name == "HSTACK" { transposed(&out) } else { out }))
            }
            "TOCOL" | "TOROW" => {
                if a.is_empty() || a.len() > 3 {
                    return Err(ErrKind::Na);
                }
                let g = self.grid(self.arg(&a[0]))?;
                let ignore = if a.len() > 1 && !matches!(a[1], Expr::Missing) { self.n(a, 1)?.trunc() as i64 } else { 0 };
                if !(0..=3).contains(&ignore) {
                    return Err(ErrKind::Value);
                }
                let by_col = a.len() > 2 && !matches!(a[2], Expr::Missing) && bool_of(&self.scalar(&a[2]))?;
                let t = if by_col { transposed(&g) } else { g };
                let data: Vec<Value> = t.data.into_iter().filter(|v| !((ignore & 1 == 1 && *v == Value::Empty) || (ignore & 2 == 2 && matches!(v, Value::Error(_))))).collect();
                if data.is_empty() {
                    return Err(ErrKind::Calc);
                }
                let n = data.len();
                Ok(Arg::A(if name == "TOCOL" { Array { rows: n, cols: 1, data } } else { Array { rows: 1, cols: n, data } }))
            }
            "TAKE" | "DROP" => {
                if a.len() < 2 || a.len() > 3 {
                    return Err(ErrKind::Na);
                }
                let g = self.grid(self.arg(&a[0]))?;
                let count = |i: usize| -> Result<Option<i64>, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { Ok(Some(self.n(a, i)?.trunc() as i64)) } else { Ok(None) } };
                let span = |k: Option<i64>, len: usize| -> Result<(usize, usize), ErrKind> {
                    let len = len as i64;
                    let Some(k) = k else { return Ok((0, len as usize)) };
                    if k == 0 {
                        return Err(ErrKind::Calc);
                    }
                    let (lo, hi) = match (name == "TAKE", k >= 0) {
                        (true, true) => (0, k.min(len)),
                        (true, false) => ((len + k).max(0), len),
                        (false, true) => (k.min(len), len),
                        (false, false) => (0, (len + k).max(0)),
                    };
                    if hi <= lo {
                        return Err(ErrKind::Calc);
                    }
                    Ok((lo as usize, hi as usize))
                };
                let (r0, r1) = span(count(1)?, g.rows)?;
                let (c0, c1) = span(count(2)?, g.cols)?;
                let mut data = Vec::with_capacity((r1 - r0) * (c1 - c0));
                for r in r0..r1 {
                    for c in c0..c1 {
                        data.push(g.get(r, c).clone());
                    }
                }
                Ok(Arg::A(Array { rows: r1 - r0, cols: c1 - c0, data }))
            }
            "CHOOSECOLS" | "CHOOSEROWS" => {
                if a.len() < 2 {
                    return Err(ErrKind::Na);
                }
                let g = self.grid(self.arg(&a[0]))?;
                let t = if name == "CHOOSECOLS" { transposed(&g) } else { g };
                let mut keep = Vec::new();
                for e in &a[1..] {
                    for v in self.grid(self.arg(e))?.data {
                        let k = number_of(&v)?.trunc() as i64;
                        let len = t.rows as i64;
                        if k == 0 || k.abs() > len {
                            return Err(ErrKind::Value);
                        }
                        keep.push(if k > 0 { k - 1 } else { len + k } as usize);
                    }
                }
                let out = pick_rows(&t, &keep);
                Ok(Arg::A(if name == "CHOOSECOLS" { transposed(&out) } else { out }))
            }
            "WRAPROWS" | "WRAPCOLS" => {
                if a.len() < 2 || a.len() > 3 {
                    return Err(ErrKind::Na);
                }
                let g = self.grid(self.arg(&a[0]))?;
                if g.rows != 1 && g.cols != 1 {
                    return Err(ErrKind::Value);
                }
                let w = self.n(a, 1)?.trunc();
                if w < 1.0 {
                    return Err(ErrKind::Num);
                }
                let pad = if a.len() > 2 && !matches!(a[2], Expr::Missing) { self.scalar(&a[2]) } else { err(ErrKind::Na) };
                let n = g.data.len();
                let w = (w as usize).min(n.max(1));
                let lines = n.div_ceil(w);
                let mut data: Vec<Value> = g.data;
                data.resize(lines * w, pad);
                let out = Array { rows: lines, cols: w, data };
                Ok(Arg::A(if name == "WRAPCOLS" { transposed(&out) } else { out }))
            }
            "EXPAND" => {
                if a.len() < 2 || a.len() > 4 {
                    return Err(ErrKind::Na);
                }
                let g = self.grid(self.arg(&a[0]))?;
                let size = |i: usize, d: usize| -> Result<usize, ErrKind> {
                    if a.len() > i && !matches!(a[i], Expr::Missing) {
                        let k = self.n(a, i)?.trunc();
                        if k < d as f64 {
                            return Err(ErrKind::Value);
                        }
                        Ok(k as usize)
                    } else {
                        Ok(d)
                    }
                };
                let (rows, cols) = (size(1, g.rows)?, size(2, g.cols)?);
                if (rows as u64) * (cols as u64) > MAX_ARRAY {
                    return Err(ErrKind::Num);
                }
                let pad = if a.len() > 3 && !matches!(a[3], Expr::Missing) { self.scalar(&a[3]) } else { err(ErrKind::Na) };
                let mut data = Vec::with_capacity(rows * cols);
                for r in 0..rows {
                    for c in 0..cols {
                        data.push(if r < g.rows && c < g.cols { g.get(r, c).clone() } else { pad.clone() });
                    }
                }
                Ok(Arg::A(Array { rows, cols, data }))
            }
            "TEXTSPLIT" => {
                if a.len() < 2 || a.len() > 6 {
                    return Err(ErrKind::Na);
                }
                let text = self.t(a, 0)?;
                let delims = |i: usize| -> Result<Vec<String>, ErrKind> {
                    if a.len() <= i || matches!(a[i], Expr::Missing) {
                        return Ok(Vec::new());
                    }
                    let ds = self.grid(self.arg(&a[i]))?.data.iter().map(text_of).collect::<Result<Vec<_>, _>>()?;
                    if ds.iter().any(String::is_empty) {
                        return Err(ErrKind::Value);
                    }
                    Ok(ds)
                };
                let (cd, rd) = (delims(1)?, delims(2)?);
                if cd.is_empty() && rd.is_empty() {
                    return Err(ErrKind::Value);
                }
                let skip = a.len() > 3 && !matches!(a[3], Expr::Missing) && bool_of(&self.scalar(&a[3]))?;
                let fold = a.len() > 4 && !matches!(a[4], Expr::Missing) && self.n(a, 4)? == 1.0;
                let pad = if a.len() > 5 && !matches!(a[5], Expr::Missing) { self.scalar(&a[5]) } else { err(ErrKind::Na) };
                let lines: Vec<String> = split_on(&text, &rd, fold).into_iter().filter(|l| !(skip && l.is_empty())).collect();
                let cells: Vec<Vec<String>> = lines.iter().map(|l| split_on(l, &cd, fold).into_iter().filter(|p| !(skip && p.is_empty())).collect()).collect();
                let cols = cells.iter().map(Vec::len).max().unwrap_or(0);
                if cells.is_empty() || cols == 0 {
                    return Err(ErrKind::Calc);
                }
                let mut data = Vec::with_capacity(cells.len() * cols);
                for row in &cells {
                    for c in 0..cols {
                        data.push(row.get(c).map_or_else(|| pad.clone(), |p| Value::Text(p.clone())));
                    }
                }
                Ok(Arg::A(Array { rows: cells.len(), cols, data }))
            }
            _ => Err(ErrKind::Name),
        }
    }

    fn matching(&self, pairs: &[(usize, Area, Value)]) -> Result<Vec<(u32, u32)>, ErrKind> {
        let crits = pairs.iter().map(|p| crit_of(&p.2)).collect::<Result<Vec<_>, _>>()?;
        let (s0, a0) = (pairs[0].0, pairs[0].1);
        let total = u64::from(a0.r1 - a0.r0 + 1) * u64::from(a0.c1 - a0.c0 + 1);
        let mut hits = Vec::new();
        if crit_matches(&crits[0], &Value::Empty) && total <= 200_000 {
            for r in a0.r0..=a0.r1 {
                for c in a0.c0..=a0.c1 {
                    if crit_matches(&crits[0], &self.ctx.cell(s0, Addr { row: r, col: c })) {
                        hits.push((r - a0.r0, c - a0.c0));
                    }
                }
            }
        } else {
            self.ctx.each(s0, a0, &mut |a, v| {
                if crit_matches(&crits[0], v) {
                    hits.push((a.row - a0.r0, a.col - a0.c0));
                }
            });
        }
        for (i, p) in pairs.iter().enumerate().skip(1) {
            hits.retain(|&(dr, dc)| crit_matches(&crits[i], &self.ctx.cell(p.0, Addr { row: p.1.r0 + dr, col: p.1.c0 + dc })));
        }
        Ok(hits)
    }

    fn aggregate(&self, name: &str, hits: &[(u32, u32)], (s, t): (usize, Area)) -> Result<Value, ErrKind> {
        if name.starts_with("COUNT") {
            return Ok(Value::Number(hits.len() as f64));
        }
        let mut sum = 0.0;
        let mut n = 0usize;
        for &(dr, dc) in hits {
            let (row, col) = (t.r0 + dr, t.c0 + dc);
            if row >= crate::MAX_ROWS || col >= crate::MAX_COLS {
                continue;
            }
            match self.ctx.cell(s, Addr { row, col }) {
                Value::Number(x) => {
                    sum += x;
                    n += 1;
                }
                Value::Error(k) => return Err(k),
                _ => {}
            }
        }
        if name.starts_with("AVERAGE") {
            if n == 0 {
                return Err(ErrKind::Div0);
            }
            return Ok(num(sum / n as f64));
        }
        Ok(num(sum))
    }

    fn find(&self, key: &Value, mut cells: Vec<(u32, Value)>, mode: i32, back: bool) -> Result<Option<u32>, ErrKind> {
        use std::cmp::Ordering::{Equal, Greater, Less};
        if back {
            cells.reverse();
        }
        match mode {
            0 | 2 => Ok(cells.iter().find(|(_, v)| lookup_eq(key, v, mode == 2)).map(|c| c.0)),
            1 | -1 => {
                let mut best = None;
                for (p, v) in &cells {
                    if rank(v) != rank(key) {
                        continue;
                    }
                    match (compare(v, key), mode) {
                        (Greater, 1) | (Less, -1) => break,
                        _ => best = Some(*p),
                    }
                }
                Ok(best)
            }
            _ => {
                let mut best: Option<(u32, &Value)> = None;
                for (p, v) in &cells {
                    if rank(v) != rank(key) {
                        continue;
                    }
                    let o = compare(v, key);
                    if o == Equal {
                        return Ok(Some(*p));
                    }
                    let side = if mode == 10 { Less } else { Greater };
                    if o == side && best.is_none_or(|(_, b)| compare(v, b) == if mode == 10 { Greater } else { Less }) {
                        best = Some((*p, v));
                    }
                }
                Ok(best.map(|b| b.0))
            }
        }
    }
}

fn xmode(m: f64) -> Result<i32, ErrKind> {
    match m as i64 {
        0 => Ok(0),
        -1 => Ok(10),
        1 => Ok(11),
        2 => Ok(2),
        _ => Err(ErrKind::Value),
    }
}

fn same(a: &Value, b: &Value) -> bool {
    lookup_eq(a, b, false)
}

fn lookup_eq(key: &Value, v: &Value, wild: bool) -> bool {
    match (key, v) {
        (Value::Number(a), Value::Number(b)) => a == b,
        (Value::Text(a), Value::Text(b)) => {
            if wild {
                wild_match(a, b)
            } else {
                a.to_lowercase() == b.to_lowercase()
            }
        }
        (Value::Bool(a), Value::Bool(b)) => a == b,
        _ => false,
    }
}

pub fn wild_match(pattern: &str, text: &str) -> bool {
    let mut p: Vec<(char, bool)> = Vec::new();
    let mut it = pattern.chars().flat_map(char::to_lowercase);
    while let Some(c) = it.next() {
        match c {
            '~' => {
                if let Some(n) = it.next() {
                    p.push((n, false));
                }
            }
            '*' | '?' => p.push((c, true)),
            _ => p.push((c, false)),
        }
    }
    let t: Vec<char> = text.chars().flat_map(char::to_lowercase).collect();
    let mut row = vec![false; t.len() + 1];
    row[0] = true;
    for &(pc, special) in &p {
        let mut next = vec![false; t.len() + 1];
        if special && pc == '*' {
            let mut any = false;
            for j in 0..=t.len() {
                any = any || row[j];
                next[j] = any;
            }
        } else {
            for j in 0..t.len() {
                if row[j] && ((special && pc == '?') || t[j] == pc) {
                    next[j + 1] = true;
                }
            }
        }
        row = next;
    }
    row[t.len()]
}

struct Crit {
    op: Op,
    v: Value,
}

fn crit_of(v: &Value) -> Result<Crit, ErrKind> {
    match v {
        Value::Error(k) => Err(*k),
        Value::Text(s) => {
            let (op, rest) = [("<=", Op::Le), (">=", Op::Ge), ("<>", Op::Ne), ("<", Op::Lt), (">", Op::Gt), ("=", Op::Eq)]
                .into_iter()
                .find_map(|(p, o)| s.strip_prefix(p).map(|r| (o, r)))
                .unwrap_or((Op::Eq, s.as_str()));
            let val = if rest.is_empty() {
                Value::Empty
            } else {
                match Value::parse_input(rest) {
                    Value::Text(_) => Value::Text(rest.to_string()),
                    o => o,
                }
            };
            Ok(Crit { op, v: val })
        }
        o => Ok(Crit { op: Op::Eq, v: o.clone() }),
    }
}

fn holds(op: Op, o: Option<std::cmp::Ordering>) -> bool {
    use std::cmp::Ordering::{Equal, Greater, Less};
    match (op, o) {
        (_, None) => false,
        (Op::Eq, Some(o)) => o == Equal,
        (Op::Ne, Some(o)) => o != Equal,
        (Op::Lt, Some(o)) => o == Less,
        (Op::Le, Some(o)) => o != Greater,
        (Op::Gt, Some(o)) => o == Greater,
        (Op::Ge, Some(o)) => o != Less,
        _ => false,
    }
}

fn crit_matches(c: &Crit, cell: &Value) -> bool {
    match &c.v {
        Value::Empty => {
            let blank = matches!(cell, Value::Empty) || matches!(cell, Value::Text(t) if t.is_empty());
            match c.op {
                Op::Eq => blank,
                Op::Ne => !blank,
                _ => false,
            }
        }
        Value::Number(n) => {
            let x = match cell {
                Value::Number(x) => Some(*x),
                Value::Text(t) if matches!(c.op, Op::Eq | Op::Ne) => match Value::parse_input(t) {
                    Value::Number(x) => Some(x),
                    _ => None,
                },
                _ => None,
            };
            match x {
                Some(x) => holds(c.op, x.partial_cmp(n)),
                None => c.op == Op::Ne,
            }
        }
        Value::Text(p) => match cell {
            Value::Text(t) => match c.op {
                Op::Eq => wild_match(p, t),
                Op::Ne => !wild_match(p, t),
                op => holds(op, Some(t.to_lowercase().cmp(&p.to_lowercase()))),
            },
            _ => c.op == Op::Ne,
        },
        Value::Bool(b) => match cell {
            Value::Bool(x) => holds(c.op, Some(x.cmp(b))),
            _ => c.op == Op::Ne,
        },
        Value::Error(_) => false,
    }
}

pub fn sig15(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    format!("{:.14e}", x).parse().unwrap_or(x)
}

fn rank(v: &Value) -> u8 {
    match v {
        Value::Empty | Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Bool(_) => 2,
        Value::Error(_) => 3,
    }
}

fn compare(a: &Value, b: &Value) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (a, b) = match (a, b) {
        (Value::Empty, Value::Text(_)) => (Value::Text(String::new()), b.clone()),
        (Value::Text(_), Value::Empty) => (a.clone(), Value::Text(String::new())),
        (Value::Empty, Value::Bool(_)) => (Value::Bool(false), b.clone()),
        (Value::Bool(_), Value::Empty) => (a.clone(), Value::Bool(false)),
        _ => (a.clone(), b.clone()),
    };
    let (ra, rb) = (rank(&a), rank(&b));
    if ra != rb {
        return ra.cmp(&rb);
    }
    match (&a, &b) {
        (Value::Text(x), Value::Text(y)) => x.to_lowercase().cmp(&y.to_lowercase()),
        (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
        _ => {
            let x = number_of(&a).unwrap_or(0.0);
            let y = number_of(&b).unwrap_or(0.0);
            x.partial_cmp(&y).unwrap_or(Ordering::Equal)
        }
    }
}
