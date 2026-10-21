use super::*;

const TOL: f64 = 1e-6;

fn pseudo(i: usize, j: usize) -> f64 {
    let x = ((i * 7919 + j * 104_729 + 13) as f64).sin() * 10_000.0;
    (x - x.floor()) * 4.0 + 0.5
}

impl Workbook {
    fn problem(&self, a: &[String], sheet: usize) -> Result<Problem, String> {
        let obj = self.one(&a[1], sheet)?;
        if !self.formulas.contains_key(&obj) {
            return Err(format!("The objective cell {} must contain a formula.", to_a1(obj.1)));
        }
        let mode = a[2].to_ascii_lowercase();
        if !["max", "min", "value"].contains(&mode.as_str()) {
            return Err("Choose Max, Min or Value of.".to_string());
        }
        let target = if mode == "value" { pnum(&a[3])? } else { 0.0 };
        let mut vars: Vec<Key> = Vec::new();
        for r in a[4].split(',').filter(|s| !s.trim().is_empty()) {
            let (sh, ar) = self.resolve(r, sheet)?;
            for c in cells_of(ar) {
                if self.formulas.contains_key(&(sh, c)) {
                    return Err(format!("Variable cell {} contains a formula; Solver changes cells that hold values.", to_a1(c)));
                }
                if !vars.contains(&(sh, c)) {
                    vars.push((sh, c));
                }
            }
        }
        if vars.is_empty() {
            return Err("Give at least one variable cell.".to_string());
        }
        if vars.len() > 200 {
            return Err("Solver handles at most 200 variable cells.".to_string());
        }
        let mut p = Problem { obj, mode, target, vars: vars.clone(), nonneg: a[5] != "0", cons: Vec::new(), int: vec![false; vars.len()], bin: vec![false; vars.len()] };
        for line in a.iter().skip(7) {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() < 2 {
                continue;
            }
            let (lhs_t, op) = (parts[0].trim(), parts[1].trim().to_string());
            let (lsh, lar) = self.resolve(lhs_t, sheet)?;
            let lcells = cells_of(lar);
            if op == "int" || op == "bin" {
                for c in lcells {
                    let Some(i) = vars.iter().position(|v| *v == (lsh, c)) else {
                        return Err(format!("{} can only be applied to variable cells; {} is not one.", op, to_a1(c)));
                    };
                    if op == "int" {
                        p.int[i] = true;
                    } else {
                        p.int[i] = true;
                        p.bin[i] = true;
                    }
                }
                continue;
            }
            if !["<=", ">=", "="].contains(&op.as_str()) {
                return Err(format!("Constraint {} has no <=, >=, =, int or bin relation.", lhs_t));
            }
            let rhs_t = parts.get(2).map(|s| s.trim()).unwrap_or("");
            let (rhs_cells, rhs_num): (Vec<Key>, f64) = match rhs_t.parse::<f64>() {
                Ok(n) => (Vec::new(), n),
                Err(_) => {
                    let (rsh, rar) = self.resolve(rhs_t, sheet)?;
                    (cells_of(rar).into_iter().map(|c| (rsh, c)).collect(), 0.0)
                }
            };
            if !rhs_cells.is_empty() && rhs_cells.len() != 1 && rhs_cells.len() != lcells.len() {
                return Err(format!("The constraint {} needs a right side of the same size.", lhs_t));
            }
            for (i, c) in lcells.iter().enumerate() {
                let rhs = match rhs_cells.len() {
                    0 => None,
                    1 => Some(rhs_cells[0]),
                    _ => Some(rhs_cells[i]),
                };
                let text = format!("{} {} {}", to_a1(*c), op, rhs_t);
                p.cons.push(Con { lhs: (lsh, *c), op: op.clone(), rhs, rhs_num, text });
            }
        }
        Ok(p)
    }

    pub(super) fn sample(&mut self, p: &Problem, x: &[f64]) -> Option<Sample> {
        let sets: Vec<(Key, String)> = p.vars.iter().zip(x).map(|(k, v)| (*k, num_raw(*v))).collect();
        self.temp(&sets);
        let obj = self.numval(p.obj)?;
        let mut gaps = Vec::with_capacity(p.cons.len());
        for c in &p.cons {
            let l = self.numval(c.lhs)?;
            let r = match c.rhs {
                Some(k) => self.numval(k)?,
                None => c.rhs_num,
            };
            gaps.push((l, r, c.op.clone()));
        }
        Some(Sample { obj, gaps })
    }

