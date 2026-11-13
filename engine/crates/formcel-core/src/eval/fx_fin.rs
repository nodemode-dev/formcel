use super::*;

type R<T> = Result<T, ErrKind>;

fn fv_of(r: f64, n: f64, pmt: f64, pv: f64, t: f64) -> f64 {
    if r == 0.0 {
        -(pv + pmt * n)
    } else {
        let g = (1.0 + r).powf(n);
        -(pv * g + pmt * (1.0 + r * t) * (g - 1.0) / r)
    }
}

fn pmt_of(r: f64, n: f64, pv: f64, fv: f64, t: f64) -> R<f64> {
    if n == 0.0 {
        return Err(ErrKind::Num);
    }
    if r == 0.0 {
        return Ok(-(pv + fv) / n);
    }
    let g = (1.0 + r).powf(n);
    Ok(-(fv + pv * g) * r / ((1.0 + r * t) * (g - 1.0)))
}

fn npv_of(r: f64, v: &[f64]) -> f64 {
    v.iter().enumerate().map(|(i, x)| x / (1.0 + r).powi(i as i32 + 1)).sum()
}

fn solve(f: &dyn Fn(f64) -> f64, guess: f64, lo: f64) -> Option<f64> {
    let mut r = guess;
    for _ in 0..200 {
        let y = f(r);
        if !y.is_finite() {
            break;
        }
        let h = 1e-7 * r.abs().max(1.0);
        let d = (f(r + h) - f(r - h)) / (2.0 * h);
        if d == 0.0 || !d.is_finite() {
            break;
        }
        let mut nr = r - y / d;
        if nr <= lo {
            nr = (r + lo) / 2.0;
        }
        if (nr - r).abs() < 1e-13 {
            return Some(nr);
        }
        r = nr;
    }
    let mut prev = lo + 1e-9;
    let mut fp = f(prev);
    let mut x = prev;
    let mut step = 1e-3;
    while x < 1e6 {
        x += step;
        step *= 1.02;
        let fx = f(x);
        if fp.is_finite() && fx.is_finite() && fp * fx <= 0.0 {
            let (mut a, mut b) = (prev, x);
            for _ in 0..200 {
                let m = 0.5 * (a + b);
                if f(a) * f(m) <= 0.0 {
                    b = m;
                } else {
                    a = m;
                }
            }
            return Some(0.5 * (a + b));
        }
        prev = x;
        fp = fx;
    }
    None
}

