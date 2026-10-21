use super::*;

const INF: f64 = 1e30;

fn big(x: f64) -> String {
    if x >= 1e29 {
        "1E+30".to_string()
    } else if x <= -1e29 {
        "-1E+30".to_string()
    } else {
        fnum(clean_num((x * 1e8).round() / 1e8))
    }
}

fn clean_num(v: f64) -> f64 {
    let r = v.round();
    if (v - r).abs() < 1e-7 * (1.0 + v.abs()) {
        r
    } else {
        v
    }
}

impl LinModel {
    fn solve(&self, row: Option<(usize, f64)>, coef: Option<(usize, f64)>, force: Option<(usize, f64)>) -> Option<(Vec<f64>, f64)> {
        let mut lp = self.lp.clone();
        if let Some((j, d)) = row {
            lp.rows[j].2 += d;
        }
        if let Some((i, d)) = coef {
            lp.c[i] += d;
            if self.free {
                lp.c[self.n + i] -= d;
            }
        }
        if let Some((i, v)) = force {
            let mut r = vec![0.0; lp.c.len()];
            r[i] = 1.0;
            if self.free {
                r[self.n + i] = -1.0;
            }
            lp.rows.push((r, Rel::Eq, v));
        }
        let width = lp.c.len();
        match lp_solve(&lp, width) {
            LpOut::Optimal(v, o) => {
                let x: Vec<f64> = (0..self.n).map(|i| if self.free { v[i] - v[self.n + i] } else { v[i] }).collect();
                Some((x, o))
            }
            _ => None,
        }
    }

    fn rhs_range(&self, j: usize, dir: f64, scale: f64) -> f64 {
        let h = 1e-4 * scale;
        let Some((_, o0)) = self.solve(None, None, None) else { return 0.0 };
        let Some((_, o1)) = self.solve(Some((j, dir * h)), None, None) else { return 0.0 };
        let base = (o1 - o0) / (dir * h);
        let same = |t: f64| self.solve(Some((j, t)), None, None).is_some_and(|(_, o)| (o - o0 - base * t).abs() / (1.0 + o0.abs() + (base * t).abs()) <= 1e-10);
        let mut good = 0.0;
        let mut bad = None;
        let mut t = scale;
        for _ in 0..60 {
            if same(dir * t) {
                good = t;
                t *= 2.0;
            } else {
                bad = Some(t);
                break;
            }
        }
        let Some(mut hi) = bad else { return INF };
        for _ in 0..50 {
            let mid = (good + hi) / 2.0;
            if same(dir * mid) {
                good = mid;
            } else {
                hi = mid;
            }
        }
        good
    }

    fn coef_range(&self, i: usize, dir: f64, x0: &[f64], scale: f64) -> f64 {
        let same = |t: f64| -> bool {
            self.solve(None, Some((i, self.sign * dir * t)), None).is_some_and(|(x, _)| x.iter().zip(x0).all(|(a, b)| (a - b).abs() <= 1e-6 * (1.0 + b.abs())))
        };
        let mut good = 0.0;
        let mut bad = None;
        let mut t = scale;
        for _ in 0..60 {
            if same(t) {
                good = t;
                t *= 2.0;
            } else {
                bad = Some(t);
                break;
            }
        }
        let Some(mut hi) = bad else { return INF };
        for _ in 0..50 {
            let mid = (good + hi) / 2.0;
            if same(mid) {
                good = mid;
            } else {
                hi = mid;
            }
        }
        good
    }
}

impl Workbook {
    pub(super) fn cell_name(&self, k: Key) -> String {
        let left = if k.1.col > 0 { self.val((k.0, Addr { row: k.1.row, col: k.1.col - 1 })) } else { Value::Empty };
        let up = if k.1.row > 0 { self.val((k.0, Addr { row: k.1.row - 1, col: k.1.col })) } else { Value::Empty };
        let mut parts = Vec::new();
        if let Value::Text(t) = up {
            parts.push(t);
        }
        if let Value::Text(t) = left {
            parts.push(t);
        }
        parts.join(" ")
    }