    pub(super) fn violation(p: &Problem, s: &Sample, x: &[f64]) -> f64 {
        let mut v = 0.0;
        for (l, r, op) in &s.gaps {
            v += match op.as_str() {
                "<=" => (l - r).max(0.0),
                ">=" => (r - l).max(0.0),
                _ => (l - r).abs(),
            };
        }
        for (i, xi) in x.iter().enumerate() {
            if p.nonneg && *xi < 0.0 {
                v += -xi;
            }
            if p.bin[i] {
                v += (xi - 1.0).max(0.0);
            }
        }
        v
    }

    fn linear_model(&mut self, p: &Problem, x0: &[f64]) -> Option<(Sample, Vec<Sample>)> {
        let base = self.sample(p, x0)?;
        let mut cols = Vec::with_capacity(x0.len());
        for i in 0..x0.len() {
            let mut x = x0.to_vec();
            x[i] += 1.0;
            cols.push(self.sample(p, &x)?);
        }
        Some((base, cols))
    }

    pub(super) fn solve(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let sheet = self.sheet_of(&a[0])?;
        let p = self.problem(a, sheet)?;
        let n = p.vars.len();
        let mut orig = Vec::with_capacity(n);
        let mut orig_raw = Vec::with_capacity(n);
        for k in &p.vars {
            orig.push(match self.val(*k) {
                Value::Number(v) => v,
                Value::Empty => 0.0,
                _ => return Err(format!("Variable cell {} holds text; Solver needs numbers.", to_a1(k.1))),
            });
            orig_raw.push((*k, self.input(k.0, k.1)));
        }
        let obj_orig = self.numval(p.obj);
        let hint = a[6].as_str();
        let mut result: Option<(Vec<f64>, String, String)> = None;
        let mut message = String::new();
        let mut linear = false;
        let mut lin_model: Option<LinModel> = None;
        if hint != "nl" {
            let x0: Vec<f64> = orig.clone();
            if let Some((base, cols)) = self.linear_model(&p, &x0) {
                let coefs = |f: &dyn Fn(&Sample) -> f64| -> Vec<f64> { cols.iter().map(|c| f(c) - f(&base)).collect() };
                let gcount = base.gaps.len();
                let g_of = |s: &Sample, j: usize| s.gaps[j].0 - s.gaps[j].1;
                let obj_c = coefs(&|s| s.obj);
                let g_c: Vec<Vec<f64>> = (0..gcount).map(|j| coefs(&|s| g_of(s, j))).collect();
                let mut ok = true;
                for t in 0..2 {
                    let x: Vec<f64> = (0..n).map(|i| pseudo(i, t)).collect();
                    match self.sample(&p, &x) {
                        Some(s) => {
                            let pred = |c0: f64, cf: &[f64]| c0 + cf.iter().zip(x.iter().zip(&x0)).map(|(c, (xi, x0i))| c * (xi - x0i)).sum::<f64>();
                            let tol = |v: f64| 1e-7 * (1.0 + v.abs());
                            if (pred(base.obj, &obj_c) - s.obj).abs() > tol(s.obj) {
                                ok = false;
                            }
                            for j in 0..gcount {
                                if (pred(g_of(&base, j), &g_c[j]) - g_of(&s, j)).abs() > tol(g_of(&s, j)) {
                                    ok = false;
                                }
                            }
                        }
                        None => ok = false,
                    }
                }
                if ok {
                    linear = true;
                    let free = !p.nonneg;
                    let width = if free { 2 * n } else { n };
                    let expand = |v: &[f64]| -> Vec<f64> {
                        let mut out = v.to_vec();
                        if free {
                            out.extend(v.iter().map(|x| -x));
                        }
                        out
                    };
                    let konst = |c0: f64, cf: &[f64]| c0 - cf.iter().zip(&x0).map(|(c, x)| c * x).sum::<f64>();
                    let sign = if p.mode == "max" { -1.0 } else { 1.0 };
                    let mut lp = Lp { c: if p.mode == "value" { vec![0.0; width] } else { expand(&obj_c.iter().map(|c| c * sign).collect::<Vec<_>>()) }, rows: Vec::new() };
                    for (j, con) in p.cons.iter().enumerate() {
                        let g0 = konst(g_of(&base, j), &g_c[j]);
                        let rel = match con.op.as_str() {
                            "<=" => Rel::Le,
                            ">=" => Rel::Ge,
                            _ => Rel::Eq,
                        };
                        lp.rows.push((expand(&g_c[j]), rel, -g0));
                    }
                    if p.mode == "value" {
                        lp.rows.push((expand(&obj_c), Rel::Eq, p.target - konst(base.obj, &obj_c)));
                    }
                    for i in 0..n {
                        if p.bin[i] {
                            let mut row = vec![0.0; width];
                            row[i] = 1.0;
                            if free {
                                row[n + i] = -1.0;
                            }
                            lp.rows.push((row, Rel::Le, 1.0));
                        }
                    }
                    let ints: Vec<usize> = if free { Vec::new() } else { (0..n).filter(|i| p.int[*i]).collect() };
                    let out = if ints.is_empty() { lp_solve(&lp, width) } else { milp(&lp, width, &ints) };
                    match out {
                        LpOut::Optimal(v, _) => {
                            let x: Vec<f64> = (0..n).map(|i| if free { v[i] - v[n + i] } else { v[i] }).collect();
                            let method = if ints.is_empty() { "Simplex LP" } else { "Simplex LP with branch and bound" };
                            lin_model = Some(LinModel { lp: lp.clone(), n, free, sign, ncons: p.cons.len(), exact: ints.is_empty() && p.mode != "value" });
                            result = Some((x, method.to_string(), "Solver found a solution. All constraints and optimality conditions are satisfied.".to_string()));
                        }
                        LpOut::Infeasible => message = "Solver could not find a feasible solution.".to_string(),
                        LpOut::Unbounded => message = "The Objective Cell values do not converge.".to_string(),
                    }
                }
            }
        }
        if result.is_none() && message.is_empty() {
            let _ = linear;
            let sign = if p.mode == "max" { -1.0 } else { 1.0 };
            let round = |p: &Problem, x: &[f64]| -> Vec<f64> { x.iter().enumerate().map(|(i, v)| if p.int[i] { v.round() } else { *v }).collect() };
            let mut best: Option<(Vec<f64>, f64, f64)> = None;
            let starts: Vec<Vec<f64>> = vec![orig.iter().map(|v| if p.nonneg { v.max(0.0) } else { *v }).collect(), orig.iter().enumerate().map(|(i, v)| v.abs() * 0.5 + 1.0 + i as f64 * 0.1).collect()];
            let cell = std::cell::RefCell::new(&mut *self);
            for start in starts {
                let mut cur = start;
                for w in [10.0, 1e3, 1e5, 1e7] {
                    let f = |x: &[f64]| -> f64 {
                        let xr = round(&p, x);
                        let mut wb = cell.borrow_mut();
                        match wb.sample(&p, &xr) {
                            None => 1e30,
                            Some(s) => {
                                let o = if p.mode == "value" { (s.obj - p.target).abs() } else { sign * s.obj };
                                o + w * Workbook::violation(&p, &s, &xr)
                            }
                        }
                    };
                    let (x, _) = stats::nelder_mead(&f, &cur, 0.3, 900);
                    cur = x;
                }
                let xr = round(&p, &cur);
                let mut wb = cell.borrow_mut();
                if let Some(s) = wb.sample(&p, &xr) {
                    let viol = Workbook::violation(&p, &s, &xr);
                    let o = if p.mode == "value" { (s.obj - p.target).abs() } else { sign * s.obj };
                    let better = match &best {
                        None => true,
                        Some((_, bo, bv)) => (viol <= TOL && (*bv > TOL || o < *bo)) || (viol > TOL && *bv > TOL && viol < *bv),
                    };
                    if better {
                        best = Some((xr, o, viol));
                    }
                }
            }
            drop(cell);
            match best {
                Some((x, _, viol)) if viol <= TOL * 10.0 => {
                    result = Some((x, "Nelder-Mead (derivative free)".to_string(), "Solver converged to a solution with the derivative-free search; it is a local optimum and the constraints are satisfied.".to_string()));
                }
                _ => message = "Solver could not find a feasible solution.".to_string(),
            }
        }
        for (k, raw) in &orig_raw {
            self.set_raw(k.0, k.1, raw);
        }
        let seeds: Vec<Key> = p.vars.clone();
        self.recalc(&seeds);
        let Some((x, method, msg)) = result else {
            self.whatif.last = None;
            return Ok(format!("fail\t{}\t\t{}", message, if obj_orig.is_some() { "" } else { "" }));
        };
        let mut sheets: Vec<usize> = p.vars.iter().map(|k| k.0).collect();
        sheets.sort_unstable();
        sheets.dedup();
        let mark = self.undo_mark();
        for s in sheets {
            let edits: Vec<(Addr, String)> = p.vars.iter().zip(&x).filter(|(k, _)| k.0 == s).map(|(k, v)| (k.1, num_raw(clean(*v)))).collect();
            self.put_all(s, &edits, fx)?;
        }
        self.undo_group(mark);
        let final_obj = self.numval(p.obj).unwrap_or(f64::NAN);
        let mut cons = Vec::new();
        for c in &p.cons {
            let value = self.numval(c.lhs).unwrap_or(f64::NAN);
            let rhs = match c.rhs {
                Some(k) => self.numval(k).unwrap_or(f64::NAN),
                None => c.rhs_num,
            };
            cons.push(ConRow { key: c.lhs, text: c.text.clone(), value, rhs, op: c.op.clone() });
        }
        self.whatif.last = Some(Run {
            vars: p.vars.iter().zip(orig.iter().zip(&x)).map(|(k, (o, f))| (*k, *o, clean(*f))).collect(),
            objective: Some((p.obj, obj_orig.unwrap_or(f64::NAN), final_obj)),
            mode: p.mode.clone(),
            target: p.target,
            cons,
            method: method.clone(),
            message: msg.clone(),
            problem: Some(p.clone()),
            lin: lin_model,
            x: x.iter().map(|v| clean(*v)).collect(),
        });
        Ok(format!("ok\t{}\t{}\t{}", msg, fnum(final_obj), method))
    }

