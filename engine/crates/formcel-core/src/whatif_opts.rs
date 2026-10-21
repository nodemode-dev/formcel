use super::*;
use std::cell::{Cell, RefCell};

#[derive(Clone, Debug)]
pub(super) struct Opts {
    pub engine: String,
    pub precision: f64,
    pub scaling: bool,
    pub show: bool,
    pub max_time: f64,
    pub max_iter: usize,
    pub int_gap: f64,
    pub max_sub: usize,
    pub convergence: f64,
    pub multistart: bool,
    pub pop: usize,
    pub mutation: f64,
    pub seed: u64,
    pub require_bounds: bool,
    pub no_improve: f64,
    pub trial: usize,
}

impl Default for Opts {
    fn default() -> Opts {
        Opts {
            engine: "auto".to_string(),
            precision: 1e-6,
            scaling: true,
            show: false,
            max_time: 100.0,
            max_iter: 100,
            int_gap: 0.01,
            max_sub: 4000,
            convergence: 1e-4,
            multistart: false,
            pop: 100,
            mutation: 0.075,
            seed: 0,
            require_bounds: true,
            no_improve: 30.0,
            trial: 0,
        }
    }
}

impl Opts {
    pub(super) fn parse(&mut self, pairs: &[&str]) -> Result<(), String> {
        for kv in pairs {
            let Some((k, v)) = kv.split_once('=') else { continue };
            let (k, v) = (k.trim(), v.trim());
            if v.is_empty() {
                continue;
            }
            let num = || -> Result<f64, String> { v.parse::<f64>().map_err(|_| format!("The option value {v} is not a number.")) };
            let flag = v != "0";
            match k {
                "eng" => self.engine = v.to_string(),
                "pre" => {
                    let n = num()?;
                    if !(n > 0.0 && n < 1.0) {
                        return Err("Constraint Precision must be a number above 0 and below 1.".to_string());
                    }
                    self.precision = n;
                }
                "scl" => self.scaling = flag,
                "sho" => self.show = flag,
                "tim" => {
                    let n = num()?;
                    if n <= 0.0 {
                        return Err("Max Time must be a positive number of seconds.".to_string());
                    }
                    self.max_time = n;
                }
                "itr" => {
                    let n = num()?;
                    if n < 1.0 || n.fract() != 0.0 {
                        return Err("Iterations must be a whole number of at least 1.".to_string());
                    }
                    self.max_iter = n as usize;
                }
                "tol" => {
                    let n = num()?;
                    if !(0.0..=100.0).contains(&n) {
                        return Err("Integer Optimality must be a percentage from 0 to 100.".to_string());
                    }
                    self.int_gap = n / 100.0;
                }
                "sub" => {
                    let n = num()?;
                    if n < 1.0 {
                        return Err("Max Subproblems must be at least 1.".to_string());
                    }
                    self.max_sub = n as usize;
                }
                "cvg" => {
                    let n = num()?;
                    if !(n > 0.0 && n < 1.0) {
                        return Err("Convergence must be a number above 0 and below 1.".to_string());
                    }
                    self.convergence = n;
                }
                "ms" => self.multistart = flag,
                "pop" => {
                    let n = num()?;
                    if n < 10.0 || n > 10_000.0 || n.fract() != 0.0 {
                        return Err("Population Size must be a whole number from 10 to 10000.".to_string());
                    }
                    self.pop = n as usize;
                }
                "mut" => {
                    let n = num()?;
                    if !(0.0..=1.0).contains(&n) {
                        return Err("Mutation Rate must be a number from 0 to 1.".to_string());
                    }
                    self.mutation = n;
                }
                "seed" => {
                    let n = num()?;
                    if n < 0.0 || n.fract() != 0.0 {
                        return Err("Random Seed must be a whole number, 0 or more.".to_string());
                    }
                    self.seed = n as u64;
                }
                "rb" => self.require_bounds = flag,
                "nimp" => {
                    let n = num()?;
                    if n <= 0.0 {
                        return Err("Max Time Without Improvement must be a positive number of seconds.".to_string());
                    }
                    self.no_improve = n;
                }
                "trial" => self.trial = num()?.max(0.0) as usize,
                _ => {}
            }
        }
        Ok(())
    }