    fn cell_ref(&self, k: Key) -> String {
        format!("{}!${}${}", self.sheets[k.0].name, crate::col_name(k.1.col), k.1.row + 1)
    }

    fn head(&self, out: &mut Vec<(Addr, String)>, title: &str, run: &Run) -> u32 {
        put(out, 0, 0, format!("FormCel Solver {title} Report"));
        put(out, 1, 0, "Result: ".to_string() + &run.message);
        put(out, 2, 0, "Solver Engine: ".to_string() + &run.method);
        4
    }

    pub(super) fn sens_report(&mut self, dst: usize, run: &Run, fx: &mut Effect) -> Reply {
        let p = run.problem.clone().ok_or("Run Solver first; the report describes the last solution.")?;
        let n = p.vars.len();
        let mut out = Vec::new();
        let mut r = self.head(&mut out, "Sensitivity", run);
        match &run.lin {
            Some(m) if m.exact => {
                let x0: Vec<f64> = run.x.clone();
                let base = m.solve(None, None, None).map(|b| b.1).unwrap_or(0.0);
                put(&mut out, r, 0, "Variable Cells");
                r += 1;
                for (i, h) in ["Cell", "Name", "Final Value", "Reduced Cost", "Objective Coefficient", "Allowable Increase", "Allowable Decrease"].iter().enumerate() {
                    put(&mut out, r, i as u32, *h);
                }
                r += 1;
                for i in 0..n {
                    let k = p.vars[i];
                    let coef = m.sign * m.lp.c[i];
                    let scale = 1.0 + coef.abs();
                    let reduced = if x0[i].abs() > 1e-9 {
                        0.0
                    } else {
                        let h = 1.0;
                        m.solve(None, None, Some((i, h))).map_or(0.0, |(_, o)| m.sign * (o - base) / h)
                    };
                    put(&mut out, r, 0, self.cell_ref(k));
                    put(&mut out, r, 1, self.cell_name(k));
                    put(&mut out, r, 2, fnum(clean_num(x0[i])));
                    put(&mut out, r, 3, fnum(clean_num(reduced)));
                    put(&mut out, r, 4, fnum(clean_num(coef)));
                    put(&mut out, r, 5, big(m.coef_range(i, 1.0, &x0, scale)));
                    put(&mut out, r, 6, big(m.coef_range(i, -1.0, &x0, scale)));
                    r += 1;
                }
                r += 1;
                put(&mut out, r, 0, "Constraints");
                r += 1;
                for (i, h) in ["Cell", "Name", "Final Value", "Shadow Price", "Constraint R.H. Side", "Allowable Increase", "Allowable Decrease"].iter().enumerate() {
                    put(&mut out, r, i as u32, *h);
                }
                r += 1;
                for (j, c) in run.cons.iter().enumerate().take(m.ncons) {
                    let scale = 1.0 + c.rhs.abs();
                    let h = 1e-4 * scale;
                    let price = match (m.solve(Some((j, h)), None, None), m.solve(None, None, None)) {
                        (Some((_, a)), Some((_, b))) => m.sign * (a - b) / h,
                        _ => match (m.solve(Some((j, -h)), None, None), m.solve(None, None, None)) {
                            (Some((_, a)), Some((_, b))) => m.sign * (b - a) / h,
                            _ => 0.0,
                        },
                    };
                    let price = if price.abs() < 1e-7 { 0.0 } else { price };
                    let (inc, dec) = if matches!(c.op.as_str(), "<=" | ">=" | "=") {
                        (m.rhs_range(j, 1.0, scale), m.rhs_range(j, -1.0, scale))
                    } else {
                        (0.0, 0.0)
                    };
                    put(&mut out, r, 0, self.cell_ref(c.key));
                    put(&mut out, r, 1, self.cell_name(c.key));
                    put(&mut out, r, 2, fnum(clean_num(c.value)));
                    put(&mut out, r, 3, fnum(clean_num(price)));
                    put(&mut out, r, 4, fnum(clean_num(c.rhs)));
                    put(&mut out, r, 5, big(inc));
                    put(&mut out, r, 6, big(dec));
                    r += 1;
                }
            }
            _ => {
                let x: Vec<f64> = run.x.clone();
                let grad = |wb: &mut Workbook, f: &dyn Fn(&Sample) -> f64| -> Vec<f64> {
                    (0..n)
                        .map(|i| {
                            let h = 1e-5 * (1.0 + x[i].abs());
                            let (mut a, mut b) = (x.clone(), x.clone());
                            a[i] += h;
                            b[i] -= h;
                            match (wb.sample(&p, &a), wb.sample(&p, &b)) {
                                (Some(sa), Some(sb)) => (f(&sa) - f(&sb)) / (2.0 * h),
                                _ => 0.0,
                            }
                        })
                        .collect()
                };
                let gf = grad(self, &|s| s.obj);
                let mut gcs: Vec<(usize, Vec<f64>)> = Vec::new();
                for (j, c) in run.cons.iter().enumerate() {
                    let sign = if c.op == ">=" { -1.0 } else { 1.0 };
                    if (c.value - c.rhs).abs() <= 1e-6 * (1.0 + c.rhs.abs()) {
                        let g = grad(self, &move |s: &Sample| sign * (s.gaps[j].0 - s.gaps[j].1));
                        gcs.push((j, g));
                    }
                }
                let mut lambda = vec![0.0; run.cons.len()];
                if !gcs.is_empty() {
                    let cols: Vec<Vec<f64>> = gcs.iter().map(|g| g.1.clone()).collect();
                    if let Some(fit) = stats::ols(&gf, &cols, false) {
                        for (k, (j, _)) in gcs.iter().enumerate() {
                            lambda[*j] = fit.coef[k] * if run.cons[*j].op == ">=" { -1.0 } else { 1.0 };
                        }
                    }
                }
                let mut reduced = gf.clone();
                for (k, (_, g)) in gcs.iter().enumerate() {
                    let lam = lambda[gcs[k].0] * if run.cons[gcs[k].0].op == ">=" { -1.0 } else { 1.0 };
                    for i in 0..n {
                        reduced[i] -= lam * g[i];
                    }
                }
                put(&mut out, r, 0, "Variable Cells");
                r += 1;
                for (i, h) in ["Cell", "Name", "Final Value", "Reduced Gradient"].iter().enumerate() {
                    put(&mut out, r, i as u32, *h);
                }
                r += 1;
                for i in 0..n {
                    let k = p.vars[i];
                    let rg = if reduced[i].abs() < 1e-6 { 0.0 } else { reduced[i] };
                    put(&mut out, r, 0, self.cell_ref(k));
                    put(&mut out, r, 1, self.cell_name(k));
                    put(&mut out, r, 2, fnum(clean_num(x[i])));
                    put(&mut out, r, 3, fnum(clean_num(rg)));
                    r += 1;
                }
                r += 1;
                put(&mut out, r, 0, "Constraints");
                r += 1;
                for (i, h) in ["Cell", "Name", "Final Value", "Lagrange Multiplier"].iter().enumerate() {
                    put(&mut out, r, i as u32, *h);
                }
                r += 1;
                for (j, c) in run.cons.iter().enumerate() {
                    put(&mut out, r, 0, self.cell_ref(c.key));
                    put(&mut out, r, 1, self.cell_name(c.key));
                    put(&mut out, r, 2, fnum(clean_num(c.value)));
                    put(&mut out, r, 3, fnum(clean_num(if lambda[j].abs() < 1e-7 { 0.0 } else { lambda[j] })));
                    r += 1;
                }
                let _ = self.sample(&p, &x);
                put(&mut out, r + 1, 0, "This model is not a plain linear program, so FormCel reports reduced gradients and Lagrange multipliers found by finite differences.");
            }
        }
        self.put_all(dst, &out, fx)?;
        Ok("ok".to_string())
    }

