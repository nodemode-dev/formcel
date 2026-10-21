use super::fx_sf::*;
use super::*;

type R<T> = Result<T, ErrKind>;

pub(super) fn median(s: &[f64]) -> Option<f64> {
    let n = s.len();
    if n == 0 {
        return None;
    }
    Some(if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 })
}

pub(super) fn mode_one(v: &[f64]) -> Option<f64> {
    let mut best: Option<(f64, usize)> = None;
    for (i, x) in v.iter().enumerate() {
        if v[..i].contains(x) {
            continue;
        }
        let c = v.iter().filter(|y| *y == x).count();
        if c >= 2 && best.is_none_or(|b| c > b.1) {
            best = Some((*x, c));
        }
    }
    best.map(|b| b.0)
}

pub(super) fn var_of(v: &[f64], pop: bool) -> Option<f64> {
    let n = v.len() as f64;
    if v.is_empty() || (!pop && v.len() < 2) {
        return None;
    }
    let m = v.iter().sum::<f64>() / n;
    Some(v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / if pop { n } else { n - 1.0 })
}

pub(super) fn pct_inc(s: &[f64], k: f64) -> Option<f64> {
    if s.is_empty() || !(0.0..=1.0).contains(&k) {
        return None;
    }
    let pos = sig15(k * (s.len() - 1) as f64);
    let lo = pos.floor() as usize;
    let f = pos - lo as f64;
    Some(if lo + 1 < s.len() { s[lo] + f * (s[lo + 1] - s[lo]) } else { s[lo] })
}

pub(super) fn pct_exc(s: &[f64], k: f64) -> Option<f64> {
    let n = s.len() as f64;
    if s.is_empty() || k < 1.0 / (n + 1.0) - 1e-15 || k > n / (n + 1.0) + 1e-15 {
        return None;
    }
    let pos = sig15(k * (n + 1.0));
    let lo = (pos.floor() as usize).max(1);
    let f = pos - lo as f64;
    let i = lo - 1;
    Some(if i + 1 < s.len() { s[i] + f * (s[i + 1] - s[i]) } else { s[i] })
}

fn sorted(v: &[f64]) -> Vec<f64> {
    let mut s = v.to_vec();
    s.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    s
}

fn mean(v: &[f64]) -> f64 {
    v.iter().sum::<f64>() / v.len() as f64
}

fn moment(v: &[f64], p: i32) -> f64 {
    let m = mean(v);
    v.iter().map(|x| (x - m).powi(p)).sum()
}

