use std::f64::consts::PI;

const COF: [f64; 14] = [
    57.156_235_665_862_92,
    -59.597_960_355_475_49,
    14.136_097_974_741_747,
    -0.491_913_816_097_620_2,
    0.339_946_499_848_118_9e-4,
    0.465_236_289_270_485_75e-4,
    -0.983_744_753_048_795_6e-4,
    0.158_088_703_224_912_5e-3,
    -0.210_264_441_724_104_9e-3,
    0.217_439_618_115_212_64e-3,
    -0.164_318_106_536_763_9e-3,
    0.844_182_239_838_527_4e-4,
    -0.261_908_384_015_814_1e-4,
    0.368_991_826_595_316_2e-5,
];

pub fn ln_gamma(x: f64) -> f64 {
    if x <= 0.0 {
        return f64::NAN;
    }
    let mut y = x;
    let mut tmp = x + 5.242_187_5;
    tmp = (x + 0.5) * tmp.ln() - tmp;
    let mut ser = 0.999_999_999_999_997_1;
    for c in COF {
        y += 1.0;
        ser += c / y;
    }
    tmp + (2.506_628_274_631_000_5 * ser / x).ln()
}

pub fn gamma(x: f64) -> f64 {
    if x == x.floor() {
        if x <= 0.0 {
            return f64::NAN;
        }
        if x <= 171.0 {
            let mut p = 1.0;
            let mut i = 2.0;
            while i < x {
                p *= i;
                i += 1.0;
            }
            return p;
        }
        return f64::INFINITY;
    }
    if x < 0.5 {
        return PI / ((PI * x).sin() * gamma(1.0 - x));
    }
    ln_gamma(x).exp()
}

pub fn ln_choose(n: f64, k: f64) -> f64 {
    ln_gamma(n + 1.0) - ln_gamma(k + 1.0) - ln_gamma(n - k + 1.0)
}

fn gser(a: f64, x: f64) -> f64 {
    let mut ap = a;
    let mut del = 1.0 / a;
    let mut sum = del;
    for _ in 0..100_000 {
        ap += 1.0;
        del *= x / ap;
        sum += del;
        if del.abs() < sum.abs() * 1e-16 {
            break;
        }
    }
    sum * (-x + a * x.ln() - ln_gamma(a)).exp()
}

fn gcf(a: f64, x: f64) -> f64 {
    let fpmin = 1e-300;
    let mut b = x + 1.0 - a;
    let mut c = 1.0 / fpmin;
    let mut d = 1.0 / b;
    let mut h = d;
    for i in 1..100_000 {
        let an = -(i as f64) * (i as f64 - a);
        b += 2.0;
        d = an * d + b;
        if d.abs() < fpmin {
            d = fpmin;
        }
        c = b + an / c;
        if c.abs() < fpmin {
            c = fpmin;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 1e-16 {
            break;
        }
    }
    (-x + a * x.ln() - ln_gamma(a)).exp() * h
}

pub fn gamma_p(a: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x < a + 1.0 {
        gser(a, x)
    } else {
        1.0 - gcf(a, x)
    }
}

pub fn gamma_q(a: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 1.0;
    }
    if x < a + 1.0 {
        1.0 - gser(a, x)
    } else {
        gcf(a, x)
    }
}