    pub(super) fn iterations(&self) -> usize {
        if self.trial > 0 {
            self.trial.min(self.max_iter)
        } else {
            self.max_iter
        }
    }

    pub(super) fn budget(&self) -> usize {
        (self.max_time * 500.0) as usize
    }
}

struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Lcg {
        let mut r = Lcg(seed ^ 0x9E37_79B9_7F4A_7C15);
        for _ in 0..8 {
            r.next();
        }
        r
    }

    fn next(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        ((x.wrapping_mul(0x2545_F491_4F6C_DD1D)) >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, n: usize) -> usize {
        ((self.next() * n as f64) as usize).min(n.saturating_sub(1))
    }

    fn normal(&mut self) -> f64 {
        let (u, v) = (self.next().max(1e-300), self.next());
        (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
    }
}

pub(super) type Scored = (f64, f64);

fn better(a: Scored, b: Scored, tol: f64) -> bool {
    match (a.1 <= tol, b.1 <= tol) {
        (true, true) => a.0 < b.0,
        (true, false) => true,
        (false, true) => false,
        _ => a.1 < b.1,
    }
}

fn snap(p: &Problem, x: &[f64]) -> Vec<f64> {
    x.iter().enumerate().map(|(i, v)| if p.int[i] { v.round() } else { *v }).collect()
}

impl Workbook {
    pub(super) fn solve_scenario(&mut self, a: &[String]) -> Result<String, String> {
        let Some(run) = self.whatif.last.clone() else {
            return Err("Run Solver first; the scenario holds its solution.".to_string());
        };
        let sheet = self.sheet_of(&a[0])?;
        let mut args = vec![a[1].clone(), "Saved by Solver".to_string(), sheet.to_string()];
        for (k, _, f) in &run.vars {
            if k.0 == sheet {
                args.push(to_a1(k.1));
                args.push(num_raw(*f));
            }
        }
        self.sc_set(&args)
    }

    pub(super) fn bounds_of(&self, p: &Problem) -> (Vec<f64>, Vec<f64>) {
        let n = p.vars.len();
        let mut lo = vec![f64::NEG_INFINITY; n];
        let mut hi = vec![f64::INFINITY; n];
        let mut set_lo = vec![false; n];
        for c in &p.cons {
            let Some(i) = p.vars.iter().position(|v| *v == c.lhs) else { continue };
            let r = match c.rhs {
                Some(k) => match self.numval(k) {
                    Some(v) => v,
                    None => continue,
                },
                None => c.rhs_num,
            };
            match c.op.as_str() {
                "<=" => hi[i] = hi[i].min(r),
                ">=" => {
                    lo[i] = if set_lo[i] { lo[i].max(r) } else { r };
                    set_lo[i] = true;
                }
                _ => {
                    lo[i] = r;
                    hi[i] = r;
                    set_lo[i] = true;
                }
            }
        }
        for i in 0..n {
            if !set_lo[i] && p.nonneg {
                lo[i] = 0.0;
            }
            if p.bin[i] {
                lo[i] = lo[i].max(0.0);
                hi[i] = hi[i].min(1.0);
            }
        }
        (lo, hi)
    }

    pub(super) fn needs_bounds(&self, p: &Problem, what: &str) -> Result<(), String> {
        if !p.opts.require_bounds {
            return Ok(());
        }
        let (lo, hi) = self.bounds_of(p);
        let in_dif: Vec<usize> = p.dif.iter().flatten().copied().collect();
        for i in 0..p.vars.len() {
            if in_dif.contains(&i) {
                continue;
            }
            if !(lo[i].is_finite() && hi[i].is_finite()) {
                return Err(format!("{what} needs both an upper and a lower bound on every variable cell, and {} has none. Add the bounds as constraints, or clear Require Bounds on Variable Cells.", to_a1(p.vars[i].1)));
            }
        }
        Ok(())
    }

    fn score(&mut self, p: &Problem, x: &[f64]) -> Scored {
        let sign = if p.mode == "max" { -1.0 } else { 1.0 };
        match self.sample(p, x) {
            None => (1e30, 1e30),
            Some(s) => {
                let o = if p.mode == "value" { (s.obj - p.target).abs() } else { sign * s.obj };
                (o, Workbook::violation(p, &s, x))
            }
        }
    }

    fn nm_stages(&mut self, p: &Problem, start: &[f64], scale: &[f64], weights: &[f64], iters: usize, spent: &Cell<usize>, cap: usize) -> Vec<f64> {
        let sign = if p.mode == "max" { -1.0 } else { 1.0 };
        let cell = RefCell::new(&mut *self);
        let mut cur: Vec<f64> = start.iter().zip(scale).map(|(x, s)| x / s).collect();
        for w in weights {
            let f = |y: &[f64]| -> f64 {
                if spent.get() >= cap {
                    return 1e30;
                }
                spent.set(spent.get() + 1);
                let xr = snap(p, &y.iter().zip(scale).map(|(v, s)| v * s).collect::<Vec<_>>());
                let mut wb = cell.borrow_mut();
                match wb.sample(p, &xr) {
                    None => 1e30,
                    Some(s) => {
                        let o = if p.mode == "value" { (s.obj - p.target).abs() } else { sign * s.obj };
                        o + w * Workbook::violation(p, &s, &xr)
                    }
                }
            };
            let mut prev = f64::INFINITY;
            for _ in 0..6 {
                let (x, v) = stats::nelder_mead(&f, &cur, 0.3, iters);
                cur = x;
                if (prev - v).abs() <= 1e-10 * (1.0 + v.abs()) {
                    break;
                }
                prev = v;
            }
        }
        snap(p, &cur.iter().zip(scale).map(|(v, s)| v * s).collect::<Vec<_>>())
    }

    fn seed_of(p: &Problem, start: &[f64]) -> u64 {
        if p.opts.seed > 0 {
            return p.opts.seed;
        }
        let mut h: u64 = 1_469_598_103_934_665_603;
        for v in start.iter().chain([p.vars.len() as f64].iter()) {
            h ^= v.to_bits();
            h = h.wrapping_mul(1_099_511_628_211);
        }
        h | 1
    }

    pub(super) fn nonlinear(&mut self, p: &Problem, orig: &[f64], trace: &mut Vec<String>) -> Result<Option<(Vec<f64>, Scored)>, String> {
        let o = &p.opts;
        let n = p.vars.len();
        let scale: Vec<f64> = (0..n).map(|i| if o.scaling { orig[i].abs().max(1.0) } else { 1.0 }).collect();
        let iters = o.iterations() * 9;
        let cap = o.budget();
        let spent = Cell::new(0usize);
        let tol = o.precision * 10.0;
        let (lo, hi) = self.bounds_of(p);
        let mut starts: Vec<Vec<f64>> = vec![orig.iter().map(|v| if p.nonneg { v.max(0.0) } else { *v }).collect(), orig.iter().enumerate().map(|(i, v)| v.abs() * 0.5 + 1.0 + i as f64 * 0.1).collect()];
        let mut extra = 0;
        if o.multistart {
            self.needs_bounds(p, "Multistart")?;
            let mut rng = Lcg::new(Workbook::seed_of(p, orig));
            for _ in 0..o.pop {
                starts.push((0..n).map(|i| if lo[i].is_finite() && hi[i].is_finite() { lo[i] + rng.next() * (hi[i] - lo[i]) } else { orig[i] }).collect());
                extra += 1;
            }
        }
        let mut best: Option<(Vec<f64>, Scored)> = None;
        let total = starts.len();
        for (k, start) in starts.into_iter().enumerate() {
            if spent.get() >= cap {
                break;
            }
            let multi = k >= total - extra;
            let weights: &[f64] = if multi { &[1e3, 1e6] } else { &[10.0, 1e3, 1e5, 1e7] };
            let cur = self.nm_stages(p, &start, &scale, weights, if multi { iters.min(300) } else { iters }, &spent, cap);
            let sc = self.score(p, &cur);
            if best.as_ref().is_none_or(|b| better(sc, b.1, tol)) {
                best = Some((cur, sc));
                trace.push(format!("{}:{}", k + 1, fnum(clean(-sc.0 * if p.mode == "max" { 1.0 } else { -1.0 }))));
            }
        }
        if o.multistart {
            if let Some((x, sc)) = best.clone() {
                let polished = self.nm_stages(p, &x, &scale, &[1e5, 1e7], iters, &spent, cap.max(spent.get() + 5000));
                let ps = self.score(p, &polished);
                if better(ps, sc, tol) {
                    best = Some((polished, ps));
                }
            }
        }
        Ok(best.filter(|b| b.1 .1 <= tol))
    }

    pub(super) fn evolve(&mut self, p: &Problem, start: &[f64], trace: &mut Vec<String>) -> Result<Option<(Vec<f64>, Scored, usize)>, String> {
        let o = &p.opts;
        let n = p.vars.len();
        self.needs_bounds(p, "The Evolutionary engine")?;
        let (lo, hi) = self.bounds_of(p);
        let tol = o.precision * 10.0;
        let mut rng = Lcg::new(Workbook::seed_of(p, start));
        let mut dif_of: Vec<Option<usize>> = vec![None; n];
        for (g, grp) in p.dif.iter().enumerate() {
            for i in grp {
                dif_of[*i] = Some(g);
            }
        }
        let width = |i: usize| -> (f64, f64) {
            let w = 10.0 * (start[i].abs() + 1.0);
            (if lo[i].is_finite() { lo[i] } else { start[i] - w }, if hi[i].is_finite() { hi[i] } else { start[i] + w })
        };
        let base_of = |g: usize| -> f64 { lo[p.dif[g][0]].max(if lo[p.dif[g][0]].is_finite() { lo[p.dif[g][0]] } else { 1.0 }) };
        let fix = |i: usize, v: f64| -> f64 {
            let (a, b) = width(i);
            let c = v.clamp(a, b);
            if p.int[i] {
                c.round().clamp(a.ceil(), b.floor().max(a.ceil()))
            } else {
                c
            }
        };
        let fresh = |rng: &mut Lcg| -> Vec<f64> {
            let mut x = vec![0.0; n];
            for i in 0..n {
                if dif_of[i].is_none() {
                    let (a, b) = width(i);
                    x[i] = fix(i, a + rng.next() * (b - a));
                }
            }
            for (g, grp) in p.dif.iter().enumerate() {
                let mut vals: Vec<f64> = (0..grp.len()).map(|k| base_of(g) + k as f64).collect();
                for k in (1..vals.len()).rev() {
                    vals.swap(k, rng.below(k + 1));
                }
                for (k, i) in grp.iter().enumerate() {
                    x[*i] = vals[k];
                }
            }
            x
        };
        let popn = o.pop;
        let mut pop: Vec<(Vec<f64>, Scored)> = Vec::with_capacity(popn);
        let mut seeded: Vec<f64> = (0..n).map(|i| if dif_of[i].is_some() { 0.0 } else { fix(i, start[i]) }).collect();
        for (g, grp) in p.dif.iter().enumerate() {
            for (k, i) in grp.iter().enumerate() {
                seeded[*i] = base_of(g) + k as f64;
            }
        }
        let sc = self.score(p, &seeded);
        pop.push((seeded, sc));
        let mut evals = 1usize;
        while pop.len() < popn {
            let x = fresh(&mut rng);
            let sc = self.score(p, &x);
            evals += 1;
            pop.push((x, sc));
        }
        let cap = o.budget();
        let max_gen = if o.trial > 0 { o.trial } else { 2000 };
        let stall_limit = ((o.no_improve * 5.0) as usize).max(30);
        let mut history: Vec<f64> = Vec::new();
        let mut since = 0usize;
        let mut gens = 0usize;
        let elite = (popn / 10).max(1);
        let sort = |pop: &mut Vec<(Vec<f64>, Scored)>| pop.sort_by(|a, b| if better(a.1, b.1, tol) { std::cmp::Ordering::Less } else if better(b.1, a.1, tol) { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal });
        sort(&mut pop);
        let mut last_best = pop[0].1;
        let mut dif_active: Vec<(usize, usize)> = Vec::new();
        for (g, grp) in p.dif.iter().enumerate() {
            dif_active.push((g, grp.len()));
        }
        while gens < max_gen && evals < cap {
            gens += 1;
            let mut next: Vec<(Vec<f64>, Scored)> = pop[..elite].to_vec();
            let shrink = 1.0 - 0.8 * (gens as f64 / 400.0).min(1.0);
            while next.len() < popn {
                let pick = |rng: &mut Lcg| -> usize {
                    let mut b = rng.below(popn);
                    for _ in 0..2 {
                        let c = rng.below(popn);
                        if c < b {
                            b = c;
                        }
                    }
                    b
                };
                let (a, b) = (pick(&mut rng), pick(&mut rng));
                let mut child = vec![0.0; n];
                for i in 0..n {
                    if dif_of[i].is_some() {
                        continue;
                    }
                    let (pa, pb) = (pop[a].0[i], pop[b].0[i]);
                    let v = if rng.next() < 0.5 { pa } else { pa + (rng.next() * 1.5 - 0.25) * (pb - pa) };
                    let (l, h) = width(i);
                    let mutated = if rng.next() < o.mutation.max(0.01) * 2.0 { v + rng.normal() * 0.1 * (h - l) * shrink } else { v };
                    child[i] = fix(i, mutated);
                }
                for (g, grp) in p.dif.iter().enumerate() {
                    let src = if rng.next() < 0.5 { a } else { b };
                    for i in grp {
                        child[*i] = pop[src].0[*i];
                    }
                    if rng.next() < (o.mutation * grp.len() as f64).min(1.0).max(0.05) {
                        let (i, j) = (rng.below(grp.len()), rng.below(grp.len()));
                        child.swap(grp[i], grp[j]);
                    }
                    let _ = g;
                }
                let sc = self.score(p, &child);
                evals += 1;
                next.push((child, sc));
            }
            pop = next;
            sort(&mut pop);
            let b = pop[0].1;
            if better(b, last_best, tol) && (b.0 < last_best.0 - 1e-12 || b.1 < last_best.1 - 1e-12 || last_best.1 > tol) {
                since = 0;
            } else {
                since += 1;
            }
            last_best = b;
            if b.1 <= tol {
                history.push(b.0);
            }
            if gens % 5 == 0 || gens <= 3 {
                let shown = if p.mode == "max" { -b.0 } else { b.0 };
                trace.push(format!("{}:{}", gens, fnum(clean(shown))));
            }
            if history.len() > 25 {
                let (old, new) = (history[history.len() - 26], history[history.len() - 1]);
                if (old - new).abs() <= o.convergence * (1.0 + new.abs()) && since >= 10 {
                    break;
                }
            }
            if since >= stall_limit {
                break;
            }
        }
        let (mut x, mut sc) = pop[0].clone();
        if p.dif.is_empty() && o.trial == 0 && evals < cap {
            let scale: Vec<f64> = (0..n).map(|i| if o.scaling { x[i].abs().max(1.0) } else { 1.0 }).collect();
            let spent = Cell::new(0usize);
            let inner: Vec<f64> = x.iter().enumerate().map(|(i, v)| (v * 0.97).clamp(lo[i], hi[i])).collect();
            let polished = self.nm_stages(p, &inner, &scale, &[10.0, 1e3, 1e5, 1e7], 600, &spent, 40_000);
            let ps = self.score(p, &polished);
            if better(ps, sc, tol) {
                x = polished;
                sc = ps;
            }
        }
        Ok(if sc.1 <= tol { Some((x, sc, gens)) } else { None })
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
