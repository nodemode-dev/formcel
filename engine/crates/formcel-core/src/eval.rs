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
                "CHOOSE" => {
                    let i = self.n(a, 0)?.trunc();
                    if i < 1.0 || i as usize >= a.len() {
                        return Err(ErrKind::Value);
                    }
                    self.scalar(&a[i as usize])
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
                    let (s, t) = self.range(&a[1])?;
                    let k = self.n(a, 2)?.trunc();
                    let approx = a.len() < 4 || matches!(a[3], Expr::Missing) || bool_of(&self.scalar(&a[3]))?;
                    let vertical = name == "VLOOKUP";
                    let width = if vertical { t.c1 - t.c0 + 1 } else { t.r1 - t.r0 + 1 };
                    if k < 1.0 {
                        return Err(ErrKind::Value);
                    }
                    if k as u32 > width {
                        return Err(ErrKind::Ref);
                    }
                    let first = if vertical { Area { c1: t.c0, ..t } } else { Area { r1: t.r0, ..t } };
                    let pos = self.find(&key, s, first, if approx { 1 } else { 2 }, false)?.ok_or(ErrKind::Na)?;
                    let off = k as u32 - 1;
                    let at = if vertical { Addr { row: t.r0 + pos, col: t.c0 + off } } else { Addr { row: t.r0 + off, col: t.c0 + pos } };
                    self.ctx.cell(s, at)
                }
                "MATCH" | "XMATCH" => {
                    if !count(2, if name == "MATCH" { 3 } else { 4 }) {
                        return Err(ErrKind::Na);
                    }
                    let key = self.scalar(&a[0]);
                    if let Value::Error(k) = key {
                        return Err(k);
                    }
                    let (s, r) = self.range(&a[1])?;
                    if r.r0 != r.r1 && r.c0 != r.c1 {
                        return Err(ErrKind::Na);
                    }
                    let opt = |i: usize, d: f64| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { self.n(a, i) } else { Ok(d) } };
                    let (mode, back) = if name == "MATCH" {
                        (match opt(2, 1.0)? { m if m > 0.0 => 1, m if m < 0.0 => -1, _ => 2 }, false)
                    } else {
                        (xmode(opt(2, 0.0)?)?, opt(3, 1.0)? < 0.0)
                    };
                    let pos = self.find(&key, s, r, mode, back)?.ok_or(ErrKind::Na)?;
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
                    let (s, look) = self.range(&a[1])?;
                    let (rs, ret) = self.range(&a[2])?;
                    let vertical = look.c0 == look.c1;
                    let len = |ar: &Area| if vertical { ar.r1 - ar.r0 } else { ar.c1 - ar.c0 };
                    if (look.r0 != look.r1 && look.c0 != look.c1) || len(&look) != len(&ret) || (vertical && ret.c0 != ret.c1) || (!vertical && ret.r0 != ret.r1) {
                        return Err(ErrKind::Value);
                    }
                    let opt = |i: usize, d: f64| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { self.n(a, i) } else { Ok(d) } };
                    let mode = xmode(opt(4, 0.0)?)?;
                    let back = opt(5, 1.0)? < 0.0;
                    match self.find(&key, s, look, mode, back)? {
                        Some(p) => self.ctx.cell(rs, if vertical { Addr { row: ret.r0 + p, col: ret.c0 } } else { Addr { row: ret.r0, col: ret.c0 + p } }),
                        None if a.len() > 3 && !matches!(a[3], Expr::Missing) => self.scalar(&a[3]),
                        None => return Err(ErrKind::Na),
                    }
                }
                "INDEX" => {
                    if !count(2, 3) {
                        return Err(ErrKind::Na);
                    }
                    let (s, t) = self.range(&a[0])?;
                    let (h, w) = (t.r1 - t.r0 + 1, t.c1 - t.c0 + 1);
                    let i = self.n(a, 1)?.trunc();
                    let j = if a.len() == 3 { self.n(a, 2)?.trunc() } else { 0.0 };
                    let (r, c) = if a.len() == 2 && h == 1 { (1.0, i) } else if a.len() == 2 && w == 1 { (i, 1.0) } else { (i, j) };
                    if r < 1.0 || c < 1.0 {
                        return Err(ErrKind::Value);
                    }
                    if r as u32 > h || c as u32 > w {
                        return Err(ErrKind::Ref);
                    }
                    self.ctx.cell(s, Addr { row: t.r0 + r as u32 - 1, col: t.c0 + c as u32 - 1 })
                }
                _ => return Err(ErrKind::Name),
            })
        })();
        r.unwrap_or_else(err)
    }
}

impl Eval<'_> {
    fn range(&self, e: &Expr) -> Result<(usize, Area), ErrKind> {
        match self.arg(e) {
            Arg::R(s, ar) => Ok((s, ar)),
            Arg::V(Value::Error(k)) => Err(k),
            Arg::V(_) => Err(ErrKind::Value),
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

    fn find(&self, key: &Value, s: usize, ar: Area, mode: i32, back: bool) -> Result<Option<u32>, ErrKind> {
        use std::cmp::Ordering::{Equal, Greater, Less};
        let vertical = ar.c0 == ar.c1;
        let mut cells: Vec<(u32, Value)> = Vec::new();
        self.ctx.each(s, ar, &mut |a, v| cells.push((if vertical { a.row - ar.r0 } else { a.col - ar.c0 }, v.clone())));
        cells.sort_by_key(|c| c.0);
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