impl Eval<'_> {
    pub(super) fn arity(&self, a: &[Expr], min: usize, max: usize) -> R<()> {
        if a.len() < min || a.len() > max {
            Err(ErrKind::Na)
        } else {
            Ok(())
        }
    }

    pub(super) fn opt(&self, a: &[Expr], i: usize, d: f64) -> R<f64> {
        match a.get(i) {
            Some(Expr::Missing) | None => Ok(d),
            Some(_) => self.n(a, i),
        }
    }

    pub(super) fn has(&self, a: &[Expr], i: usize) -> bool {
        a.get(i).is_some_and(|e| !matches!(e, Expr::Missing))
    }

    pub(super) fn nums(&self, a: &[Expr], i: usize) -> R<Vec<f64>> {
        self.numbers(&a[i..=i])
    }

    pub(super) fn flat(&self, a: &[Expr], i: usize) -> R<Vec<Value>> {
        Ok(self.grid(self.arg(a.get(i).ok_or(ErrKind::Na)?))?.data)
    }

    fn series(&self, a: &[Expr], i: usize) -> R<Vec<f64>> {
        self.flat(a, i)?.iter().map(|v| if let Value::Number(n) = v { Ok(*n) } else if let Value::Error(k) = v { Err(*k) } else { number_of(v) }).collect()
    }

    pub(super) fn fin(&self, name: &str, a: &[Expr]) -> Option<R<Value>> {
        Some(match name {
            "PMT" | "PV" | "FV" | "NPER" | "RATE" | "IPMT" | "PPMT" | "ISPMT" | "CUMIPMT" | "CUMPRINC" => self.fin_loan(name, a),
            "NPV" | "XNPV" | "IRR" | "XIRR" | "MIRR" | "FVSCHEDULE" => self.fin_flow(name, a),
            "SLN" | "SYD" | "DB" | "DDB" | "VDB" => self.fin_dep(name, a),
            "EFFECT" | "NOMINAL" | "DOLLARDE" | "DOLLARFR" | "PDURATION" | "RRI" => self.fin_rate(name, a),
            _ => return None,
        })
    }

    fn fin_loan(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "PMT" => {
                self.arity(a, 3, 5)?;
                Ok(num(pmt_of(self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.opt(a, 3, 0.0)?, f64::from(self.opt(a, 4, 0.0)? != 0.0))?))
            }
            "PV" => {
                self.arity(a, 3, 5)?;
                let (r, n, pmt, fv, t) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.opt(a, 3, 0.0)?, f64::from(self.opt(a, 4, 0.0)? != 0.0));
                if r == 0.0 {
                    return Ok(num(-(fv + pmt * n)));
                }
                let g = (1.0 + r).powf(n);
                Ok(num(-(fv + pmt * (1.0 + r * t) * (g - 1.0) / r) / g))
            }
            "FV" => {
                self.arity(a, 3, 5)?;
                Ok(num(fv_of(self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.opt(a, 3, 0.0)?, f64::from(self.opt(a, 4, 0.0)? != 0.0))))
            }
            "NPER" => {
                self.arity(a, 3, 5)?;
                let (r, pmt, pv, fv, t) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.opt(a, 3, 0.0)?, f64::from(self.opt(a, 4, 0.0)? != 0.0));
                if r == 0.0 {
                    if pmt == 0.0 {
                        return Err(ErrKind::Num);
                    }
                    return Ok(num(-(pv + fv) / pmt));
                }
                let p = pmt * (1.0 + r * t);
                let (top, bot) = (p - fv * r, p + pv * r);
                if bot == 0.0 {
                    return Err(ErrKind::Num);
                }
                let q = top / bot;
                if q <= 0.0 || r <= -1.0 {
                    return Err(ErrKind::Num);
                }
                Ok(num(q.ln() / (1.0 + r).ln()))
            }
            "RATE" => {
                self.arity(a, 3, 6)?;
                let (n, pmt, pv, fv, t, guess) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.opt(a, 3, 0.0)?, f64::from(self.opt(a, 4, 0.0)? != 0.0), self.opt(a, 5, 0.1)?);
                let f = |r: f64| {
                    if r == 0.0 {
                        pv + pmt * n + fv
                    } else {
                        let g = (1.0 + r).powf(n);
                        pv * g + pmt * (1.0 + r * t) * (g - 1.0) / r + fv
                    }
                };
                match solve(&f, guess, -1.0) {
                    Some(r) => Ok(num(r)),
                    None => Err(ErrKind::Num),
                }
            }
            "ISPMT" => {
                self.arity(a, 4, 4)?;
                let (r, per, n, pv) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.n(a, 3)?);
                if n == 0.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num(pv * r * (per / n - 1.0)))
            }
            "IPMT" | "PPMT" => {
                self.arity(a, 4, 6)?;
                let (r, per, n, pv, fv, t) = (self.n(a, 0)?, self.n(a, 1)?.trunc(), self.n(a, 2)?, self.n(a, 3)?, self.opt(a, 4, 0.0)?, f64::from(self.opt(a, 5, 0.0)? != 0.0));
                if per < 1.0 || per > n {
                    return Err(ErrKind::Num);
                }
                let (i, p) = ipmt_ppmt(r, per, n, pv, fv, t)?;
                Ok(num(if name == "IPMT" { i } else { p }))
            }
            _ => {
                self.arity(a, 6, 6)?;
                let (r, n, pv, s, e, t) = (self.n(a, 0)?, self.n(a, 1)?.trunc(), self.n(a, 2)?, self.n(a, 3)?.trunc(), self.n(a, 4)?.trunc(), self.n(a, 5)?);
                if r <= 0.0 || n <= 0.0 || pv <= 0.0 || s < 1.0 || e < s || e > n || e - s > 1e6 || (t != 0.0 && t != 1.0) {
                    return Err(ErrKind::Num);
                }
                let mut sum = 0.0;
                let mut k = s;
                while k <= e {
                    let (i, p) = ipmt_ppmt(r, k, n, pv, 0.0, t)?;
                    sum += if name == "CUMIPMT" { i } else { p };
                    k += 1.0;
                }
                Ok(num(sum))
            }
        }
    }

    fn fin_flow(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "NPV" => {
                if a.len() < 2 {
                    return Err(ErrKind::Na);
                }
                let r = self.n(a, 0)?;
                if r == -1.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num(npv_of(r, &self.numbers(&a[1..])?)))
            }
            "FVSCHEDULE" => {
                self.arity(a, 2, 2)?;
                let mut p = self.n(a, 0)?;
                for r in self.series(a, 1)? {
                    p *= 1.0 + r;
                }
                Ok(num(p))
            }
            "XNPV" | "XIRR" => {
                self.arity(a, if name == "XNPV" { 3 } else { 2 }, 3)?;
                let (rate, vi, di) = if name == "XNPV" { (Some(self.n(a, 0)?), 1, 2) } else { (None, 0, 1) };
                let v = self.series(a, vi).map_err(|_| ErrKind::Value)?;
                let d = self.series(a, di).map_err(|_| ErrKind::Value)?;
                if v.len() != d.len() || v.is_empty() {
                    return Err(ErrKind::Num);
                }
                let d: Vec<f64> = d.iter().map(|x| x.trunc()).collect();
                if d.iter().any(|x| *x < d[0] || *x < 0.0) {
                    return Err(ErrKind::Num);
                }
                let f = |r: f64| v.iter().zip(&d).map(|(x, t)| x / (1.0 + r).powf((t - d[0]) / 365.0)).sum::<f64>();
                if let Some(r) = rate {
                    if r <= -1.0 {
                        return Err(ErrKind::Num);
                    }
                    return Ok(num(f(r)));
                }
                if !(v.iter().any(|x| *x > 0.0) && v.iter().any(|x| *x < 0.0)) {
                    return Err(ErrKind::Num);
                }
                let guess = self.opt(a, 2, 0.1)?;
                solve(&f, guess, -1.0).map(num).ok_or(ErrKind::Num)
            }
            "IRR" => {
                self.arity(a, 1, 2)?;
                let v = self.nums(a, 0)?;
                if !(v.iter().any(|x| *x > 0.0) && v.iter().any(|x| *x < 0.0)) {
                    return Err(ErrKind::Num);
                }
                let guess = self.opt(a, 1, 0.1)?;
                let f = |r: f64| v.iter().enumerate().map(|(i, x)| x / (1.0 + r).powi(i as i32)).sum::<f64>();
                solve(&f, guess, -1.0).map(num).ok_or(ErrKind::Num)
            }
            _ => {
                self.arity(a, 3, 3)?;
                let v = self.nums(a, 0)?;
                let (fr, rr) = (self.n(a, 1)?, self.n(a, 2)?);
                let n = v.len() as f64;
                let pos: Vec<f64> = v.iter().map(|x| x.max(0.0)).collect();
                let neg: Vec<f64> = v.iter().map(|x| x.min(0.0)).collect();
                if !(v.iter().any(|x| *x > 0.0) && v.iter().any(|x| *x < 0.0)) || n < 2.0 {
                    return Err(ErrKind::Div0);
                }
                if fr == -1.0 || rr == -1.0 {
                    return Err(ErrKind::Div0);
                }
                let top = -npv_of(rr, &pos) * (1.0 + rr).powf(n);
                let bot = npv_of(fr, &neg) * (1.0 + fr);
                Ok(num((top / bot).powf(1.0 / (n - 1.0)) - 1.0))
            }
        }
    }

    fn fin_dep(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "SLN" => {
                self.arity(a, 3, 3)?;
                let life = self.n(a, 2)?;
                if life == 0.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num((self.n(a, 0)? - self.n(a, 1)?) / life))
            }
            "SYD" => {
                self.arity(a, 4, 4)?;
                let (cost, salv, life, per) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.n(a, 3)?);
                if life <= 0.0 || per <= 0.0 || per > life || salv < 0.0 {
                    return Err(ErrKind::Num);
                }
                Ok(num((cost - salv) * (life - per + 1.0) * 2.0 / (life * (life + 1.0))))
            }
            "DB" => {
                self.arity(a, 4, 5)?;
                let (cost, salv, life, per) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?.trunc(), self.n(a, 3)?.trunc());
                let month = self.opt(a, 4, 12.0)?.trunc();
                if cost < 0.0 || salv < 0.0 || life <= 0.0 || per <= 0.0 || per > 1e6 || !(1.0..=12.0).contains(&month) || per > life + if month < 12.0 { 1.0 } else { 0.0 } {
                    return Err(ErrKind::Num);
                }
                if cost == 0.0 {
                    return Ok(Value::Number(0.0));
                }
                let rate = (((1.0 - (salv / cost).powf(1.0 / life)) * 1000.0) + 0.5).floor() / 1000.0;
                let mut total = 0.0;
                let mut dep = cost * rate * month / 12.0;
                let mut k = 1.0;
                while k <= per {
                    dep = if k == 1.0 {
                        cost * rate * month / 12.0
                    } else if k == life + 1.0 {
                        (cost - total) * rate * (12.0 - month) / 12.0
                    } else {
                        (cost - total) * rate
                    };
                    total += dep;
                    k += 1.0;
                }
                Ok(num(dep))
            }
            "DDB" => {
                self.arity(a, 4, 5)?;
                let (cost, salv, life, per) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.n(a, 3)?);
                let factor = self.opt(a, 4, 2.0)?;
                if cost < 0.0 || salv < 0.0 || life <= 0.0 || per <= 0.0 || per > life || per > 1e6 || factor <= 0.0 {
                    return Err(ErrKind::Num);
                }
                let mut total = 0.0;
                let mut dep = 0.0;
                let mut k = 1.0;
                while k <= per.ceil() {
                    dep = ((cost - total) * (factor / life)).min(cost - salv - total).max(0.0);
                    total += dep;
                    k += 1.0;
                }
                Ok(num(dep))
            }
            _ => {
                self.arity(a, 5, 7)?;
                let (cost, salv, life, s, e) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.n(a, 3)?, self.n(a, 4)?);
                let factor = self.opt(a, 5, 2.0)?;
                let no_switch = if self.has(a, 6) { bool_of(&self.scalar(&a[6]))? } else { false };
                if cost < 0.0 || salv < 0.0 || life <= 0.0 || s < 0.0 || e < s || e > life || e > 1e6 || factor <= 0.0 {
                    return Err(ErrKind::Num);
                }
                let mut book = cost;
                let mut sum = 0.0;
                let mut i = 0.0;
                while i < e.ceil() {
                    let ddb = (book * factor / life).min((book - salv).max(0.0));
                    let sl = (book - salv).max(0.0) / (life - i);
                    let dep = if !no_switch && sl > ddb { sl } else { ddb };
                    let lap = (e.min(i + 1.0) - s.max(i)).max(0.0);
                    sum += dep * lap;
                    book -= dep;
                    i += 1.0;
                }
                Ok(num(sum))
            }
        }
    }

    fn fin_rate(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "EFFECT" | "NOMINAL" => {
                self.arity(a, 2, 2)?;
                let (r, p) = (self.n(a, 0)?, self.n(a, 1)?.trunc());
                if r <= 0.0 || p < 1.0 {
                    return Err(ErrKind::Num);
                }
                Ok(num(if name == "EFFECT" { (1.0 + r / p).powf(p) - 1.0 } else { p * ((1.0 + r).powf(1.0 / p) - 1.0) }))
            }
            "DOLLARDE" | "DOLLARFR" => {
                self.arity(a, 2, 2)?;
                let (d, f) = (self.n(a, 0)?, self.n(a, 1)?.trunc());
                if f < 0.0 {
                    return Err(ErrKind::Num);
                }
                if f == 0.0 {
                    return Err(ErrKind::Div0);
                }
                let scale = 10f64.powf(f.log10().ceil());
                let whole = d.trunc();
                let frac = d - whole;
                Ok(num(if name == "DOLLARDE" { whole + frac * scale / f } else { whole + frac * f / scale }))
            }
            "PDURATION" => {
                self.arity(a, 3, 3)?;
                let (r, pv, fv) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if r <= 0.0 || pv <= 0.0 || fv <= 0.0 {
                    return Err(ErrKind::Num);
                }
                Ok(num((fv.ln() - pv.ln()) / (1.0 + r).ln()))
            }
            _ => {
                self.arity(a, 3, 3)?;
                let (n, pv, fv) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if n <= 0.0 {
                    return Err(ErrKind::Num);
                }
                if pv == 0.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num((fv / pv).powf(1.0 / n) - 1.0))
            }
        }
    }
}

fn ipmt_ppmt(r: f64, per: f64, n: f64, pv: f64, fv: f64, t: f64) -> R<(f64, f64)> {
    let pmt = pmt_of(r, n, pv, fv, t)?;
    let i = if t == 1.0 {
        if per == 1.0 {
            0.0
        } else {
            r * (fv_of(r, per - 1.0, pmt, pv, 1.0) - pmt)
        }
    } else {
        r * fv_of(r, per - 1.0, pmt, pv, 0.0)
    };
    Ok((i, pmt - i))
}
