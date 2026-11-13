use super::fx_sf::ln_choose;
use super::fx_stat::{median, mode_one, pct_exc, pct_inc, var_of};
use super::*;
use std::f64::consts::PI;
use std::sync::atomic::{AtomicU64, Ordering};

type R<T> = Result<T, ErrKind>;

static SEED: AtomicU64 = AtomicU64::new(0);

pub(super) fn random() -> f64 {
    let mut s = SEED.load(Ordering::Relaxed);
    if s == 0 {
        s = numfmt::now().to_bits() ^ 0x9E37_79B9_7F4A_7C15;
        if s == 0 {
            s = 0x1234_5678_9ABC_DEF1;
        }
    }
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    SEED.store(s, Ordering::Relaxed);
    let z = s.wrapping_mul(0x2545_F491_4F6C_DD1D);
    (z >> 11) as f64 / (1u64 << 53) as f64
}

fn trig_ok(x: f64) -> R<f64> {
    if x.abs() >= 134_217_728.0 {
        Err(ErrKind::Num)
    } else {
        Ok(x)
    }
}

fn fact(n: f64) -> f64 {
    let mut p = 1.0;
    let mut i = 2.0;
    while i <= n {
        p *= i;
        i += 1.0;
    }
    p
}

fn combin(n: f64, k: f64) -> f64 {
    let k = k.min(n - k);
    if k > 1e6 {
        return ln_choose(n, k).exp().round();
    }
    let mut r = 1.0;
    let mut i = 1.0;
    while i <= k {
        r = r * (n - k + i) / i;
        i += 1.0;
    }
    r.round()
}

