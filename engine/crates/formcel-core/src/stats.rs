use std::f64::consts::PI;

pub fn mean(v: &[f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.iter().sum::<f64>() / v.len() as f64
}

pub fn var_s(v: &[f64]) -> f64 {
    if v.len() < 2 {
        return f64::NAN;
    }
    let m = mean(v);
    v.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / (v.len() - 1) as f64
}

pub fn median(v: &[f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = s.len();
    if n % 2 == 1 {
        s[n / 2]
    } else {
        (s[n / 2 - 1] + s[n / 2]) / 2.0
    }
}

pub fn mode(v: &[f64]) -> Option<f64> {
    let mut best: Option<(f64, usize)> = None;
    for (i, x) in v.iter().enumerate() {
        let n = v.iter().filter(|y| *y == x).count();
        if n > 1 && best.is_none_or(|(_, bn)| n > bn) {
            let first = v.iter().position(|y| y == x).unwrap_or(i);
            if first == i {
                best = Some((*x, n));
            }
        }
    }
    best.map(|b| b.0)
}

pub fn skew(v: &[f64]) -> f64 {
    let n = v.len() as f64;
    if n < 3.0 {
        return f64::NAN;
    }
    let (m, s) = (mean(v), var_s(v).sqrt());
    if s == 0.0 {
        return f64::NAN;
    }
    v.iter().map(|x| ((x - m) / s).powi(3)).sum::<f64>() * n / ((n - 1.0) * (n - 2.0))
}

pub fn kurt(v: &[f64]) -> f64 {
    let n = v.len() as f64;
    if n < 4.0 {
        return f64::NAN;
    }
    let (m, s) = (mean(v), var_s(v).sqrt());
    if s == 0.0 {
        return f64::NAN;
    }
    let t: f64 = v.iter().map(|x| ((x - m) / s).powi(4)).sum();
    t * n * (n + 1.0) / ((n - 1.0) * (n - 2.0) * (n - 3.0)) - 3.0 * (n - 1.0) * (n - 1.0) / ((n - 2.0) * (n - 3.0))
}

pub fn lgamma(x: f64) -> f64 {
    const G: [f64; 9] = [0.999_999_999_999_809_9, 676.520_368_121_885_1, -1_259.139_216_722_402_8, 771.323_428_777_653_1, -176.615_029_162_140_6, 12.507_343_278_686_905, -0.138_571_095_265_720_12, 9.984_369_578_019_572e-6, 1.505_632_735_149_311_6e-7];
    if x < 0.5 {
        return (PI / (PI * x).sin()).ln() - lgamma(1.0 - x);
    }
    let x = x - 1.0;
    let mut a = G[0];
    let t = x + 7.5;
    for (i, g) in G.iter().enumerate().skip(1) {
        a += g / (x + i as f64);
    }
    0.5 * (2.0 * PI).ln() + (x + 0.5) * t.ln() - t + a.ln()
}

fn betacf(a: f64, b: f64, x: f64) -> f64 {
    let (qab, qap, qam) = (a + b, a + 1.0, a - 1.0);
    let tiny = 1e-300;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < tiny {
        d = tiny;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..400 {
        let m = m as f64;
        let m2 = 2.0 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < tiny {
            d = tiny;
        }
        c = 1.0 + aa / c;
        if c.abs() < tiny {
            c = tiny;
        }
        d = 1.0 / d;
        h *= d * c;
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < tiny {
            d = tiny;
        }
        c = 1.0 + aa / c;
        if c.abs() < tiny {
            c = tiny;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 1e-15 {
            break;
        }
    }
    h
}

pub fn beta_reg(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let bt = (lgamma(a + b) - lgamma(a) - lgamma(b) + a * x.ln() + b * (1.0 - x).ln()).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * betacf(a, b, x) / a
    } else {
        1.0 - bt * betacf(b, a, 1.0 - x) / b
    }
}

pub fn t_two_tail(t: f64, df: f64) -> f64 {
    if df <= 0.0 || t.is_nan() {
        return f64::NAN;
    }
    beta_reg(df / 2.0, 0.5, df / (df + t * t))
}

pub fn f_upper(f: f64, d1: f64, d2: f64) -> f64 {
    if f <= 0.0 || d1 <= 0.0 || d2 <= 0.0 {
        return f64::NAN;
    }
    beta_reg(d2 / 2.0, d1 / 2.0, d2 / (d2 + d1 * f))
}

pub fn t_inv_two_tail(p: f64, df: f64) -> f64 {
    if !(p > 0.0 && p <= 1.0) || df < 1.0 {
        return f64::NAN;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    while t_two_tail(hi, df) > p && hi < 1e12 {
        hi *= 2.0;
    }
    for _ in 0..200 {
        let mid = (lo + hi) / 2.0;
        if t_two_tail(mid, df) > p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo + hi) / 2.0
}

pub fn norm_s_inv(p: f64) -> f64 {
    if !(p > 0.0 && p < 1.0) {
        return f64::NAN;
    }
    const A: [f64; 6] = [-3.969_683_028_665_376e1, 2.209_460_984_245_205e2, -2.759_285_104_469_687e2, 1.383_577_518_672_690e2, -3.066_479_806_614_716e1, 2.506_628_277_459_239];
    const B: [f64; 5] = [-5.447_609_879_822_406e1, 1.615_858_368_580_409e2, -1.556_989_798_598_866e2, 6.680_131_188_771_972e1, -1.328_068_155_288_572e1];
    const C: [f64; 6] = [-7.784_894_002_430_293e-3, -3.223_964_580_411_365e-1, -2.400_758_277_161_838, -2.549_732_539_343_734, 4.374_664_141_464_968, 2.938_163_982_698_783];
    const D: [f64; 4] = [7.784_695_709_041_462e-3, 3.224_671_290_700_398e-1, 2.445_134_137_142_996, 3.754_408_661_907_416];
    let lo = 0.02425;
    let x = if p < lo {
        let q = (-2.0 * p.ln()).sqrt();
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    } else if p <= 1.0 - lo {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };
    x
}

pub fn norm_cdf(z: f64) -> f64 {
    let x = z.abs() / std::f64::consts::SQRT_2;
    let upper = if x < 2.0 {
        let (mut term, mut sum, mut n) = (x, x, 0.0);
        while term.abs() > 1e-17 * sum.abs() && n < 500.0 {
            n += 1.0;
            term *= 2.0 * x * x / (2.0 * n + 1.0);
            sum += term;
        }
        1.0 - 2.0 / std::f64::consts::PI.sqrt() * (-x * x).exp() * sum
    } else {
        let mut f = 0.0;
        for k in (1..=200).rev() {
            f = f64::from(k) / 2.0 / (x + f);
        }
        (-x * x).exp() / std::f64::consts::PI.sqrt() / (x + f)
    } / 2.0;
    if z >= 0.0 {
        1.0 - upper
    } else {
        upper
    }
}

pub fn correl(x: &[f64], y: &[f64]) -> Option<f64> {
    if x.len() != y.len() || x.len() < 2 {
        return None;
    }
    let (mx, my) = (mean(x), mean(y));
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (a, b) in x.iter().zip(y) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx) * (a - mx);
        syy += (b - my) * (b - my);
    }
    if sxx == 0.0 || syy == 0.0 {
        return None;
    }
    Some(sxy / (sxx * syy).sqrt())
}

fn invert(m: &mut Vec<Vec<f64>>) -> bool {
    let n = m.len();
    let mut inv: Vec<Vec<f64>> = (0..n).map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect();
    for c in 0..n {
        let mut p = c;
        for r in c + 1..n {
            if m[r][c].abs() > m[p][c].abs() {
                p = r;
            }
        }
        if m[p][c].abs() < 1e-12 {
            return false;
        }
        m.swap(c, p);
        inv.swap(c, p);
        let d = m[c][c];
        for j in 0..n {
            m[c][j] /= d;
            inv[c][j] /= d;
        }
        for r in 0..n {
            if r != c {
                let f = m[r][c];
                if f != 0.0 {
                    for j in 0..n {
                        m[r][j] -= f * m[c][j];
                        inv[r][j] -= f * inv[c][j];
                    }
                }
            }
        }
    }
    *m = inv;
    true
}

#[derive(Clone, Debug)]
pub struct Fit {
    pub coef: Vec<f64>,
    pub se: Vec<f64>,
    pub constant: bool,
    pub r2: f64,
    pub sey: f64,
    pub f: f64,
    pub df: f64,
    pub ssreg: f64,
    pub sstotal: f64,
    pub ssresid: f64,
    pub n: usize,
}

impl Fit {
    pub fn predict(&self, xs: &[f64]) -> f64 {
        let k = xs.len();
        let mut y = if self.constant { self.coef[k] } else { 0.0 };
        for (i, x) in xs.iter().enumerate() {
            y += self.coef[i] * x;
        }
        y
    }
}

pub fn ols(y: &[f64], xs: &[Vec<f64>], constant: bool) -> Option<Fit> {
    let n = y.len();
    let k = xs.len();
    if n == 0 || k == 0 || xs.iter().any(|x| x.len() != n) {
        return None;
    }
    let p = k + usize::from(constant);
    if n < p {
        return None;
    }
    let col = |j: usize, i: usize| if j < k { xs[j][i] } else { 1.0 };
    let mut xtx = vec![vec![0.0; p]; p];
    let mut xty = vec![0.0; p];
    for i in 0..n {
        for a in 0..p {
            xty[a] += col(a, i) * y[i];
            for b in 0..p {
                xtx[a][b] += col(a, i) * col(b, i);
            }
        }
    }
    if !invert(&mut xtx) {
        return None;
    }
    let beta: Vec<f64> = (0..p).map(|a| (0..p).map(|b| xtx[a][b] * xty[b]).sum()).collect();
    let mut ssresid = 0.0;
    for i in 0..n {
        let yh: f64 = (0..p).map(|a| beta[a] * col(a, i)).sum();
        ssresid += (y[i] - yh) * (y[i] - yh);
    }
    let sstotal = if constant { let m = mean(y); y.iter().map(|v| (v - m) * (v - m)).sum() } else { y.iter().map(|v| v * v).sum() };
    let df = (n - p) as f64;
    let ssreg = sstotal - ssresid;
    let r2 = if sstotal == 0.0 { 1.0 } else { ssreg / sstotal };
    let s2 = if df > 0.0 { ssresid / df } else { f64::NAN };
    let se: Vec<f64> = (0..p).map(|a| (s2 * xtx[a][a]).sqrt()).collect();
    let dfr = k as f64;
    let f = if df > 0.0 && ssresid > 0.0 { (ssreg / dfr) / (ssresid / df) } else { f64::NAN };
    Some(Fit { coef: beta, se, constant, r2, sey: s2.sqrt(), f, df, ssreg, sstotal, ssresid, n })
}

#[derive(Clone, Debug)]
pub struct Ets {
    pub alpha: f64,
    pub beta: f64,
    pub gamma: f64,
    pub m: usize,
    pub n: usize,
    pub level: f64,
    pub trend: f64,
    pub season: Vec<f64>,
    pub sse: f64,
    pub errors: Vec<f64>,
    pub fitted: Vec<f64>,
}

fn ets_run(y: &[f64], m: usize, a: f64, b: f64, g: f64) -> Ets {
    let n = y.len();
    let seasonal = m > 1 && n >= 2 * m;
    let m = if seasonal { m } else { 1 };
    let (mut level, mut trend, mut season) = if seasonal {
        let m0 = mean(&y[..m]);
        let b0 = (mean(&y[m..2 * m]) - m0) / m as f64;
        let l0 = m0 - b0 * (m as f64 + 1.0) / 2.0;
        let mut s: Vec<f64> = (0..m).map(|t| y[t] - (l0 + b0 * (t as f64 + 1.0))).collect();
        let sm = mean(&s);
        for v in s.iter_mut() {
            *v -= sm;
        }
        (l0 + b0 * m as f64, b0, s)
    } else {
        let k = n.min(8);
        let b0 = if n > 1 { (y[k - 1] - y[0]) / (k - 1) as f64 } else { 0.0 };
        (y[0], b0, vec![0.0])
    };
    let start = if seasonal { m } else { 1 };
    let mut sse = 0.0;
    let mut errors = Vec::with_capacity(n);
    let mut fitted = Vec::with_capacity(n);
    for t in 0..start.min(n) {
        fitted.push(if seasonal { level - trend * (m - t) as f64 + season[t] - trend * 0.0 } else { y[0] });
        errors.push(0.0);
    }
    if seasonal {
        for t in 0..m {
            fitted[t] = y[t];
        }
    }
    for t in start..n {
        let si = t % m;
        let pred = level + trend + if seasonal { season[si] } else { 0.0 };
        let e = y[t] - pred;
        sse += e * e;
        errors.push(e);
        fitted.push(pred);
        let nl = level + trend + a * e;
        trend += a * b * e;
        if seasonal {
            season[si] += g * (1.0 - a) * e;
        }
        level = nl;
    }
    Ets { alpha: a, beta: b, gamma: g, m, n, level, trend, season, sse, errors, fitted }
}

pub fn nelder_mead(f: &dyn Fn(&[f64]) -> f64, start: &[f64], step: f64, iters: usize) -> (Vec<f64>, f64) {
    let d = start.len();
    let mut pts: Vec<Vec<f64>> = vec![start.to_vec()];
    for i in 0..d {
        let mut p = start.to_vec();
        p[i] += if p[i].abs() > 1e-9 { step * p[i].abs().max(0.1) } else { step };
        pts.push(p);
    }
    let mut vals: Vec<f64> = pts.iter().map(|p| f(p)).collect();
    for _ in 0..iters {
        let mut idx: Vec<usize> = (0..=d).collect();
        idx.sort_by(|&a, &b| vals[a].partial_cmp(&vals[b]).unwrap_or(std::cmp::Ordering::Equal));
        pts = idx.iter().map(|&i| pts[i].clone()).collect();
        vals = idx.iter().map(|&i| vals[i]).collect();
        if (vals[d] - vals[0]).abs() <= 1e-12 * (vals[0].abs() + 1e-12) && iters > 50 {
            let spread: f64 = (0..d).map(|j| (pts[d][j] - pts[0][j]).abs()).sum();
            if spread < 1e-10 {
                break;
            }
        }
        let cen: Vec<f64> = (0..d).map(|j| pts[..d].iter().map(|p| p[j]).sum::<f64>() / d as f64).collect();
        let mix = |t: f64| -> Vec<f64> { (0..d).map(|j| cen[j] + t * (pts[d][j] - cen[j])).collect() };
        let xr = mix(-1.0);
        let fr = f(&xr);
        if fr < vals[0] {
            let xe = mix(-2.0);
            let fe = f(&xe);
            if fe < fr {
                pts[d] = xe;
                vals[d] = fe;
            } else {
                pts[d] = xr;
                vals[d] = fr;
            }
        } else if fr < vals[d - 1] {
            pts[d] = xr;
            vals[d] = fr;
        } else {
            let xc = if fr < vals[d] { mix(-0.5) } else { mix(0.5) };
            let fc = f(&xc);
            if fc < vals[d].min(fr) {
                pts[d] = xc;
                vals[d] = fc;
            } else {
                for i in 1..=d {
                    for j in 0..d {
                        pts[i][j] = pts[0][j] + 0.5 * (pts[i][j] - pts[0][j]);
                    }
                    vals[i] = f(&pts[i]);
                }
            }
        }
    }
    let mut best = 0;
    for i in 1..=d {
        if vals[i] < vals[best] {
            best = i;
        }
    }
    (pts[best].clone(), vals[best])
}

pub fn ets_fit(y: &[f64], m: usize) -> Ets {
    let clamp = |x: f64| x.clamp(0.0001, 0.9999);
    let seasonal = m > 1 && y.len() >= 2 * m;
    let obj = |p: &[f64]| -> f64 {
        let pen: f64 = p.iter().map(|x| if *x < 0.0001 { (0.0001 - x) * 1e6 } else if *x > 0.9999 { (x - 0.9999) * 1e6 } else { 0.0 }).sum();
        let r = ets_run(y, m, clamp(p[0]), clamp(p[1]), clamp(p[2]));
        r.sse + pen * (1.0 + r.sse)
    };
    let starts: [[f64; 3]; 4] = [[0.3, 0.1, 0.1], [0.7, 0.05, 0.3], [0.1, 0.01, 0.5], [0.9, 0.3, 0.05]];
    let mut best: Option<(Vec<f64>, f64)> = None;
    for s in starts {
        let (p, v) = nelder_mead(&obj, &s, 0.3, 300);
        if best.as_ref().is_none_or(|b| v < b.1) {
            best = Some((p, v));
        }
    }
    let p = best.map(|b| b.0).unwrap_or_else(|| vec![0.3, 0.1, 0.1]);
    let _ = seasonal;
    ets_run(y, m, clamp(p[0]), clamp(p[1]), clamp(p[2]))
}

impl Ets {
    pub fn forecast(&self, h: f64) -> f64 {
        let hh = h.max(0.0);
        let s = if self.m > 1 {
            let idx = (self.n as f64 - 1.0 + hh.ceil()).max(0.0) as usize % self.m;
            self.season[idx]
        } else {
            0.0
        };
        self.level + hh * self.trend + s
    }

    pub fn sigma(&self) -> f64 {
        let start = if self.m > 1 { self.m } else { 1 };
        let cnt = self.n.saturating_sub(start);
        let params = if self.m > 1 { 3.0 + self.m as f64 + 2.0 } else { 4.0 };
        let df = (cnt as f64 - params).max(1.0);
        let df = if cnt as f64 > params { df } else { cnt.max(1) as f64 };
        (self.sse / df).sqrt()
    }

    pub fn half_width(&self, h: f64, confidence: f64) -> f64 {
        let hn = h.ceil().max(1.0) as usize;
        let mut v = 1.0;
        for j in 1..hn {
            let jf = j as f64;
            let mut c = self.alpha * (1.0 + jf * self.beta);
            if self.m > 1 && j % self.m == 0 {
                c += self.gamma * (1.0 - self.alpha);
            }
            v += c * c;
        }
        norm_s_inv(1.0 - (1.0 - confidence) / 2.0) * self.sigma() * v.sqrt()
    }

    pub fn mase(&self, y: &[f64]) -> f64 {
        let start = if self.m > 1 { self.m } else { 1 };
        let naive: f64 = (start..y.len()).map(|t| (y[t] - y[t - start.min(t).max(1)]).abs()).sum::<f64>() / (y.len().saturating_sub(start)).max(1) as f64;
        let mae = self.errors.iter().skip(start).map(|e| e.abs()).sum::<f64>() / (self.n.saturating_sub(start)).max(1) as f64;
        if naive == 0.0 { f64::NAN } else { mae / naive }
    }

    pub fn smape(&self, y: &[f64]) -> f64 {
        let start = if self.m > 1 { self.m } else { 1 };
        let cnt = self.n.saturating_sub(start).max(1) as f64;
        (start..y.len()).map(|t| {
            let d = y[t].abs() + self.fitted[t].abs();
            if d == 0.0 { 0.0 } else { 2.0 * (y[t] - self.fitted[t]).abs() / d }
        }).sum::<f64>() / cnt
    }

    pub fn mae(&self) -> f64 {
        let start = if self.m > 1 { self.m } else { 1 };
        self.errors.iter().skip(start).map(|e| e.abs()).sum::<f64>() / (self.n.saturating_sub(start)).max(1) as f64
    }

    pub fn rmse(&self) -> f64 {
        let start = if self.m > 1 { self.m } else { 1 };
        (self.sse / (self.n.saturating_sub(start)).max(1) as f64).sqrt()
    }
}

fn acf(y: &[f64], lag: usize) -> f64 {
    let m = mean(y);
    let den: f64 = y.iter().map(|v| (v - m) * (v - m)).sum();
    if den == 0.0 || lag >= y.len() {
        return 0.0;
    }
    (lag..y.len()).map(|t| (y[t] - m) * (y[t - lag] - m)).sum::<f64>() / den
}

pub fn detect_season(y: &[f64]) -> usize {
    let n = y.len();
    if n < 8 {
        return 1;
    }
    let reg = ols(y, &[(0..n).map(|i| i as f64).collect()], true);
    let flat: Vec<f64> = match &reg {
        Some(f) => (0..n).map(|i| y[i] - f.predict(&[i as f64])).collect(),
        None => y.to_vec(),
    };
    let max_lag = (n / 2).min(8760);
    let bound = 1.96 / (n as f64).sqrt();
    let mut cands: Vec<(usize, f64)> = (2..=max_lag).map(|l| (l, acf(&flat, l))).collect();
    cands.retain(|(l, r)| *r > bound && *r >= acf(&flat, l - 1) && *r >= acf(&flat, l + 1));
    cands.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let base = ets_fit(y, 1);
    let aic = |e: &Ets| {
        let k = if e.m > 1 { 3.0 + e.m as f64 } else { 3.0 };
        let cnt = (n - if e.m > 1 { e.m } else { 1 }) as f64;
        cnt * (e.sse.max(1e-12) / cnt).ln() + 2.0 * k + 2.0 * k * (k + 1.0) / (cnt - k - 1.0).max(1.0)
    };
    let mut best = (1usize, aic(&base));
    for (l, _) in cands.into_iter().take(4) {
        if n < 2 * l {
            continue;
        }
        let e = ets_fit(y, l);
        let a = aic(&e);
        if a < best.1 - 2.0 {
            best = (l, a);
        }
    }
    best.0
}

use crate::formula::ErrKind;

#[derive(Clone, Debug)]
pub struct Series {
    pub y: Vec<f64>,
    pub t0: f64,
    pub step: f64,
    pub month: bool,
}

fn month_index(serial: f64) -> Option<(i64, i64)> {
    crate::numfmt::ymd(serial).map(|(y, m, d)| (y * 12 + m - 1, d))
}

fn month_end(serial: f64) -> bool {
    crate::numfmt::ymd(serial + 1.0).is_some_and(|(_, _, d)| d == 1)
}

fn fgcd(a: f64, b: f64) -> f64 {
    let (mut a, mut b) = (a.abs(), b.abs());
    let eps = 1e-9 * a.max(b).max(1.0);
    while b > eps {
        let r = a % b;
        a = b;
        b = r;
    }
    a
}

fn aggregate(v: &[f64], code: i32) -> f64 {
    match code {
        2 | 3 => v.len() as f64,
        4 => v.iter().cloned().fold(f64::MIN, f64::max),
        5 => median(v),
        6 => v.iter().cloned().fold(f64::MAX, f64::min),
        7 => v.iter().sum(),
        _ => mean(v),
    }
}

pub fn prepare(times: &[f64], vals: &[f64], completion: i32, aggr: i32) -> Result<Series, ErrKind> {
    if times.len() != vals.len() {
        return Err(ErrKind::Na);
    }
    if times.len() < 3 {
        return Err(ErrKind::Value);
    }
    let mut pairs: Vec<(f64, f64)> = times.iter().cloned().zip(vals.iter().cloned()).collect();
    pairs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut uniq: Vec<(f64, f64)> = Vec::new();
    let mut i = 0;
    while i < pairs.len() {
        let mut j = i;
        while j < pairs.len() && pairs[j].0 == pairs[i].0 {
            j += 1;
        }
        let group: Vec<f64> = pairs[i..j].iter().map(|p| p.1).collect();
        uniq.push((pairs[i].0, if group.len() == 1 { group[0] } else { aggregate(&group, aggr) }));
        i = j;
    }
    if uniq.len() < 3 {
        return Err(ErrKind::Num);
    }
    let ts: Vec<f64> = uniq.iter().map(|p| p.0).collect();
    let mut step = 0.0;
    for w in ts.windows(2) {
        step = if step == 0.0 { w[1] - w[0] } else { fgcd(step, w[1] - w[0]) };
    }
    let slots = ((ts[ts.len() - 1] - ts[0]) / step).round() as usize + 1;
    let (mut month, mut idx): (bool, Vec<f64>) = (false, Vec::new());
    if step > 0.0 && (slots as f64) > ts.len() as f64 * 1.0 / 0.7 + 1.0 && ts.iter().all(|t| t.fract() == 0.0) {
        let mi: Vec<Option<(i64, i64)>> = ts.iter().map(|t| month_index(*t)).collect();
        if mi.iter().all(Option::is_some) {
            let mi: Vec<(i64, i64)> = mi.into_iter().flatten().collect();
            let same_day = mi.iter().all(|(_, d)| *d == mi[0].1);
            let ends = ts.iter().all(|t| month_end(*t));
            if same_day || ends {
                let mut ms = 0;
                for w in mi.windows(2) {
                    ms = if ms == 0 { w[1].0 - w[0].0 } else { gcd_i(ms, w[1].0 - w[0].0) };
                }
                if ms > 0 {
                    month = true;
                    step = ms as f64;
                    idx = mi.iter().map(|(m, _)| ((m - mi[0].0) as f64) / step).collect();
                }
            }
        }
    }
    if !month {
        idx = ts.iter().map(|t| (t - ts[0]) / step).collect();
        if idx.iter().any(|x| (x - x.round()).abs() > 1e-6) {
            return Err(ErrKind::Num);
        }
    }
    let n = idx.last().map(|x| x.round() as usize + 1).unwrap_or(0);
    if n > 1_000_000 || step <= 0.0 {
        return Err(ErrKind::Num);
    }
    let mut grid: Vec<Option<f64>> = vec![None; n];
    for (k, p) in uniq.iter().enumerate() {
        grid[idx[k].round() as usize] = Some(p.1);
    }
    let missing = grid.iter().filter(|g| g.is_none()).count();
    if missing as f64 / n as f64 > 0.3 {
        return Err(ErrKind::Num);
    }
    let mut y = vec![0.0; n];
    for k in 0..n {
        y[k] = match grid[k] {
            Some(v) => v,
            None if completion == 0 => 0.0,
            None => {
                let lo = (0..k).rev().find(|j| grid[*j].is_some()).unwrap_or(0);
                let hi = (k + 1..n).find(|j| grid[*j].is_some()).unwrap_or(n - 1);
                let (a, b) = (grid[lo].unwrap_or(0.0), grid[hi].unwrap_or(0.0));
                a + (b - a) * (k - lo) as f64 / (hi - lo).max(1) as f64
            }
        };
    }
    Ok(Series { y, t0: ts[0], step, month })
}

fn gcd_i(a: i64, b: i64) -> i64 {
    if b == 0 { a.abs() } else { gcd_i(b, a % b) }
}

impl Series {
    pub fn offset(&self, t: f64) -> f64 {
        if self.month {
            match (month_index(t), month_index(self.t0)) {
                (Some((m, _)), Some((m0, _))) => (m - m0) as f64 / self.step,
                _ => f64::NAN,
            }
        } else {
            (t - self.t0) / self.step
        }
    }

    pub fn time_at(&self, k: f64) -> f64 {
        if self.month {
            let Some((y, m, d)) = crate::numfmt::ymd(self.t0) else { return f64::NAN };
            let total = y * 12 + m - 1 + (k * self.step).round() as i64;
            let (ny, nm) = (total.div_euclid(12), total.rem_euclid(12) + 1);
            let end = month_end(self.t0);
            let last = crate::numfmt::serial(if nm == 12 { ny + 1 } else { ny }, if nm == 12 { 1 } else { nm + 1 }, 1).unwrap_or(0.0) - 1.0;
            let first = crate::numfmt::serial(ny, nm, 1).unwrap_or(0.0);
            let dd = if end { last } else { (first + (d - 1) as f64).min(last) };
            dd
        } else {
            self.t0 + k * self.step
        }
    }

    pub fn last_offset(&self) -> f64 {
        (self.y.len() - 1) as f64
    }
}

pub fn ets_model(s: &Series, seasonality: f64) -> Result<Ets, ErrKind> {
    if seasonality < 0.0 || seasonality.fract() != 0.0 || seasonality > 8760.0 {
        return Err(ErrKind::Num);
    }
    let m = if seasonality == 1.0 { detect_season(&s.y) } else if seasonality == 0.0 { 1 } else { seasonality as usize };
    Ok(ets_fit(&s.y, m))
}