impl Eval<'_> {
    fn numbers_a(&self, a: &[Expr]) -> R<Vec<f64>> {
        let mut out = Vec::new();
        self.values(a, &mut |v, direct| {
            match v {
                Value::Error(k) => return Err(*k),
                Value::Number(n) => out.push(*n),
                Value::Bool(b) => out.push(f64::from(*b)),
                Value::Text(_) if direct => out.push(number_of(v)?),
                Value::Text(_) => out.push(0.0),
                Value::Empty => {}
            }
            Ok(())
        })?;
        Ok(out)
    }

    fn xy(&self, a: &[Expr], i: usize, j: usize) -> R<(Vec<f64>, Vec<f64>)> {
        let (x, y) = (self.grid(self.arg(a.get(i).ok_or(ErrKind::Na)?))?, self.grid(self.arg(a.get(j).ok_or(ErrKind::Na)?))?);
        if x.data.len() != y.data.len() {
            return Err(ErrKind::Na);
        }
        let (mut p, mut q) = (Vec::new(), Vec::new());
        for (u, v) in x.data.iter().zip(&y.data) {
            match (u, v) {
                (Value::Error(k), _) | (_, Value::Error(k)) => return Err(*k),
                (Value::Number(u), Value::Number(v)) => {
                    p.push(*u);
                    q.push(*v);
                }
                _ => {}
            }
        }
        Ok((p, q))
    }

    pub(super) fn stat(&self, name: &str, a: &[Expr]) -> Option<R<Value>> {
        Some(match name {
            "MEDIAN" | "MODE" | "MODE.SNGL" | "STDEV" | "STDEV.S" | "STDEV.P" | "VAR" | "VAR.S" | "VAR.P" | "GEOMEAN" | "HARMEAN" | "AVEDEV" | "DEVSQ" | "KURT" | "SKEW" | "SKEW.P" | "STDEVA" | "STDEVPA" | "VARA"
            | "VARPA" | "AVERAGEA" | "MAXA" | "MINA" => self.stat_list(name, a),
            "LARGE" | "SMALL" | "RANK" | "RANK.EQ" | "RANK.AVG" | "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC" | "PERCENTRANK" | "PERCENTRANK.INC"
            | "PERCENTRANK.EXC" | "TRIMMEAN" | "STANDARDIZE" | "MAXIFS" | "MINIFS" | "PROB" => self.stat_rank(name, a),
            "COVARIANCE.P" | "COVARIANCE.S" | "COVAR" | "CORREL" | "PEARSON" | "SLOPE" | "INTERCEPT" | "RSQ" | "STEYX" => self.stat_pair(name, a),
            "Z.TEST" | "T.TEST" | "CHISQ.TEST" | "F.TEST" | "CONFIDENCE.NORM" | "CONFIDENCE.T" | "FISHER" | "FISHERINV" | "PHI" | "GAUSS" | "GAMMA" | "GAMMALN" | "GAMMALN.PRECISE" => self.stat_test(name, a),
            "NORM.DIST" | "NORMDIST" | "NORM.INV" | "NORMINV" | "NORM.S.DIST" | "NORMSDIST" | "NORM.S.INV" | "NORMSINV" | "LOGNORM.DIST" | "LOGNORM.INV" | "EXPON.DIST" | "POISSON.DIST" | "BINOM.DIST"
            | "BINOM.INV" | "WEIBULL.DIST" | "BETA.DIST" | "BETA.INV" | "GAMMA.DIST" | "GAMMA.INV" => self.dist_a(name, a),
            "T.DIST" | "T.DIST.2T" | "T.DIST.RT" | "T.INV" | "T.INV.2T" | "CHISQ.DIST" | "CHISQ.DIST.RT" | "CHISQ.INV" | "CHISQ.INV.RT" | "F.DIST" | "F.DIST.RT" | "F.INV" | "F.INV.RT" => self.dist_b(name, a),
            _ => return None,
        })
    }

    pub(super) fn stat_arr(&self, name: &str, a: &[Expr]) -> Option<R<Arg>> {
        Some(match name {
            "MODE.MULT" => (|| {
                if a.is_empty() {
                    return Err(ErrKind::Na);
                }
                let v = self.numbers(a)?;
                let mut best = 0;
                let mut firsts: Vec<(f64, usize)> = Vec::new();
                for (i, x) in v.iter().enumerate() {
                    if v[..i].contains(x) {
                        continue;
                    }
                    let c = v.iter().filter(|y| *y == x).count();
                    best = best.max(c);
                    firsts.push((*x, c));
                }
                if best < 2 {
                    return Err(ErrKind::Na);
                }
                let data: Vec<Value> = firsts.into_iter().filter(|f| f.1 == best).map(|f| Value::Number(f.0)).collect();
                Ok(Arg::A(Array { rows: data.len(), cols: 1, data }))
            })(),
            "FREQUENCY" => (|| {
                self.arity(a, 2, 2)?;
                let data = self.nums(a, 0)?;
                let bins = self.nums(a, 1)?;
                let mut counts = vec![0.0; bins.len() + 1];
                for d in data {
                    let i = bins.iter().position(|b| d <= *b).unwrap_or(bins.len());
                    counts[i] += 1.0;
                }
                Ok(Arg::A(Array { rows: counts.len(), cols: 1, data: counts.into_iter().map(Value::Number).collect() }))
            })(),
            _ => return None,
        })
    }

    fn stat_list(&self, name: &str, a: &[Expr]) -> R<Value> {
        if a.is_empty() {
            return Err(ErrKind::Na);
        }
        let v = if name.ends_with('A') && !matches!(name, "KURT") || matches!(name, "MAXA" | "MINA") { self.numbers_a(a)? } else { self.numbers(a)? };
        let n = v.len() as f64;
        Ok(num(match name {
            "MEDIAN" => median(&sorted(&v)).ok_or(ErrKind::Num)?,
            "MODE" | "MODE.SNGL" => mode_one(&v).ok_or(ErrKind::Na)?,
            "STDEV" | "STDEV.S" | "STDEVA" => var_of(&v, false).ok_or(ErrKind::Div0)?.sqrt(),
            "STDEV.P" | "STDEVPA" => var_of(&v, true).ok_or(ErrKind::Div0)?.sqrt(),
            "VAR" | "VAR.S" | "VARA" => var_of(&v, false).ok_or(ErrKind::Div0)?,
            "VAR.P" | "VARPA" => var_of(&v, true).ok_or(ErrKind::Div0)?,
            "AVERAGEA" => {
                if v.is_empty() {
                    return Err(ErrKind::Div0);
                }
                mean(&v)
            }
            "MAXA" => v.iter().copied().reduce(f64::max).unwrap_or(0.0),
            "MINA" => v.iter().copied().reduce(f64::min).unwrap_or(0.0),
            "GEOMEAN" | "HARMEAN" => {
                if v.is_empty() || v.iter().any(|x| *x <= 0.0) {
                    return Err(ErrKind::Num);
                }
                if name == "GEOMEAN" {
                    (v.iter().map(|x| x.ln()).sum::<f64>() / n).exp()
                } else {
                    n / v.iter().map(|x| 1.0 / x).sum::<f64>()
                }
            }
            "AVEDEV" => {
                if v.is_empty() {
                    return Err(ErrKind::Num);
                }
                let m = mean(&v);
                v.iter().map(|x| (x - m).abs()).sum::<f64>() / n
            }
            "DEVSQ" => {
                if v.is_empty() {
                    return Err(ErrKind::Num);
                }
                moment(&v, 2)
            }
            "KURT" => {
                if v.len() < 4 {
                    return Err(ErrKind::Div0);
                }
                let s = var_of(&v, false).ok_or(ErrKind::Div0)?.sqrt();
                if s == 0.0 {
                    return Err(ErrKind::Div0);
                }
                n * (n + 1.0) / ((n - 1.0) * (n - 2.0) * (n - 3.0)) * moment(&v, 4) / s.powi(4) - 3.0 * (n - 1.0) * (n - 1.0) / ((n - 2.0) * (n - 3.0))
            }
            "SKEW" => {
                if v.len() < 3 {
                    return Err(ErrKind::Div0);
                }
                let s = var_of(&v, false).ok_or(ErrKind::Div0)?.sqrt();
                if s == 0.0 {
                    return Err(ErrKind::Div0);
                }
                n / ((n - 1.0) * (n - 2.0)) * moment(&v, 3) / s.powi(3)
            }
            _ => {
                if v.is_empty() {
                    return Err(ErrKind::Div0);
                }
                let s = var_of(&v, true).ok_or(ErrKind::Div0)?.sqrt();
                if s == 0.0 {
                    return Err(ErrKind::Div0);
                }
                moment(&v, 3) / n / s.powi(3)
            }
        }))
    }

    fn stat_rank(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "LARGE" | "SMALL" => {
                self.arity(a, 2, 2)?;
                let s = sorted(&self.nums(a, 0)?);
                let k = self.n(a, 1)?;
                if k < 1.0 || k > s.len() as f64 {
                    return Err(ErrKind::Num);
                }
                let i = k.ceil() as usize - 1;
                Ok(num(if name == "LARGE" { s[s.len() - 1 - i] } else { s[i] }))
            }
            "RANK" | "RANK.EQ" | "RANK.AVG" => {
                self.arity(a, 2, 3)?;
                let x = self.n(a, 0)?;
                let v = self.nums(a, 1)?;
                let asc = self.opt(a, 2, 0.0)? != 0.0;
                if !v.contains(&x) {
                    return Err(ErrKind::Na);
                }
                let better = v.iter().filter(|y| if asc { **y < x } else { **y > x }).count() as f64;
                let ties = v.iter().filter(|y| **y == x).count() as f64;
                Ok(num(if name == "RANK.AVG" { better + 1.0 + (ties - 1.0) / 2.0 } else { better + 1.0 }))
            }
            "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC" => {
                self.arity(a, 2, 2)?;
                let s = sorted(&self.nums(a, 0)?);
                let k = self.n(a, 1)?;
                let quart = name.starts_with('Q');
                let exc = name.ends_with("EXC");
                let p = if quart {
                    let q = k.trunc();
                    if !(0.0..=4.0).contains(&q) {
                        return Err(ErrKind::Num);
                    }
                    q / 4.0
                } else {
                    k
                };
                let r = if exc {
                    if quart && (p == 0.0 || p == 1.0) {
                        return Err(ErrKind::Num);
                    }
                    pct_exc(&s, p)
                } else {
                    pct_inc(&s, p)
                };
                Ok(num(r.ok_or(ErrKind::Num)?))
            }
            "PERCENTRANK" | "PERCENTRANK.INC" | "PERCENTRANK.EXC" => {
                self.arity(a, 2, 3)?;
                let s = sorted(&self.nums(a, 0)?);
                let x = self.n(a, 1)?;
                let sig = self.opt(a, 2, 3.0)?.trunc();
                if sig < 1.0 {
                    return Err(ErrKind::Num);
                }
                let n = s.len();
                if n == 0 {
                    return Err(ErrKind::Na);
                }
                if x < s[0] || x > s[n - 1] {
                    return Err(ErrKind::Na);
                }
                let exc = name.ends_with("EXC");
                let denom = if exc { n as f64 + 1.0 } else { n as f64 - 1.0 };
                if denom == 0.0 {
                    return Err(ErrKind::Div0);
                }
                let off = if exc { 1.0 } else { 0.0 };
                let below = s.iter().filter(|y| **y < x).count();
                let r = if s.contains(&x) {
                    (below as f64 + off) / denom
                } else {
                    let (lo, hi) = (s[below - 1], s[below]);
                    (below as f64 - 1.0 + off + (x - lo) / (hi - lo)) / denom
                };
                let m = 10f64.powf(sig);
                Ok(num((sig15(r * m)).floor() / m))
            }
            "TRIMMEAN" => {
                self.arity(a, 2, 2)?;
                let s = sorted(&self.nums(a, 0)?);
                let p = self.n(a, 1)?;
                if !(0.0..1.0).contains(&p) || s.is_empty() {
                    return Err(ErrKind::Num);
                }
                let k = (sig15(s.len() as f64 * p) / 2.0).floor() as usize;
                let part = &s[k..s.len() - k];
                Ok(num(mean(part)))
            }
            "STANDARDIZE" => {
                self.arity(a, 3, 3)?;
                let (x, m, sd) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if sd <= 0.0 {
                    return Err(ErrKind::Num);
                }
                Ok(num((x - m) / sd))
            }
            "PROB" => {
                self.arity(a, 3, 4)?;
                let (x, p) = (self.flat(a, 0)?, self.flat(a, 1)?);
                if x.len() != p.len() {
                    return Err(ErrKind::Na);
                }
                let lo = self.n(a, 2)?;
                let hi = if self.has(a, 3) { self.n(a, 3)? } else { lo };
                let (mut sum, mut hit) = (0.0, 0.0);
                for (xv, pv) in x.iter().zip(&p) {
                    let (xv, pv) = (number_of(xv)?, number_of(pv)?);
                    if !(0.0..=1.0).contains(&pv) {
                        return Err(ErrKind::Num);
                    }
                    sum += pv;
                    if xv >= lo && xv <= hi {
                        hit += pv;
                    }
                }
                if (sum - 1.0).abs() > 1e-9 {
                    return Err(ErrKind::Num);
                }
                Ok(num(hit))
            }
            _ => {
                if a.len() < 3 || !(a.len() - 1).is_multiple_of(2) {
                    return Err(ErrKind::Na);
                }
                let (s0, t) = self.range(&a[0])?;
                let mut pairs = Vec::new();
                for p in a[1..].chunks(2) {
                    let (s, area) = self.range(&p[0])?;
                    if (area.r1 - area.r0, area.c1 - area.c0) != (t.r1 - t.r0, t.c1 - t.c0) {
                        return Err(ErrKind::Value);
                    }
                    pairs.push((s, area, match self.scalar(&p[1]) {
                        Value::Empty => Value::Number(0.0),
                        o => o,
                    }));
                }
                let hits = self.matching(&pairs)?;
                let mut best: Option<f64> = None;
                for (dr, dc) in hits {
                    if let Value::Number(x) = self.ctx.cell(s0, Addr { row: t.r0 + dr, col: t.c0 + dc }) {
                        best = Some(match best {
                            None => x,
                            Some(b) => if name == "MAXIFS" { b.max(x) } else { b.min(x) },
                        });
                    }
                }
                Ok(num(best.unwrap_or(0.0)))
            }
        }
    }

    fn stat_pair(&self, name: &str, a: &[Expr]) -> R<Value> {
        self.arity(a, 2, 2)?;
        let (p, q) = self.xy(a, 0, 1)?;
        let n = p.len() as f64;
        if p.is_empty() {
            return Err(ErrKind::Div0);
        }
        let (mp, mq) = (mean(&p), mean(&q));
        let sxy: f64 = p.iter().zip(&q).map(|(x, y)| (x - mp) * (y - mq)).sum();
        let spp: f64 = p.iter().map(|x| (x - mp) * (x - mp)).sum();
        let sqq: f64 = q.iter().map(|y| (y - mq) * (y - mq)).sum();
        Ok(num(match name {
            "COVARIANCE.P" | "COVAR" => sxy / n,
            "COVARIANCE.S" => {
                if p.len() < 2 {
                    return Err(ErrKind::Div0);
                }
                sxy / (n - 1.0)
            }
            "CORREL" | "PEARSON" | "RSQ" => {
                if p.len() < 2 || spp == 0.0 || sqq == 0.0 {
                    return Err(ErrKind::Div0);
                }
                let r = sxy / (spp * sqq).sqrt();
                if name == "RSQ" { r * r } else { r }
            }
            "SLOPE" | "INTERCEPT" => {
                if p.len() < 2 || sqq == 0.0 {
                    return Err(ErrKind::Div0);
                }
                let s = sxy / sqq;
                if name == "SLOPE" { s } else { mp - s * mq }
            }
            _ => {
                if p.len() < 3 || sqq == 0.0 {
                    return Err(ErrKind::Div0);
                }
                ((spp - sxy * sxy / sqq) / (n - 2.0)).max(0.0).sqrt()
            }
        }))
    }

    fn cum(&self, a: &[Expr], i: usize) -> R<bool> {
        bool_of(&self.scalar(a.get(i).ok_or(ErrKind::Na)?))
    }

    fn stat_test(&self, name: &str, a: &[Expr]) -> R<Value> {
        match name {
            "FISHER" | "FISHERINV" | "PHI" | "GAUSS" | "GAMMA" | "GAMMALN" | "GAMMALN.PRECISE" => {
                self.arity(a, 1, 1)?;
                let x = self.n(a, 0)?;
                Ok(num(match name {
                    "FISHER" if x.abs() >= 1.0 => return Err(ErrKind::Num),
                    "FISHER" => x.atanh(),
                    "FISHERINV" => x.tanh(),
                    "PHI" => norm_pdf(x),
                    "GAUSS" => norm_cdf(x) - 0.5,
                    "GAMMA" => {
                        if x == 0.0 || (x < 0.0 && x == x.floor()) || x > 171.7 {
                            return Err(ErrKind::Num);
                        }
                        gamma(x)
                    }
                    _ => {
                        if x <= 0.0 {
                            return Err(ErrKind::Num);
                        }
                        ln_gamma(x)
                    }
                }))
            }
            "CONFIDENCE.NORM" | "CONFIDENCE.T" => {
                self.arity(a, 3, 3)?;
                let (al, sd, n) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?.trunc());
                if al <= 0.0 || al >= 1.0 || sd <= 0.0 || n < 1.0 {
                    return Err(ErrKind::Num);
                }
                if name == "CONFIDENCE.NORM" {
                    return Ok(num(-norm_inv(al / 2.0) * sd / n.sqrt()));
                }
                if n == 1.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num(t_inv(1.0 - al / 2.0, n - 1.0) * sd / n.sqrt()))
            }
            "Z.TEST" => {
                self.arity(a, 2, 3)?;
                let v = self.nums(a, 0)?;
                let x = self.n(a, 1)?;
                if v.is_empty() {
                    return Err(ErrKind::Na);
                }
                let sigma = if self.has(a, 2) { self.n(a, 2)? } else { var_of(&v, false).ok_or(ErrKind::Div0)?.sqrt() };
                if sigma == 0.0 {
                    return Err(ErrKind::Div0);
                }
                Ok(num(1.0 - norm_cdf((mean(&v) - x) / (sigma / (v.len() as f64).sqrt()))))
            }
            "T.TEST" => {
                self.arity(a, 4, 4)?;
                let (tails, ty) = (self.n(a, 2)?.trunc(), self.n(a, 3)?.trunc());
                if (tails != 1.0 && tails != 2.0) || !(1.0..=3.0).contains(&ty) {
                    return Err(ErrKind::Num);
                }
                let (x, y) = (self.grid(self.arg(&a[0]))?, self.grid(self.arg(&a[1]))?);
                let pick = |g: &Array| -> Vec<Option<f64>> { g.data.iter().map(|v| if let Value::Number(n) = v { Some(*n) } else { None }).collect() };
                let (px, py) = (pick(&x), pick(&y));
                let (t, df) = if ty == 1.0 {
                    if px.len() != py.len() {
                        return Err(ErrKind::Na);
                    }
                    let d: Vec<f64> = px.iter().zip(&py).filter_map(|(p, q)| Some((*p)? - (*q)?)).collect();
                    let sd = var_of(&d, false).ok_or(ErrKind::Div0)?.sqrt();
                    if sd == 0.0 {
                        return Err(ErrKind::Div0);
                    }
                    (mean(&d) / (sd / (d.len() as f64).sqrt()), d.len() as f64 - 1.0)
                } else {
                    let (u, w): (Vec<f64>, Vec<f64>) = (px.into_iter().flatten().collect(), py.into_iter().flatten().collect());
                    let (n1, n2) = (u.len() as f64, w.len() as f64);
                    let (v1, v2) = (var_of(&u, false).ok_or(ErrKind::Div0)?, var_of(&w, false).ok_or(ErrKind::Div0)?);
                    if ty == 2.0 {
                        let sp = ((n1 - 1.0) * v1 + (n2 - 1.0) * v2) / (n1 + n2 - 2.0);
                        let se = (sp * (1.0 / n1 + 1.0 / n2)).sqrt();
                        if se == 0.0 {
                            return Err(ErrKind::Div0);
                        }
                        ((mean(&u) - mean(&w)) / se, n1 + n2 - 2.0)
                    } else {
                        let (s1, s2) = (v1 / n1, v2 / n2);
                        if s1 + s2 == 0.0 {
                            return Err(ErrKind::Div0);
                        }
                        ((mean(&u) - mean(&w)) / (s1 + s2).sqrt(), (s1 + s2).powi(2) / (s1 * s1 / (n1 - 1.0) + s2 * s2 / (n2 - 1.0)))
                    }
                };
                let p2 = t_sf2(t.abs(), df);
                Ok(num(if tails == 1.0 { p2 / 2.0 } else { p2 }))
            }
            "CHISQ.TEST" => {
                self.arity(a, 2, 2)?;
                let (x, e) = (self.grid(self.arg(&a[0]))?, self.grid(self.arg(&a[1]))?);
                if x.rows != e.rows || x.cols != e.cols {
                    return Err(ErrKind::Na);
                }
                let mut chi = 0.0;
                for (p, q) in x.data.iter().zip(&e.data) {
                    match (p, q) {
                        (Value::Error(k), _) | (_, Value::Error(k)) => return Err(*k),
                        (Value::Number(p), Value::Number(q)) => {
                            if *q == 0.0 {
                                return Err(ErrKind::Div0);
                            }
                            chi += (p - q) * (p - q) / q;
                        }
                        _ => {}
                    }
                }
                let df = if x.rows > 1 && x.cols > 1 { ((x.rows - 1) * (x.cols - 1)) as f64 } else { (x.rows.max(x.cols) - 1) as f64 };
                if df < 1.0 {
                    return Err(ErrKind::Na);
                }
                Ok(num(chisq_sf(chi, df)))
            }
            _ => {
                self.arity(a, 2, 2)?;
                let (u, w) = (self.nums(a, 0)?, self.nums(a, 1)?);
                let (v1, v2) = (var_of(&u, false).ok_or(ErrKind::Div0)?, var_of(&w, false).ok_or(ErrKind::Div0)?);
                if v2 == 0.0 || v1 == 0.0 {
                    return Err(ErrKind::Div0);
                }
                let f = v1 / v2;
                let (d1, d2) = (u.len() as f64 - 1.0, w.len() as f64 - 1.0);
                let (lo, hi) = (f_cdf(f, d1, d2), f_sf(f, d1, d2));
                Ok(num((2.0 * lo.min(hi)).min(1.0)))
            }
        }
    }

    fn dist_a(&self, name: &str, a: &[Expr]) -> R<Value> {
        let bad = || Err(ErrKind::Num);
        match name {
            "NORM.DIST" | "NORMDIST" => {
                self.arity(a, 4, 4)?;
                let (x, m, s) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if s <= 0.0 {
                    return bad();
                }
                let z = (x - m) / s;
                Ok(num(if self.cum(a, 3)? { norm_cdf(z) } else { norm_pdf(z) / s }))
            }
            "NORM.S.DIST" | "NORMSDIST" => {
                let one = name == "NORMSDIST";
                self.arity(a, if one { 1 } else { 2 }, if one { 1 } else { 2 })?;
                let z = self.n(a, 0)?;
                Ok(num(if one || self.cum(a, 1)? { norm_cdf(z) } else { norm_pdf(z) }))
            }
            "NORM.INV" | "NORMINV" => {
                self.arity(a, 3, 3)?;
                let (p, m, s) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if p <= 0.0 || p >= 1.0 || s <= 0.0 {
                    return bad();
                }
                Ok(num(m + s * norm_inv(p)))
            }
            "NORM.S.INV" | "NORMSINV" => {
                self.arity(a, 1, 1)?;
                let p = self.n(a, 0)?;
                if p <= 0.0 || p >= 1.0 {
                    return bad();
                }
                Ok(num(norm_inv(p)))
            }
            "LOGNORM.DIST" => {
                self.arity(a, 4, 4)?;
                let (x, m, s) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if x <= 0.0 || s <= 0.0 {
                    return bad();
                }
                let z = (x.ln() - m) / s;
                Ok(num(if self.cum(a, 3)? { norm_cdf(z) } else { norm_pdf(z) / (x * s) }))
            }
            "LOGNORM.INV" => {
                self.arity(a, 3, 3)?;
                let (p, m, s) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if p <= 0.0 || p >= 1.0 || s <= 0.0 {
                    return bad();
                }
                Ok(num((m + s * norm_inv(p)).exp()))
            }
            "EXPON.DIST" => {
                self.arity(a, 3, 3)?;
                let (x, l) = (self.n(a, 0)?, self.n(a, 1)?);
                if x < 0.0 || l <= 0.0 {
                    return bad();
                }
                Ok(num(if self.cum(a, 2)? { 1.0 - (-l * x).exp() } else { l * (-l * x).exp() }))
            }
            "POISSON.DIST" => {
                self.arity(a, 3, 3)?;
                let (x, m) = (self.n(a, 0)?.trunc(), self.n(a, 1)?);
                if x < 0.0 || m < 0.0 {
                    return bad();
                }
                Ok(num(if self.cum(a, 2)? { poisson_cdf(x, m) } else { poisson_pmf(x, m) }))
            }
            "BINOM.DIST" => {
                self.arity(a, 4, 4)?;
                let (k, n, p) = (self.n(a, 0)?.trunc(), self.n(a, 1)?.trunc(), self.n(a, 2)?);
                if k < 0.0 || k > n || !(0.0..=1.0).contains(&p) {
                    return bad();
                }
                Ok(num(if self.cum(a, 3)? { binom_cdf(k, n, p) } else { binom_pmf(k, n, p) }))
            }
            "BINOM.INV" => {
                self.arity(a, 3, 3)?;
                let (n, p, al) = (self.n(a, 0)?.trunc(), self.n(a, 1)?, self.n(a, 2)?);
                if n < 0.0 || !(0.0..=1.0).contains(&p) || !(0.0..=1.0).contains(&al) {
                    return bad();
                }
                let mut k = 0.0;
                while k < n && binom_cdf(k, n, p) < al - 1e-15 {
                    k += 1.0;
                }
                Ok(num(k))
            }
            "WEIBULL.DIST" => {
                self.arity(a, 4, 4)?;
                let (x, al, be) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if x < 0.0 || al <= 0.0 || be <= 0.0 {
                    return bad();
                }
                let t = (x / be).powf(al);
                Ok(num(if self.cum(a, 3)? { 1.0 - (-t).exp() } else { al / be * (x / be).powf(al - 1.0) * (-t).exp() }))
            }
            "GAMMA.DIST" => {
                self.arity(a, 4, 4)?;
                let (x, al, be) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if x < 0.0 || al <= 0.0 || be <= 0.0 {
                    return bad();
                }
                Ok(num(if self.cum(a, 3)? { gamma_p(al, x / be) } else { gamma_pdf(x, al, be) }))
            }
            "GAMMA.INV" => {
                self.arity(a, 3, 3)?;
                let (p, al, be) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?);
                if !(0.0..=1.0).contains(&p) || al <= 0.0 || be <= 0.0 {
                    return bad();
                }
                if p == 0.0 {
                    return Ok(Value::Number(0.0));
                }
                if p == 1.0 {
                    return bad();
                }
                Ok(num(be * invert(&|x| gamma_p(al, x), p, 0.0, al.max(1.0), true)))
            }
            "BETA.DIST" => {
                self.arity(a, 4, 6)?;
                let (x, al, be, lo, hi) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.opt(a, 4, 0.0)?, self.opt(a, 5, 1.0)?);
                if al <= 0.0 || be <= 0.0 || x < lo || x > hi || lo == hi {
                    return bad();
                }
                let z = (x - lo) / (hi - lo);
                Ok(num(if self.cum(a, 3)? { beta_i(z, al, be) } else { beta_pdf(z, al, be) / (hi - lo) }))
            }
            _ => {
                self.arity(a, 3, 5)?;
                let (p, al, be, lo, hi) = (self.n(a, 0)?, self.n(a, 1)?, self.n(a, 2)?, self.opt(a, 3, 0.0)?, self.opt(a, 4, 1.0)?);
                if al <= 0.0 || be <= 0.0 || p <= 0.0 || p > 1.0 || lo >= hi {
                    return bad();
                }
                if p == 1.0 {
                    return Ok(num(hi));
                }
                Ok(num(lo + (hi - lo) * invert(&|x| beta_i(x, al, be), p, 0.0, 1.0, false)))
            }
        }
    }

    fn dist_b(&self, name: &str, a: &[Expr]) -> R<Value> {
        let bad = || Err(ErrKind::Num);
        let df = |i: usize| -> R<f64> {
            let d = self.n(a, i)?.trunc();
            if d < 1.0 || d >= 1e10 {
                Err(ErrKind::Num)
            } else {
                Ok(d)
            }
        };
        match name {
            "T.DIST" => {
                self.arity(a, 3, 3)?;
                let (x, d) = (self.n(a, 0)?, df(1)?);
                Ok(num(if self.cum(a, 2)? { t_cdf(x, d) } else { t_pdf(x, d) }))
            }
            "T.DIST.2T" | "T.DIST.RT" => {
                self.arity(a, 2, 2)?;
                let (x, d) = (self.n(a, 0)?, df(1)?);
                if name == "T.DIST.2T" {
                    if x < 0.0 {
                        return bad();
                    }
                    return Ok(num(t_sf2(x, d)));
                }
                Ok(num(if x >= 0.0 { t_sf2(x, d) / 2.0 } else { 1.0 - t_sf2(-x, d) / 2.0 }))
            }
            "T.INV" | "T.INV.2T" => {
                self.arity(a, 2, 2)?;
                let (p, d) = (self.n(a, 0)?, df(1)?);
                if p <= 0.0 || p > 1.0 || (name == "T.INV" && p >= 1.0) {
                    return bad();
                }
                if name == "T.INV" {
                    return Ok(num(t_inv(p, d)));
                }
                Ok(num(t_inv(1.0 - p / 2.0, d)))
            }
            "CHISQ.DIST" => {
                self.arity(a, 3, 3)?;
                let (x, d) = (self.n(a, 0)?, df(1)?);
                if x < 0.0 {
                    return bad();
                }
                Ok(num(if self.cum(a, 2)? { chisq_cdf(x, d) } else { chisq_pdf(x, d) }))
            }
            "CHISQ.DIST.RT" => {
                self.arity(a, 2, 2)?;
                let (x, d) = (self.n(a, 0)?, df(1)?);
                if x < 0.0 {
                    return bad();
                }
                Ok(num(chisq_sf(x, d)))
            }
            "CHISQ.INV" | "CHISQ.INV.RT" => {
                self.arity(a, 2, 2)?;
                let (p, d) = (self.n(a, 0)?, df(1)?);
                let rt = name == "CHISQ.INV.RT";
                if p < 0.0 || p > 1.0 || (rt && p == 0.0) || (!rt && p == 1.0) {
                    return bad();
                }
                let q = if rt { 1.0 - p } else { p };
                if q == 0.0 {
                    return Ok(Value::Number(0.0));
                }
                Ok(num(invert(&|x| chisq_cdf(x, d), q, 0.0, d.max(1.0), true)))
            }
            "F.DIST" => {
                self.arity(a, 4, 4)?;
                let (x, d1, d2) = (self.n(a, 0)?, df(1)?, df(2)?);
                if x < 0.0 {
                    return bad();
                }
                Ok(num(if self.cum(a, 3)? { f_cdf(x, d1, d2) } else { f_pdf(x, d1, d2) }))
            }
            "F.DIST.RT" => {
                self.arity(a, 3, 3)?;
                let (x, d1, d2) = (self.n(a, 0)?, df(1)?, df(2)?);
                if x < 0.0 {
                    return bad();
                }
                Ok(num(f_sf(x, d1, d2)))
            }
            _ => {
                self.arity(a, 3, 3)?;
                let (p, d1, d2) = (self.n(a, 0)?, df(1)?, df(2)?);
                let rt = name == "F.INV.RT";
                if p < 0.0 || p > 1.0 || (rt && p == 0.0) || (!rt && p == 1.0) {
                    return bad();
                }
                let q = if rt { 1.0 - p } else { p };
                if q == 0.0 {
                    return Ok(Value::Number(0.0));
                }
                Ok(num(invert(&|x| f_cdf(x, d1, d2), q, 0.0, 1.0, true)))
            }
        }
    }
}