fn betacf(a: f64, b: f64, x: f64) -> f64 {
    let fpmin = 1e-300;
    let (qab, qap, qam) = (a + b, a + 1.0, a - 1.0);
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < fpmin {
        d = fpmin;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..100_000 {
        let m = m as f64;
        let m2 = 2.0 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < fpmin {
            d = fpmin;
        }
        c = 1.0 + aa / c;
        if c.abs() < fpmin {
            c = fpmin;
        }
        d = 1.0 / d;
        h *= d * c;
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < fpmin {
            d = fpmin;
        }
        c = 1.0 + aa / c;
        if c.abs() < fpmin {
            c = fpmin;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 1e-16 {
            break;
        }
    }
    h
}

pub fn beta_i(x: f64, a: f64, b: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let bt = (ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * x.ln() + b * (1.0 - x).ln()).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * betacf(a, b, x) / a
    } else {
        1.0 - bt * betacf(b, a, 1.0 - x) / b
    }
}

pub fn erfc(x: f64) -> f64 {
    if x >= 0.0 {
        gamma_q(0.5, x * x)
    } else {
        2.0 - gamma_q(0.5, x * x)
    }
}

pub fn norm_cdf(z: f64) -> f64 {
    0.5 * erfc(-z / std::f64::consts::SQRT_2)
}

pub fn norm_pdf(z: f64) -> f64 {
    (-0.5 * z * z).exp() / (2.0 * PI).sqrt()
}

pub fn norm_inv(p: f64) -> f64 {
    let a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    let b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    let c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    let d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    let plow = 0.02425;
    let mut x = if p < plow {
        let q = (-2.0 * p.ln()).sqrt();
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    } else if p <= 1.0 - plow {
        let q = p - 0.5;
        let r = q * q;
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    };
    for _ in 0..3 {
        let e = if x > 0.0 { (1.0 - p) - 0.5 * erfc(x / std::f64::consts::SQRT_2) } else { 0.5 * erfc(-x / std::f64::consts::SQRT_2) - p };
        let u = e * (2.0 * PI).sqrt() * (x * x / 2.0).exp();
        x -= u / (1.0 + x * u / 2.0);
    }
    x
}

pub fn invert(cdf: &dyn Fn(f64) -> f64, p: f64, mut lo: f64, mut hi: f64, grow: bool) -> f64 {
    if grow {
        let mut k = 0;
        while cdf(hi) < p && k < 2000 {
            lo = hi;
            hi *= 2.0;
            k += 1;
        }
    }
    for _ in 0..300 {
        let mid = 0.5 * (lo + hi);
        if mid == lo || mid == hi {
            break;
        }
        if cdf(mid) < p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

pub fn t_cdf(x: f64, v: f64) -> f64 {
    let tail = 0.5 * beta_i(v / (v + x * x), v / 2.0, 0.5);
    if x > 0.0 {
        1.0 - tail
    } else {
        tail
    }
}

pub fn t_sf2(x: f64, v: f64) -> f64 {
    beta_i(v / (v + x * x), v / 2.0, 0.5)
}

pub fn t_pdf(x: f64, v: f64) -> f64 {
    (ln_gamma((v + 1.0) / 2.0) - ln_gamma(v / 2.0) - 0.5 * (v * PI).ln() - (v + 1.0) / 2.0 * (1.0 + x * x / v).ln()).exp()
}

pub fn t_inv(p: f64, v: f64) -> f64 {
    if p == 0.5 {
        return 0.0;
    }
    let (q, neg) = if p < 0.5 { (1.0 - p, true) } else { (p, false) };
    let r = invert(&|x| t_cdf(x, v), q, 0.0, 1.0, true);
    if neg {
        -r
    } else {
        r
    }
}

pub fn chisq_cdf(x: f64, k: f64) -> f64 {
    gamma_p(k / 2.0, x / 2.0)
}

pub fn chisq_sf(x: f64, k: f64) -> f64 {
    gamma_q(k / 2.0, x / 2.0)
}

pub fn chisq_pdf(x: f64, k: f64) -> f64 {
    if x < 0.0 {
        return 0.0;
    }
    if x == 0.0 {
        return if k == 2.0 { 0.5 } else if k < 2.0 { f64::INFINITY } else { 0.0 };
    }
    ((k / 2.0 - 1.0) * x.ln() - x / 2.0 - (k / 2.0) * 2f64.ln() - ln_gamma(k / 2.0)).exp()
}

pub fn f_cdf(x: f64, d1: f64, d2: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    beta_i(d1 * x / (d1 * x + d2), d1 / 2.0, d2 / 2.0)
}

pub fn f_sf(x: f64, d1: f64, d2: f64) -> f64 {
    if x <= 0.0 {
        return 1.0;
    }
    beta_i(d2 / (d2 + d1 * x), d2 / 2.0, d1 / 2.0)
}

pub fn f_pdf(x: f64, d1: f64, d2: f64) -> f64 {
    if x < 0.0 {
        return 0.0;
    }
    if x == 0.0 {
        return if d1 == 2.0 { 1.0 } else if d1 < 2.0 { f64::INFINITY } else { 0.0 };
    }
    let lb = ln_gamma(d1 / 2.0) + ln_gamma(d2 / 2.0) - ln_gamma((d1 + d2) / 2.0);
    (0.5 * (d1 * (d1 * x).ln() + d2 * d2.ln() - (d1 + d2) * (d1 * x + d2).ln()) - x.ln() - lb).exp()
}

pub fn gamma_pdf(x: f64, a: f64, b: f64) -> f64 {
    if x < 0.0 {
        return 0.0;
    }
    if x == 0.0 {
        return if a == 1.0 { 1.0 / b } else if a < 1.0 { f64::INFINITY } else { 0.0 };
    }
    ((a - 1.0) * x.ln() - x / b - a * b.ln() - ln_gamma(a)).exp()
}

pub fn beta_pdf(x: f64, a: f64, b: f64) -> f64 {
    if x < 0.0 || x > 1.0 {
        return 0.0;
    }
    if x == 0.0 {
        return if a == 1.0 { b } else if a < 1.0 { f64::INFINITY } else { 0.0 };
    }
    if x == 1.0 {
        return if b == 1.0 { a } else if b < 1.0 { f64::INFINITY } else { 0.0 };
    }
    ((a - 1.0) * x.ln() + (b - 1.0) * (1.0 - x).ln() + ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b)).exp()
}

pub fn binom_pmf(k: f64, n: f64, p: f64) -> f64 {
    if p == 0.0 {
        return if k == 0.0 { 1.0 } else { 0.0 };
    }
    if p == 1.0 {
        return if k == n { 1.0 } else { 0.0 };
    }
    (ln_choose(n, k) + k * p.ln() + (n - k) * (1.0 - p).ln()).exp()
}

pub fn binom_cdf(k: f64, n: f64, p: f64) -> f64 {
    if k >= n {
        return 1.0;
    }
    if p == 0.0 {
        return 1.0;
    }
    if p == 1.0 {
        return 0.0;
    }
    beta_i(1.0 - p, n - k, k + 1.0)
}

pub fn poisson_pmf(k: f64, m: f64) -> f64 {
    if m == 0.0 {
        return if k == 0.0 { 1.0 } else { 0.0 };
    }
    (-m + k * m.ln() - ln_gamma(k + 1.0)).exp()
}

pub fn poisson_cdf(k: f64, m: f64) -> f64 {
    if m == 0.0 {
        return 1.0;
    }
    gamma_q(k + 1.0, m)
}
