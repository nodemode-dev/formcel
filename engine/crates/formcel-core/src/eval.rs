use crate::formula::{Area, ErrKind, Expr, Op};
use crate::{Addr, Value};

pub trait Ctx {
    fn sheet_index(&self, name: &str) -> Option<usize>;
    fn cell(&self, sheet: usize, a: Addr) -> Value;
    fn each(&self, sheet: usize, area: Area, f: &mut dyn FnMut(Addr, &Value));
}

enum Arg {
    V(Value),
    R(usize, Area),
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
    pub ctx: &'a dyn Ctx,
    pub sheet: usize,
}

impl Eval<'_> {
    pub fn formula(&self, e: &Expr) -> Value {
        match self.scalar(e) {
            Value::Empty => Value::Number(0.0),
            v => v,
        }
    }

    fn arg(&self, e: &Expr) -> Arg {
        match e {
            Expr::Ref(sheet, kind) => match self.resolve(sheet.as_deref()) {
                Some(s) => Arg::R(s, kind.area()),
                None => Arg::V(err(ErrKind::Ref)),
            },
            Expr::Paren(x) => self.arg(x),
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
        }
    }

    pub fn scalar(&self, e: &Expr) -> Value {
        match e {
            Expr::Num(n) => Value::Number(*n),
            Expr::Str(s) => Value::Text(s.clone()),
            Expr::Bool(b) => Value::Bool(*b),
            Expr::Err(k) => err(*k),
            Expr::Missing => Value::Empty,
            Expr::Name(_) => err(ErrKind::Name),
            Expr::Ref(..) | Expr::Paren(_) => {
                let a = self.arg(e);
                self.deref(a)
            }
            Expr::Neg(x) => match number_of(&self.scalar(x)) {
                Ok(n) => num(-n),
                Err(k) => err(k),
            },
            Expr::Pos(x) => self.scalar(x),
            Expr::Pct(x) => match number_of(&self.scalar(x)) {
                Ok(n) => num(n / 100.0),
                Err(k) => err(k),
            },
            Expr::Bin(op, a, b) => self.binary(*op, &self.scalar(a), &self.scalar(b)),
            Expr::Call(name, args) => self.call(name, args),
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
                "IF" => {
                    if !count(2, 3) {
                        return Err(ErrKind::Na);
                    }
                    if bool_of(&self.scalar(&a[0]))? {
                        self.scalar(&a[1])
                    } else if a.len() == 3 {
                        self.scalar(&a[2])
                    } else {
                        Value::Bool(false)
                    }
                }
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
                            r @ Arg::R(..) => out.push_str(&text_of(&self.deref(r))?),
                        }
                    }
                    Value::Text(out)
                }
                "ISBLANK" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Empty)),
                "ISNUMBER" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Number(_))),
                "ISTEXT" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Text(_))),
                "ISERROR" => Value::Bool(matches!(self.scalar(a.first().ok_or(ErrKind::Na)?), Value::Error(_))),
                "NA" => return Err(ErrKind::Na),
                _ => return Err(ErrKind::Name),
            })
        })();
        r.unwrap_or_else(err)
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