    pub(super) fn solve_report(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let dst = self.dst_of(&a[0])?;
        let Some(run) = self.whatif.last.clone() else {
            return Err("Run Solver first; the report describes the last solution.".to_string());
        };
        match a.get(1).map(String::as_str) {
            Some("sensitivity") => return self.sens_report(dst, &run, fx),
            Some("limits") => return self.limits_report(dst, &run, fx),
            _ => {}
        }
        let name_of = |wb: &Workbook, k: Key| -> String {
            let left = if k.1.col > 0 { wb.val((k.0, Addr { row: k.1.row, col: k.1.col - 1 })) } else { Value::Empty };
            let up = if k.1.row > 0 { wb.val((k.0, Addr { row: k.1.row - 1, col: k.1.col })) } else { Value::Empty };
            let mut parts = Vec::new();
            if let Value::Text(t) = up {
                parts.push(t);
            }
            if let Value::Text(t) = left {
                parts.push(t);
            }
            parts.join(" ")
        };
        let sheet_name = |wb: &Workbook, k: Key| format!("{}!${}${}", wb.sheets[k.0].name, crate::col_name(k.1.col), k.1.row + 1);
        let mut out = Vec::new();
        put(&mut out, 0, 0, "FormCel Solver Answer Report");
        put(&mut out, 1, 0, "Result: ".to_string() + &run.message);
        put(&mut out, 2, 0, "Solver Engine: ".to_string() + &run.method);
        let mut r = 4u32;
        let sense = match run.mode.as_str() {
            "max" => "Max".to_string(),
            "min" => "Min".to_string(),
            _ => format!("Value Of {}", fnum(run.target)),
        };
        put(&mut out, r, 0, format!("Objective Cell ({sense})"));
        r += 1;
        for (i, h) in ["Cell", "Name", "Original Value", "Final Value"].iter().enumerate() {
            put(&mut out, r, i as u32, *h);
        }
        r += 1;
        if let Some((k, o, f)) = run.objective {
            put(&mut out, r, 0, sheet_name(self, k));
            put(&mut out, r, 1, name_of(self, k));
            put(&mut out, r, 2, fnum(o));
            put(&mut out, r, 3, fnum(f));
            r += 1;
        }
        r += 1;
        put(&mut out, r, 0, "Variable Cells");
        r += 1;
        for (i, h) in ["Cell", "Name", "Original Value", "Final Value"].iter().enumerate() {
            put(&mut out, r, i as u32, *h);
        }
        r += 1;
        for (k, o, f) in &run.vars {
            put(&mut out, r, 0, sheet_name(self, *k));
            put(&mut out, r, 1, name_of(self, *k));
            put(&mut out, r, 2, fnum(*o));
            put(&mut out, r, 3, fnum(*f));
            r += 1;
        }
        r += 1;
        put(&mut out, r, 0, "Constraints");
        r += 1;
        for (i, h) in ["Cell", "Name", "Cell Value", "Formula", "Status", "Slack"].iter().enumerate() {
            put(&mut out, r, i as u32, *h);
        }
        r += 1;
        for c in &run.cons {
            let slack = match c.op.as_str() {
                "<=" => c.rhs - c.value,
                ">=" => c.value - c.rhs,
                _ => 0.0,
            };
            put(&mut out, r, 0, sheet_name(self, c.key));
            put(&mut out, r, 1, name_of(self, c.key));
            put(&mut out, r, 2, fnum(c.value));
            put(&mut out, r, 3, c.text.clone());
            put(&mut out, r, 4, if slack.abs() < 1e-6 { "Binding" } else { "Not Binding" });
            put(&mut out, r, 5, fnum(clean(slack)));
            r += 1;
        }
        self.put_all(dst, &out, fx)?;
        Ok("ok".to_string())
    }
}

fn clean(v: f64) -> f64 {
    let r = v.round();
    if (v - r).abs() < 1e-9 * (1.0 + v.abs()) {
        r
    } else {
        v
    }
}