fn gcd(a: f64, b: f64) -> f64 {
    let (mut a, mut b) = (a, b);
    while b != 0.0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

fn roman_tokens(form: u8) -> Vec<(u32, String)> {
    let syms = [("I", 1u32), ("V", 5), ("X", 10), ("L", 50), ("C", 100), ("D", 500), ("M", 1000)];
    let ratio = [10u32, 10, 50, 100, 100_000][form as usize];
    let mut t: Vec<(u32, String)> = syms.iter().map(|(s, v)| (*v, (*s).to_string())).collect();
    for (s, sv) in syms {
        for (b, bv) in syms {
            if bv > sv && bv <= ratio * sv && (form > 0 || (sv != 5 && sv != 50 && sv != 500 && bv <= 10 * sv)) {
                let v = bv - sv;
                if !t.iter().any(|(x, _)| *x == v) {
                    t.push((v, format!("{s}{b}")));
                }
            }
        }
    }
    t.sort_by(|x, y| y.0.cmp(&x.0));
    t
}

fn roman(mut n: u32, form: u8) -> String {
    let mut out = String::new();
    for (v, s) in roman_tokens(form) {
        while n >= v {
            out.push_str(&s);
            n -= v;
        }
    }
    out
}

fn mat(g: &Array) -> R<Vec<Vec<f64>>> {
    let mut m = Vec::with_capacity(g.rows);
    for r in 0..g.rows {
        let mut row = Vec::with_capacity(g.cols);
        for c in 0..g.cols {
            match g.get(r, c) {
                Value::Number(n) => row.push(*n),
                Value::Error(k) => return Err(*k),
                Value::Bool(_) | Value::Text(_) | Value::Empty => return Err(ErrKind::Value),
            }
        }
        m.push(row);
    }
    Ok(m)
}

fn from_mat(m: Vec<Vec<f64>>) -> Arg {
    let (rows, cols) = (m.len(), m.first().map_or(0, Vec::len));
    Arg::A(Array { rows, cols, data: m.into_iter().flatten().map(num).collect() })
}

fn det(mut m: Vec<Vec<f64>>) -> f64 {
    let n = m.len();
    let mut d = 1.0;
    for c in 0..n {
        let p = (c..n).max_by(|&x, &y| m[x][c].abs().partial_cmp(&m[y][c].abs()).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(c);
        if m[p][c] == 0.0 {
            return 0.0;
        }
        if p != c {
            m.swap(p, c);
            d = -d;
        }
        d *= m[c][c];
        for r in c + 1..n {
            let f = m[r][c] / m[c][c];
            for k in c..n {
                let t = m[c][k];
                m[r][k] -= f * t;
            }
        }
    }
    d
}

fn inverse(m: &[Vec<f64>]) -> Option<Vec<Vec<f64>>> {
    let n = m.len();
    let mut a: Vec<Vec<f64>> = m.iter().enumerate().map(|(i, r)| r.iter().copied().chain((0..n).map(|j| f64::from(i == j))).collect()).collect();
    for c in 0..n {
        let p = (c..n).max_by(|&x, &y| a[x][c].abs().partial_cmp(&a[y][c].abs()).unwrap_or(std::cmp::Ordering::Equal))?;
        if a[p][c].abs() < 1e-300 {
            return None;
        }
        a.swap(p, c);
        let pv = a[c][c];
        for k in 0..2 * n {
            a[c][k] /= pv;
        }
        for r in 0..n {
            if r != c {
                let f = a[r][c];
                if f != 0.0 {
                    for k in 0..2 * n {
                        let t = a[c][k];
                        a[r][k] -= f * t;
                    }
                }
            }
        }
    }
    let out: Vec<Vec<f64>> = a.into_iter().map(|r| r[n..].to_vec()).collect();
    if out.iter().flatten().any(|x| !x.is_finite()) {
        None
    } else {
        Some(out)
    }
}

impl Eval<'_> {
    pub(super) fn math(&self, name: &str, a: &[Expr]) -> Option<R<Value>> {
        Some(match name {
            "SIN" | "COS" | "TAN" | "ASIN" | "ACOS" | "ATAN" | "SINH" | "COSH" | "TANH" | "ASINH" | "ACOSH" | "ATANH" | "COT" | "CSC" | "SEC" | "COTH" | "CSCH" | "SECH" | "ACOT" | "ACOTH" | "DEGREES" | "RADIANS" | "EXP" | "LN"
            | "LOG10" | "SIGN" | "SQRTPI" | "EVEN" | "ODD" | "FACT" | "FACTDOUBLE" => self.math_unary(name, a),
            "ATAN2" | "LOG" | "TRUNC" | "CEILING" | "CEILING.MATH" | "CEILING.PRECISE" | "FLOOR" | "FLOOR.MATH" | "FLOOR.PRECISE" | "MROUND" | "COMBIN" | "COMBINA" | "PERMUT" | "PERMUTATIONA" | "QUOTIENT" | "RANDBETWEEN"
            | "ISO.CEILING" | "BASE" | "DECIMAL" | "ROMAN" | "ARABIC" | "RAND" | "SERIESSUM" => self.math_binary(name, a),
            "GCD" | "LCM" | "MULTINOMIAL" | "SUMPRODUCT" | "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" | "MDETERM" | "AGGREGATE" => self.math_multi(name, a),
            _ => return None,
        })
    }

    pub(super) fn math_arr(&self, name: &str, a: &[Expr]) -> Option<R<Arg>> {
        Some(match name {
            "MMULT" => (|| {
                self.arity(a, 2, 2)?;
                let (x, y) = (mat(&self.grid(self.arg(&a[0]))?)?, mat(&self.grid(self.arg(&a[1]))?)?);
                if x.is_empty() || y.is_empty() || x[0].len() != y.len() {
                    return Err(ErrKind::Value);
                }
                let out = x.iter().map(|r| (0..y[0].len()).map(|c| r.iter().zip(&y).map(|(p, row)| p * row[c]).sum()).collect()).collect();
                Ok(from_mat(out))
            })(),
            "MINVERSE" => (|| {
                self.arity(a, 1, 1)?;
                let m = mat(&self.grid(self.arg(&a[0]))?)?;
                if m.is_empty() || m.len() != m[0].len() {
                    return Err(ErrKind::Value);
                }
                inverse(&m).map(from_mat).ok_or(ErrKind::Num)
            })(),
            "MUNIT" => (|| {
                self.arity(a, 1, 1)?;
                let n = self.n(a, 0)?.trunc();
                if n < 1.0 || n * n > MAX_ARRAY as f64 {
                    return Err(ErrKind::Value);
                }
                let n = n as usize;
                Ok(Arg::A(Array { rows: n, cols: n, data: (0..n * n).map(|k| Value::Number(f64::from(k / n == k % n))).collect() }))
            })(),
            "RANDARRAY" => (|| {
                self.arity(a, 0, 5)?;
                let (rows, cols, lo, hi) = (self.opt(a, 0, 1.0)?.trunc(), self.opt(a, 1, 1.0)?.trunc(), self.opt(a, 2, 0.0)?, self.opt(a, 3, 1.0)?);
                let int = if self.has(a, 4) { bool_of(&self.scalar(&a[4]))? } else { false };
                if rows < 1.0 || cols < 1.0 || lo > hi {
                    return Err(ErrKind::Value);
                }
                if rows * cols > MAX_ARRAY as f64 {
                    return Err(ErrKind::Value);
                }
                let (rows, cols) = (rows as usize, cols as usize);
                let mut data = Vec::with_capacity(rows * cols);
                for _ in 0..rows * cols {
                    data.push(Value::Number(if int { (lo.ceil() + (random() * (hi.floor() - lo.ceil() + 1.0)).floor()).min(hi.floor()) } else { lo + random() * (hi - lo) }));
                }
                Ok(Arg::A(Array { rows, cols, data }))
            })(),
            _ => return None,
        })
    }

    fn math_unary(&self, name: &str, a: &[Expr]) -> R<Value> {
        self.arity(a, 1, 1)?;
        let x = self.n(a, 0)?;
        let d0 = |v: f64| if v == 0.0 { Err(ErrKind::Div0) } else { Ok(v) };
        Ok(num(match name {
            "SIN" => trig_ok(x)?.sin(),
            "COS" => trig_ok(x)?.cos(),
            "TAN" => trig_ok(x)?.tan(),
            "COT" => 1.0 / d0(trig_ok(x)?.tan())?,
            "CSC" => 1.0 / d0(trig_ok(x)?.sin())?,
            "SEC" => 1.0 / trig_ok(x)?.cos(),
            "ASIN" | "ACOS" if x.abs() > 1.0 => return Err(ErrKind::Num),
            "ASIN" => x.asin(),
            "ACOS" => x.acos(),
            "ATAN" => x.atan(),
            "SINH" => x.sinh(),
            "COSH" => x.cosh(),
            "TANH" => x.tanh(),
            "COTH" => 1.0 / d0(x.tanh())?,
            "CSCH" => 1.0 / d0(x.sinh())?,
            "SECH" => 1.0 / x.cosh(),
            "ASINH" => x.asinh(),
            "ACOSH" if x < 1.0 => return Err(ErrKind::Num),
            "ACOSH" => x.acosh(),
            "ATANH" if x.abs() >= 1.0 => return Err(ErrKind::Num),
            "ATANH" => x.atanh(),
            "ACOT" => PI / 2.0 - x.atan(),
            "ACOTH" if x.abs() <= 1.0 => return Err(ErrKind::Num),
            "ACOTH" => 0.5 * ((x + 1.0) / (x - 1.0)).ln(),
            "DEGREES" => x * 180.0 / PI,
            "RADIANS" => x * PI / 180.0,
            "EXP" => x.exp(),
            "LN" if x <= 0.0 => return Err(ErrKind::Num),
            "LN" => x.ln(),
            "LOG10" if x <= 0.0 => return Err(ErrKind::Num),
            "LOG10" => x.log10(),
            "SIGN" => {
                if x > 0.0 {
                    1.0
                } else if x < 0.0 {
                    -1.0
                } else {
                    0.0
                }
            }
            "SQRTPI" if x < 0.0 => return Err(ErrKind::Num),
            "SQRTPI" => (x * PI).sqrt(),
            "EVEN" | "ODD" => {
                let target = if name == "EVEN" { 2.0 } else { 1.0 };
                let m = sig15(x.abs());
                let r = if name == "EVEN" { (m / 2.0).ceil() * 2.0 } else { let c = m.ceil(); if c % 2.0 == 0.0 { c + 1.0 } else { c } };
                let r = if m == 0.0 { if target == 2.0 { 0.0 } else { 1.0 } } else { r };
                r * if x < 0.0 { -1.0 } else { 1.0 }
            }
            "FACT" => {
                let n = x.trunc();
                if n < 0.0 || n > 170.0 {
                    return Err(ErrKind::Num);
                }
                fact(n)
            }
            _ => {
                let n = x.trunc();
                if n < 0.0 || n > 300.0 {
                    return Err(ErrKind::Num);
                }
                let mut p = 1.0;
                let mut i = n;
                while i > 1.0 {
                    p *= i;
                    i -= 2.0;
                }
                p
            }
        }))
    }

    fn math_binary(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "RAND" => {
                self.arity(a, 0, 0)?;
                Ok(Value::Number(random()))
            }
            "RANDBETWEEN" => {
                self.arity(a, 2, 2)?;
                let (lo, hi) = (self.n(a, 0)?.ceil(), self.n(a, 1)?.floor());
                if lo > hi {
                    return Err(ErrKind::Num);
                }
                Ok(Value::Number((lo + (random() * (hi - lo + 1.0)).floor()).min(hi)))
            }
            "ATAN2" => {
                self.arity(a, 2, 2)?;
                let (x, y) = (self.n(a, 0)?, self.n(a, 1)?);
                if x == 0.0 && y == 0.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num(y.atan2(x)))
            }
            "LOG" => {
                self.arity(a, 1, 2)?;
                let (x, b) = (self.n(a, 0)?, self.opt(a, 1, 10.0)?);
                if x <= 0.0 || b <= 0.0 {
                    return Err(ErrKind::Num);
                }
                if b == 1.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num(x.ln() / b.ln()))
            }
            "TRUNC" => {
                self.arity(a, 1, 2)?;
                let (x, d) = (self.n(a, 0)?, self.opt(a, 1, 0.0)?.trunc());
                let m = 10f64.powf(d);
                Ok(num(sig15(x * m).trunc() / m))
            }
            "CEILING" | "FLOOR" | "ISO.CEILING" => {
                self.arity(a, 1, 2)?;
                let (x, s) = (self.n(a, 0)?, if a.len() == 1 && name == "CEILING" { return Err(ErrKind::Na) } else { self.opt(a, 1, 1.0)? });
                if s == 0.0 {
                    return if name == "FLOOR" { Err(ErrKind::Div0) } else { Ok(Value::Number(0.0)) };
                }
                if name == "ISO.CEILING" {
                    return Ok(num((sig15(x / s.abs())).ceil() * s.abs()));
                }
                if x > 0.0 && s < 0.0 {
                    return Err(ErrKind::Num);
                }
                let q = sig15(x / s);
                Ok(num(if name == "CEILING" { q.ceil() } else { q.floor() } * s))
            }
            "CEILING.MATH" | "FLOOR.MATH" => {
                self.arity(a, 1, 3)?;
                let (x, s, mode) = (self.n(a, 0)?, self.opt(a, 1, 1.0)?.abs(), self.opt(a, 2, 0.0)?);
                if s == 0.0 {
                    return Ok(Value::Number(0.0));
                }
                let q = sig15(x / s);
                let up = name == "CEILING.MATH";
                let r = if x >= 0.0 || mode == 0.0 {
                    if up { q.ceil() } else { q.floor() }
                } else if up {
                    q.floor()
                } else {
                    q.ceil()
                };
                Ok(num(r * s))
            }
            "CEILING.PRECISE" | "FLOOR.PRECISE" => {
                self.arity(a, 1, 2)?;
                let (x, s) = (self.n(a, 0)?, self.opt(a, 1, 1.0)?.abs());
                if s == 0.0 {
                    return Ok(Value::Number(0.0));
                }
                let q = sig15(x / s);
                Ok(num(if name == "CEILING.PRECISE" { q.ceil() } else { q.floor() } * s))
            }
            "MROUND" => {
                self.arity(a, 2, 2)?;
                let (x, m) = (self.n(a, 0)?, self.n(a, 1)?);
                if m == 0.0 {
                    return Ok(Value::Number(0.0));
                }
                if x * m < 0.0 {
                    return Err(ErrKind::Num);
                }
                Ok(num(sig15(x / m).round() * m))
            }
            "COMBIN" | "PERMUT" | "COMBINA" | "PERMUTATIONA" => {
                self.arity(a, 2, 2)?;
                let (n, k) = (self.n(a, 0)?.trunc(), self.n(a, 1)?.trunc());
                if n < 0.0 || k < 0.0 {
                    return Err(ErrKind::Num);
                }
                match name {
                    "COMBIN" | "PERMUT" if k > n => Err(ErrKind::Num),
                    "COMBIN" => Ok(num(combin(n, k))),
                    "PERMUT" => Ok(num((ln_choose(n, k) + super::fx_sf::ln_gamma(k + 1.0)).exp().round())),
                    "COMBINA" => {
                        if n == 0.0 {
                            return Ok(Value::Number(f64::from(k == 0.0)));
                        }
                        Ok(num(combin(n + k - 1.0, k)))
                    }
                    _ => Ok(num(n.powf(k))),
                }
            }
            "QUOTIENT" => {
                self.arity(a, 2, 2)?;
                let (x, y) = (self.n(a, 0)?, self.n(a, 1)?);
                if y == 0.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num(sig15(x / y).trunc()))
            }
            "SERIESSUM" => {
                self.arity(a, 4, 4)?;
                let (x, n, m) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                let mut sum = 0.0;
                for (i, v) in self.flat(a, 3)?.iter().enumerate() {
                    sum += number_of(v).map_err(|_| ErrKind::Value)? * x.powf(n + m * i as f64);
                }
                Ok(num(sum))
            }
            "ROMAN" => {
                self.arity(a, 1, 2)?;
                let n = self.n(a, 0)?.trunc();
                let form = if self.has(a, 1) {
                    match self.scalar(&a[1]) {
                        Value::Bool(true) => 0.0,
                        Value::Bool(false) => 4.0,
                        v => number_of(&v)?.trunc(),
                    }
                } else {
                    0.0
                };
                if !(0.0..=3999.0).contains(&n) || !(0.0..=4.0).contains(&form) {
                    return Err(ErrKind::Value);
                }
                Ok(Value::Text(roman(n as u32, form as u8)))
            }
            "ARABIC" => {
                self.arity(a, 1, 1)?;
                let s = self.t(a, 0)?.trim().to_ascii_uppercase();
                let (neg, body) = match s.strip_prefix('-') {
                    Some(b) => (true, b),
                    None => (false, s.as_str()),
                };
                let mut total = 0.0;
                let vals: Vec<f64> = body
                    .chars()
                    .map(|c| match c {
                        'I' => Ok(1.0),
                        'V' => Ok(5.0),
                        'X' => Ok(10.0),
                        'L' => Ok(50.0),
                        'C' => Ok(100.0),
                        'D' => Ok(500.0),
                        'M' => Ok(1000.0),
                        _ => Err(ErrKind::Value),
                    })
                    .collect::<R<_>>()?;
                for (i, v) in vals.iter().enumerate() {
                    if vals.get(i + 1).is_some_and(|n| n > v) {
                        total -= v;
                    } else {
                        total += v;
                    }
                }
                Ok(Value::Number(if neg { -total } else { total }))
            }
            "BASE" => {
                self.arity(a, 2, 3)?;
                let (n, r, min) = (self.n(a, 0)?.trunc(), self.n(a, 1)?.trunc(), self.opt(a, 2, 0.0)?.trunc());
                if n < 0.0 || n >= 9_007_199_254_740_992.0 || !(2.0..=36.0).contains(&r) || !(0.0..=255.0).contains(&min) {
                    return Err(ErrKind::Num);
                }
                let mut v = n as u64;
                let mut out = Vec::new();
                while v > 0 {
                    out.push(std::char::from_digit((v % r as u64) as u32, 36).unwrap_or('0').to_ascii_uppercase());
                    v /= r as u64;
                }
                while out.len() < min as usize || out.is_empty() {
                    out.push('0');
                }
                out.reverse();
                Ok(Value::Text(out.into_iter().collect()))
            }
            _ => {
                self.arity(a, 2, 2)?;
                let s = self.t(a, 0)?;
                let r = self.n(a, 1)?.trunc();
                if !(2.0..=36.0).contains(&r) {
                    return Err(ErrKind::Num);
                }
                let mut v = 0.0;
                for c in s.trim().chars() {
                    let d = c.to_digit(36).ok_or(ErrKind::Num)?;
                    if f64::from(d) >= r {
                        return Err(ErrKind::Num);
                    }
                    v = v * r + f64::from(d);
                }
                Ok(num(v))
            }
        }
    }

    fn pairs(&self, a: &[Expr]) -> R<(Vec<Value>, Vec<Value>)> {
        self.arity(a, 2, 2)?;
        let (x, y) = (self.grid(self.arg(&a[0]))?, self.grid(self.arg(&a[1]))?);
        if x.rows != y.rows || x.cols != y.cols {
            return Err(ErrKind::Na);
        }
        Ok((x.data, y.data))
    }

    fn math_multi(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "GCD" | "LCM" => {
                if a.is_empty() {
                    return Err(ErrKind::Na);
                }
                let v = self.numbers(a)?;
                let mut acc = if name == "GCD" { 0.0 } else { 1.0 };
                for x in v {
                    let x = x.trunc();
                    if !(0.0..9_007_199_254_740_992.0).contains(&x) {
                        return Err(ErrKind::Num);
                    }
                    if name == "GCD" {
                        acc = gcd(acc, x);
                    } else if x == 0.0 {
                        return Ok(Value::Number(0.0));
                    } else {
                        acc = acc / gcd(acc, x) * x;
                    }
                }
                Ok(num(acc))
            }
            "MULTINOMIAL" => {
                if a.is_empty() {
                    return Err(ErrKind::Na);
                }
                let mut total = 0.0;
                let mut r = 1.0;
                for x in self.numbers(a)? {
                    let x = x.trunc();
                    if x < 0.0 {
                        return Err(ErrKind::Num);
                    }
                    total += x;
                    r *= combin(total, x);
                }
                Ok(num(r))
            }
            "SUMPRODUCT" => {
                if a.is_empty() {
                    return Err(ErrKind::Na);
                }
                let gs = a.iter().map(|e| self.grid(self.arg(e))).collect::<R<Vec<_>>>()?;
                if gs.iter().any(|g| g.rows != gs[0].rows || g.cols != gs[0].cols) {
                    return Err(ErrKind::Value);
                }
                let mut sum = 0.0;
                for i in 0..gs[0].data.len() {
                    let mut p = 1.0;
                    for g in &gs {
                        match &g.data[i] {
                            Value::Number(n) => p *= n,
                            Value::Error(k) => return Err(*k),
                            _ => p = 0.0,
                        }
                    }
                    sum += p;
                }
                Ok(num(sum))
            }
            "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" => {
                let (x, y) = self.pairs(a)?;
                let mut sum = 0.0;
                for (p, q) in x.iter().zip(&y) {
                    match (p, q) {
                        (Value::Error(k), _) | (_, Value::Error(k)) => return Err(*k),
                        (Value::Number(p), Value::Number(q)) => {
                            sum += match name {
                                "SUMX2MY2" => p * p - q * q,
                                "SUMX2PY2" => p * p + q * q,
                                _ => (p - q) * (p - q),
                            }
                        }
                        _ => {}
                    }
                }
                Ok(num(sum))
            }
            "MDETERM" => {
                self.arity(a, 1, 1)?;
                let m = mat(&self.grid(self.arg(&a[0]))?)?;
                if m.is_empty() || m.len() != m[0].len() {
                    return Err(ErrKind::Value);
                }
                Ok(num(sig15(det(m))))
            }
            _ => self.aggregate_fn(a),
        }
    }

    fn aggregate_fn(&self, a: &[Expr]) -> R<Value> {
        if a.len() < 3 {
            return Err(ErrKind::Na);
        }
        let f = self.n(a, 0)?.trunc() as i64;
        let o = self.n(a, 1)?.trunc() as i64;
        if !(1..=19).contains(&f) || !(0..=7).contains(&o) {
            return Err(ErrKind::Value);
        }
        if f >= 14 && a.len() != 4 {
            return Err(ErrKind::Value);
        }
        if f < 14 && a.len() < 3 {
            return Err(ErrKind::Na);
        }
        let (hidden, errors, nested) = ([1, 3, 5, 7].contains(&o), [2, 3, 6, 7].contains(&o), o < 4);
        let refs = if f >= 14 { &a[2..3] } else { &a[2..] };
        let mut vals: Vec<Value> = Vec::new();
        for e in refs {
            match self.arg(e) {
                Arg::R(s, ar) => self.ctx.each(s, ar, &mut |at, v| {
                    if (hidden && (self.ctx.filtered(s, at.row) || self.ctx.hidden_row(s, at.row))) || (nested && self.ctx.subtotal_at(s, at)) {
                        return;
                    }
                    vals.push(v.clone());
                }),
                Arg::A(x) => vals.extend(x.data),
                Arg::V(v) => vals.push(v),
                Arg::F(_) => return Err(ErrKind::Value),
            }
        }
        let mut nums = Vec::new();
        let mut filled = 0.0;
        for v in &vals {
            match v {
                Value::Error(k) => {
                    if !errors {
                        return Err(*k);
                    }
                }
                Value::Number(n) => {
                    nums.push(*n);
                    filled += 1.0;
                }
                Value::Empty => {}
                _ => filled += 1.0,
            }
        }
        let k = if f >= 14 { self.n(a, 3)? } else { 0.0 };
        let n = nums.len() as f64;
        let sum: f64 = nums.iter().sum();
        let sorted = |v: &[f64]| {
            let mut s = v.to_vec();
            s.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
            s
        };
        let v = match f {
            1 if nums.is_empty() => return Err(ErrKind::Div0),
            1 => sum / n,
            2 => n,
            3 => filled,
            4 => nums.iter().copied().fold(f64::NEG_INFINITY, f64::max).max(if nums.is_empty() { 0.0 } else { f64::NEG_INFINITY }),
            5 => nums.iter().copied().fold(f64::INFINITY, f64::min).min(if nums.is_empty() { 0.0 } else { f64::INFINITY }),
            6 => nums.iter().product(),
            7 | 10 => var_of(&nums, false).map(|v| if f == 7 { v.sqrt() } else { v }).ok_or(ErrKind::Div0)?,
            8 | 11 => var_of(&nums, true).map(|v| if f == 8 { v.sqrt() } else { v }).ok_or(ErrKind::Div0)?,
            9 => sum,
            12 => median(&sorted(&nums)).ok_or(ErrKind::Num)?,
            13 => mode_one(&nums).ok_or(ErrKind::Na)?,
            14 | 15 => {
                let s = sorted(&nums);
                if k < 1.0 || k > n {
                    return Err(ErrKind::Num);
                }
                let i = k.ceil() as usize - 1;
                if f == 14 { s[s.len() - 1 - i] } else { s[i] }
            }
            16 => pct_inc(&sorted(&nums), k).ok_or(ErrKind::Num)?,
            17 => {
                if !(0.0..=4.0).contains(&k) {
                    return Err(ErrKind::Num);
                }
                pct_inc(&sorted(&nums), k.trunc() / 4.0).ok_or(ErrKind::Num)?
            }
            18 => pct_exc(&sorted(&nums), k).ok_or(ErrKind::Num)?,
            _ => {
                if !(1.0..=3.0).contains(&k) {
                    return Err(ErrKind::Num);
                }
                pct_exc(&sorted(&nums), k.trunc() / 4.0).ok_or(ErrKind::Num)?
            }
        };
        Ok(num(v))
    }
}