    fn reach(&mut self, p: &Problem, x: &[f64], i: usize, dir: f64) -> Option<(f64, f64)> {
        let integer = p.int[i];
        let feasible = |wb: &mut Workbook, v: f64| -> Option<f64> {
            let mut xv = x.to_vec();
            xv[i] = v;
            let s = wb.sample(p, &xv)?;
            (Workbook::violation(p, &s, &xv) <= 1e-9 * (1.0 + v.abs())).then_some(s.obj)
        };
        let mut good = x[i];
        let mut step = if integer { 1.0 } else { (0.01 * x[i].abs()).max(1e-3) };
        let mut bad = None;
        for _ in 0..60 {
            let v = good + dir * step;
            if feasible(self, v).is_some() {
                good = v;
                step *= 2.0;
            } else {
                bad = Some(v);
                break;
            }
        }
        let mut hi = bad?;
        for _ in 0..60 {
            if integer {
                if (hi - good).abs() <= 1.0 {
                    break;
                }
                let mid = ((good + hi) / 2.0).round();
                if mid == good || mid == hi {
                    break;
                }
                if feasible(self, mid).is_some() {
                    good = mid;
                } else {
                    hi = mid;
                }
            } else {
                let mid = (good + hi) / 2.0;
                if feasible(self, mid).is_some() {
                    good = mid;
                } else {
                    hi = mid;
                }
            }
        }
        let obj = feasible(self, good)?;
        Some((good, obj))
    }

