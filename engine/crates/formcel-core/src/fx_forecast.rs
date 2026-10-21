use super::*;
use crate::stats;

fn numeric(g: &Array) -> Result<Vec<Option<f64>>, ErrKind> {
    g.data
        .iter()
        .map(|v| match v {
            Value::Error(k) => Err(*k),
            Value::Number(n) => Ok(Some(*n)),
            _ => Ok(None),
        })
        .collect()
}

fn pairs(y: &Array, x: &Array) -> Result<(Vec<f64>, Vec<f64>), ErrKind> {
    if y.data.len() != x.data.len() {
        return Err(ErrKind::Na);
    }
    let (a, b) = (numeric(y)?, numeric(x)?);
    let (mut ys, mut xs) = (Vec::new(), Vec::new());
    for (p, q) in a.into_iter().zip(b) {
        if let (Some(p), Some(q)) = (p, q) {
            ys.push(p);
            xs.push(q);
        }
    }
    if ys.len() < 2 {
        return Err(ErrKind::Div0);
    }
    Ok((ys, xs))
}

fn shaped(rows: usize, cols: usize, data: Vec<Value>) -> Arg {
    Arg::A(Array { rows, cols, data })
}

impl Eval<'_> {
    fn pair_args(&self, a: &[Expr]) -> Result<(Vec<f64>, Vec<f64>), ErrKind> {
        if a.len() != 2 {
            return Err(ErrKind::Na);
        }
        let (y, x) = (self.grid(self.arg(&a[0]))?, self.grid(self.arg(&a[1]))?);
        pairs(&y, &x)
    }

    fn opt_flag(&self, a: &[Expr], i: usize, d: bool) -> Result<bool, ErrKind> {
        if a.len() > i && !matches!(a[i], Expr::Missing) {
            bool_of(&self.scalar(&a[i]))
        } else {
            Ok(d)
        }
    }

    fn opt_f64(&self, a: &[Expr], i: usize, d: f64) -> Result<f64, ErrKind> {
        if a.len() > i && !matches!(a[i], Expr::Missing) {
            self.n(a, i)
        } else {
            Ok(d)
        }
    }

    pub(super) fn call_stat(&self, name: &str, a: &[Expr]) -> Result<Value, ErrKind> {
        Ok(match name {
            "SLOPE" | "INTERCEPT" | "RSQ" | "STEYX" | "CORREL" => {
                let (y, x) = self.pair_args(a)?;
                if name == "CORREL" {
                    return stats::correl(&x, &y).map(num).ok_or(ErrKind::Div0);
                }
                let f = stats::ols(&y, &[x.clone()], true).ok_or(ErrKind::Div0)?;
                match name {
                    "SLOPE" => num(f.coef[0]),
                    "INTERCEPT" => num(f.coef[1]),
                    "RSQ" => num(stats::correl(&x, &y).ok_or(ErrKind::Div0)?.powi(2)),
                    _ => {
                        if y.len() < 3 {
                            return Err(ErrKind::Div0);
                        }
                        num(f.sey)
                    }
                }
            }
            "FORECAST" | "FORECAST.LINEAR" => {
                if a.len() != 3 {
                    return Err(ErrKind::Na);
                }
                let x0 = self.n(a, 0)?;
                let (y, x) = self.pair_args(&a[1..])?;
                let f = stats::ols(&y, &[x], true).ok_or(ErrKind::Div0)?;
                num(f.coef[1] + f.coef[0] * x0)
            }
            "FORECAST.ETS" | "FORECAST.ETS.CONFINT" | "FORECAST.ETS.SEASONALITY" | "FORECAST.ETS.STAT" => return self.ets_call(name, a),
            _ => return Err(ErrKind::Name),
        })
    }

    fn ets_call(&self, name: &str, a: &[Expr]) -> Result<Value, ErrKind> {
        let conf = name == "FORECAST.ETS.CONFINT";
        let stat = name == "FORECAST.ETS.STAT";
        let seas = name == "FORECAST.ETS.SEASONALITY";
        let head = if seas || stat { 0 } else { 1 };
        let (lo, hi) = if seas { (2, 5) } else if conf { (3, 7) } else if stat { (3, 6) } else { (3, 6) };
        if a.len() < lo || a.len() > hi {
            return Err(ErrKind::Na);
        }
        let (vals, times) = (self.grid(self.arg(&a[head]))?, self.grid(self.arg(&a[head + 1]))?);
        if vals.data.len() != times.data.len() {
            return Err(ErrKind::Na);
        }
        let mut y = Vec::new();
        let mut t = Vec::new();
        for (v, tm) in vals.data.iter().zip(&times.data) {
            match (v, tm) {
                (Value::Error(k), _) | (_, Value::Error(k)) => return Err(*k),
                (Value::Number(p), Value::Number(q)) => {
                    y.push(*p);
                    t.push(*q);
                }
                (_, Value::Number(_)) => y.push(f64::NAN),
                _ => return Err(ErrKind::Value),
            }
        }
        if y.iter().any(|v| v.is_nan()) {
            return Err(ErrKind::Value);
        }
        let confidence = if conf { self.opt_f64(a, 3, 0.95)? } else { 0.95 };
        if conf && !(confidence > 0.0 && confidence < 1.0) {
            return Err(ErrKind::Num);
        }
        let (si, ci, ai) = if conf { (4, 5, 6) } else if seas { (2, 3, 4) } else { (3, 4, 5) };
        let seasonality = self.opt_f64(a, si, 1.0)?;
        let completion = self.opt_f64(a, ci, 1.0)?;
        let aggr = self.opt_f64(a, ai, 0.0)?;
        if !(completion == 0.0 || completion == 1.0) || aggr < 0.0 || aggr > 7.0 {
            return Err(ErrKind::Num);
        }
        let series = stats::prepare(&t, &y, completion as i32, aggr as i32)?;
        let model = stats::ets_model(&series, seasonality)?;
        if seas {
            return Ok(num(if model.m > 1 { model.m as f64 } else { 0.0 }));
        }
        if stat {
            let k = self.n(a, 2)?;
            if !(1.0..=8.0).contains(&k) || k.fract() != 0.0 {
                return Err(ErrKind::Num);
            }
            let v = match k as i32 {
                1 => model.alpha,
                2 => model.beta,
                3 => model.gamma,
                4 => model.mase(&series.y),
                5 => model.smape(&series.y),
                6 => model.mae(),
                7 => model.rmse(),
                _ => series.step,
            };
            return Ok(num(v));
        }
        let target = self.n(a, 0)?;
        let h = series.offset(target) - series.last_offset();
        if h.is_nan() || h <= 0.0 {
            return Err(ErrKind::Num);
        }
        if conf {
            Ok(num(model.half_width(h, confidence)))
        } else {
            Ok(num(model.forecast(h)))
        }
    }

    pub(super) fn call_stat_arr(&self, name: &str, a: &[Expr]) -> Result<Arg, ErrKind> {
        match name {
            "LINEST" | "TREND" => {
                let trend = name == "TREND";
                if a.is_empty() || a.len() > 4 {
                    return Err(ErrKind::Na);
                }
                let yg = self.grid(self.arg(&a[0]))?;
                let ys = numeric(&yg)?.into_iter().collect::<Option<Vec<f64>>>().ok_or(ErrKind::Value)?;
                let n = ys.len();
                let by_col = yg.cols == 1 || yg.rows != 1;
                let xg = if a.len() > 1 && !matches!(a[1], Expr::Missing) {
                    Some(self.grid(self.arg(&a[1]))?)
                } else {
                    None
                };
                let (xs, shape) = match &xg {
                    None => (vec![(1..=n).map(|i| i as f64).collect::<Vec<f64>>()], 1),
                    Some(g) => {
                        let vals = numeric(g)?.into_iter().collect::<Option<Vec<f64>>>().ok_or(ErrKind::Value)?;
                        if g.rows == yg.rows && g.cols == yg.cols {
                            (vec![vals], 1)
                        } else if yg.cols == 1 && g.rows == yg.rows {
                            ((0..g.cols).map(|c| (0..g.rows).map(|r| vals[r * g.cols + c]).collect()).collect(), g.cols)
                        } else if yg.rows == 1 && g.cols == yg.cols {
                            ((0..g.rows).map(|r| vals[r * g.cols..(r + 1) * g.cols].to_vec()).collect(), g.rows)
                        } else {
                            return Err(ErrKind::Ref);
                        }
                    }
                };
                let _ = (by_col, shape);
                if trend {
                    let konst = self.opt_flag(a, 3, true)?;
                    let fit = stats::ols(&ys, &xs, konst).ok_or(ErrKind::Num)?;
                    let k = xs.len();
                    let news: Vec<Vec<f64>> = if a.len() > 2 && !matches!(a[2], Expr::Missing) {
                        let g = self.grid(self.arg(&a[2]))?;
                        let vals = numeric(&g)?.into_iter().collect::<Option<Vec<f64>>>().ok_or(ErrKind::Value)?;
                        if k == 1 {
                            return Ok(shaped(g.rows, g.cols, vals.iter().map(|x| num(fit.predict(&[*x]))).collect()));
                        }
                        if yg.cols == 1 && g.cols == k {
                            (0..g.rows).map(|r| vals[r * g.cols..(r + 1) * g.cols].to_vec()).collect()
                        } else if yg.rows == 1 && g.rows == k {
                            (0..g.cols).map(|c| (0..g.rows).map(|r| vals[r * g.cols + c]).collect()).collect()
                        } else {
                            return Err(ErrKind::Ref);
                        }
                    } else {
                        (0..n).map(|i| xs.iter().map(|x| x[i]).collect()).collect()
                    };
                    let out: Vec<Value> = news.iter().map(|p| num(fit.predict(p))).collect();
                    return Ok(if yg.cols == 1 || yg.rows != 1 { shaped(out.len(), 1, out) } else { shaped(1, out.len(), out) });
                }
                let konst = self.opt_flag(a, 2, true)?;
                let stats_on = self.opt_flag(a, 3, false)?;
                let fit = stats::ols(&ys, &xs, konst).ok_or(ErrKind::Num)?;
                let k = xs.len();
                let w = k + 1;
                let order = |i: usize| -> usize { if i < k { k - 1 - i } else { k } };
                let mut data = Vec::new();
                let rows = if stats_on { 5 } else { 1 };
                for r in 0..rows {
                    for c in 0..w {
                        let idx = order(c);
                        let v = match r {
                            0 => if idx == k && !konst { num(0.0) } else { num(fit.coef[idx]) },
                            1 => if idx == k && !konst { err(ErrKind::Na) } else { num(fit.se[idx]) },
                            2 => match c {
                                0 => num(fit.r2),
                                1 => num(fit.sey),
                                _ => err(ErrKind::Na),
                            },
                            3 => match c {
                                0 => num(fit.f),
                                1 => num(fit.df),
                                _ => err(ErrKind::Na),
                            },
                            _ => match c {
                                0 => num(fit.ssreg),
                                1 => num(fit.ssresid),
                                _ => err(ErrKind::Na),
                            },
                        };
                        data.push(v);
                    }
                }
                Ok(shaped(rows, w, data))
            }
            _ => Err(ErrKind::Name),
        }
    }
}