    pub(super) fn limits_report(&mut self, dst: usize, run: &Run, fx: &mut Effect) -> Reply {
        let p = run.problem.clone().ok_or("Run Solver first; the report describes the last solution.")?;
        let x = run.x.clone();
        let mut out = Vec::new();
        let mut r = self.head(&mut out, "Limits", run);
        let final_obj = run.objective.map_or(f64::NAN, |o| o.2);
        put(&mut out, r, 0, "Objective");
        r += 1;
        for (i, h) in ["Cell", "Name", "Value"].iter().enumerate() {
            put(&mut out, r, i as u32, *h);
        }
        r += 1;
        put(&mut out, r, 0, self.cell_ref(p.obj));
        put(&mut out, r, 1, self.cell_name(p.obj));
        put(&mut out, r, 2, fnum(clean_num(final_obj)));
        r += 2;
        put(&mut out, r, 0, "Variables");
        r += 1;
        for (i, h) in ["Cell", "Name", "Value", "Lower Limit", "Target Result", "Upper Limit", "Target Result"].iter().enumerate() {
            put(&mut out, r, i as u32, *h);
        }
        r += 1;
        for i in 0..p.vars.len() {
            let k = p.vars[i];
            put(&mut out, r, 0, self.cell_ref(k));
            put(&mut out, r, 1, self.cell_name(k));
            put(&mut out, r, 2, fnum(clean_num(x[i])));
            for (col, dir) in [(3u32, -1.0), (5u32, 1.0)] {
                match self.reach(&p, &x, i, dir) {
                    Some((v, o)) => {
                        put(&mut out, r, col, fnum(clean_num(v)));
                        put(&mut out, r, col + 1, fnum(clean_num(o)));
                    }
                    None => {
                        put(&mut out, r, col, if dir < 0.0 { "-1E+30" } else { "1E+30" });
                        put(&mut out, r, col + 1, "#N/A");
                    }
                }
            }
            r += 1;
        }
        let _ = self.sample(&p, &x);
        self.put_all(dst, &out, fx)?;
        Ok("ok".to_string())
    }
}
