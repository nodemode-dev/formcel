use crate::formula::Area;
use crate::wire::{escape, unescape};
use crate::{parse_a1, stats, to_a1, Addr, Effect, Tx, Value, Workbook};

type Key = (usize, Addr);
type Reply = Result<String, String>;

#[derive(Clone, Debug, Default)]
pub struct State {
    pub tables: Vec<DataTable>,
    pub scenarios: Vec<Scenario>,
    pub models: Vec<(usize, String)>,
    pub last: Option<Run>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DataTable {
    pub sheet: usize,
    pub area: Area,
    pub row_in: Option<Addr>,
    pub col_in: Option<Addr>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Scenario {
    pub name: String,
    pub comment: String,
    pub sheet: usize,
    pub cells: Vec<(Addr, String)>,
}

#[derive(Clone, Debug, Default)]
pub struct Run {
    vars: Vec<(Key, f64, f64)>,
    objective: Option<(Key, f64, f64)>,
    mode: String,
    target: f64,
    cons: Vec<ConRow>,
    method: String,
    message: String,
    problem: Option<Problem>,
    lin: Option<LinModel>,
    x: Vec<f64>,
    trace: Vec<String>,
    iterations: usize,
}

#[derive(Clone, Debug)]
struct LinModel {
    lp: Lp,
    n: usize,
    free: bool,
    sign: f64,
    ncons: usize,
    exact: bool,
}

#[derive(Clone, Debug)]
struct ConRow {
    key: Key,
    text: String,
    value: f64,
    rhs: f64,
    op: String,
}

fn args(cmd: &str) -> Vec<String> {
    cmd.split('\t').map(unescape).collect()
}

fn num_raw(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn value_raw(v: &Value) -> String {
    match v {
        Value::Number(n) => num_raw(*n),
        Value::Empty => String::new(),
        o => o.to_string(),
    }
}

fn pnum(s: &str) -> Result<f64, String> {
    s.trim().parse::<f64>().map_err(|_| format!("{} is not a number.", s.trim()))
}

fn area_norm(a: Addr, b: Addr) -> Area {
    Area { r0: a.row.min(b.row), c0: a.col.min(b.col), r1: a.row.max(b.row), c1: a.col.max(b.col) }
}

fn cells_of(a: Area) -> Vec<Addr> {
    let mut out = Vec::new();
    for r in a.r0..=a.r1 {
        for c in a.c0..=a.c1 {
            out.push(Addr { row: r, col: c });
        }
    }
    out
}

fn put(out: &mut Vec<(Addr, String)>, r: u32, c: u32, raw: impl Into<String>) {
    out.push((Addr { row: r, col: c }, raw.into()));
}

fn fnum(n: f64) -> String {
    if n.is_nan() {
        "#N/A".to_string()
    } else if n.is_infinite() {
        "#NUM!".to_string()
    } else {
        num_raw(n)
    }
}

impl State {
    pub fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        for t in &self.tables {
            let side = |a: Option<Addr>| a.map(to_a1).unwrap_or_default();
            out.push(format!("dt\t{}\t{}\t{}\t{}\t{}\t{}\t{}", t.sheet, t.area.r0, t.area.c0, t.area.r1, t.area.c1, side(t.row_in), side(t.col_in)));
        }
        for s in &self.scenarios {
            let mut l = String::from("sc\t");
            for (i, p) in [s.name.clone(), s.comment.clone(), s.sheet.to_string()].iter().enumerate() {
                if i > 0 {
                    l.push('\t');
                }
                escape(p, &mut l);
            }
            for (a, raw) in &s.cells {
                l.push('\t');
                l.push_str(&to_a1(*a));
                l.push('\t');
                escape(raw, &mut l);
            }
            out.push(l);
        }
        for (sheet, text) in &self.models {
            let mut l = format!("sv\t{sheet}\t");
            escape(text, &mut l);
            out.push(l);
        }
        out
    }

    pub fn from_lines(lines: &[String]) -> State {
        let mut st = State::default();
        for l in lines {
            let p: Vec<&str> = l.split('\t').collect();
            match p.first().copied() {
                Some("dt") if p.len() >= 8 => {
                    let n = |i: usize| p[i].parse::<u32>().ok();
                    if let (Some(s), Some(r0), Some(c0), Some(r1), Some(c1)) = (p[1].parse::<usize>().ok(), n(2), n(3), n(4), n(5)) {
                        st.tables.push(DataTable { sheet: s, area: Area { r0, c0, r1, c1 }, row_in: parse_a1(p[6]).ok(), col_in: parse_a1(p[7]).ok() });
                    }
                }
                Some("sc") if p.len() >= 4 => {
                    let mut cells = Vec::new();
                    let mut i = 4;
                    while i + 1 < p.len() {
                        if let Ok(a) = parse_a1(p[i]) {
                            cells.push((a, unescape(p[i + 1])));
                        }
                        i += 2;
                    }
                    st.scenarios.push(Scenario { name: unescape(p[1]), comment: unescape(p[2]), sheet: p[3].parse().unwrap_or(0), cells });
                }
                Some("sv") if p.len() >= 3 => {
                    if let Ok(s) = p[1].parse::<usize>() {
                        st.models.push((s, unescape(p[2])));
                    }
                }
                _ => {}
            }
        }
        st
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Rel {
    Le,
    Ge,
    Eq,
}

#[derive(Clone, Debug)]
struct Lp {
    c: Vec<f64>,
    rows: Vec<(Vec<f64>, Rel, f64)>,
}

enum LpOut {
    Optimal(Vec<f64>, f64),
    Infeasible,
    Unbounded,
}

fn pivot(t: &mut [Vec<f64>], r: usize, c: usize) {
    let d = t[r][c];
    for v in t[r].iter_mut() {
        *v /= d;
    }
    let pr = t[r].clone();
    for (i, row) in t.iter_mut().enumerate() {
        if i != r {
            let f = row[c];
            if f != 0.0 {
                for (v, p) in row.iter_mut().zip(&pr) {
                    *v -= f * p;
                }
            }
        }
    }
}

fn simplex(t: &mut [Vec<f64>], basis: &mut [usize], cost: &[f64], allowed: usize) -> bool {
    let rhs = t[0].len() - 1;
    for _ in 0..20_000 {
        let mut enter = None;
        for j in 0..allowed {
            if basis.contains(&j) {
                continue;
            }
            let z = cost[j] - basis.iter().enumerate().map(|(i, b)| cost[*b] * t[i][j]).sum::<f64>();
            if z < -1e-9 {
                enter = Some(j);
                break;
            }
        }
        let Some(j) = enter else { return true };
        let mut best: Option<(f64, usize)> = None;
        for i in 0..t.len() {
            if t[i][j] > 1e-9 {
                let r = t[i][rhs] / t[i][j];
                if best.is_none_or(|(br, bi)| r < br - 1e-12 || (r < br + 1e-12 && basis[i] < basis[bi])) {
                    best = Some((r, i));
                }
            }
        }
        let Some((_, i)) = best else { return false };
        pivot(t, i, j);
        basis[i] = j;
    }
    true
}

fn lp_solve(p: &Lp, n: usize) -> LpOut {
    let m = p.rows.len();
    let mut rows: Vec<(Vec<f64>, Rel, f64)> = p.rows.clone();
    for r in rows.iter_mut() {
        if r.2 < 0.0 {
            for v in r.0.iter_mut() {
                *v = -*v;
            }
            r.2 = -r.2;
            r.1 = match r.1 {
                Rel::Le => Rel::Ge,
                Rel::Ge => Rel::Le,
                Rel::Eq => Rel::Eq,
            };
        }
    }
    let slacks = rows.iter().filter(|r| r.1 != Rel::Eq).count();
    let arts = rows.iter().filter(|r| r.1 != Rel::Le).count();
    let cols = n + slacks + arts;
    let mut t = vec![vec![0.0; cols + 1]; m];
    let mut basis = vec![0usize; m];
    let (mut si, mut ai) = (n, n + slacks);
    for (i, r) in rows.iter().enumerate() {
        t[i][..n].copy_from_slice(&r.0);
        t[i][cols] = r.2;
        match r.1 {
            Rel::Le => {
                t[i][si] = 1.0;
                basis[i] = si;
                si += 1;
            }
            Rel::Ge => {
                t[i][si] = -1.0;
                si += 1;
                t[i][ai] = 1.0;
                basis[i] = ai;
                ai += 1;
            }
            Rel::Eq => {
                t[i][ai] = 1.0;
                basis[i] = ai;
                ai += 1;
            }
        }
    }
    if arts > 0 {
        let mut c1 = vec![0.0; cols];
        for v in c1.iter_mut().skip(n + slacks) {
            *v = 1.0;
        }
        simplex(&mut t, &mut basis, &c1, cols);
        let infeas: f64 = basis.iter().enumerate().filter(|(_, b)| **b >= n + slacks).map(|(i, _)| t[i][cols]).sum();
        if infeas > 1e-7 {
            return LpOut::Infeasible;
        }
        for i in 0..m {
            if basis[i] >= n + slacks {
                if let Some(j) = (0..n + slacks).find(|j| t[i][*j].abs() > 1e-9 && !basis.contains(j)) {
                    pivot(&mut t, i, j);
                    basis[i] = j;
                }
            }
        }
    }
    let mut c2 = vec![0.0; cols];
    c2[..n].copy_from_slice(&p.c);
    if !simplex(&mut t, &mut basis, &c2, n + slacks) {
        return LpOut::Unbounded;
    }
    let mut x = vec![0.0; n];
    for (i, b) in basis.iter().enumerate() {
        if *b < n {
            x[*b] = t[i][cols];
        }
    }
    let obj = p.c.iter().zip(&x).map(|(a, b)| a * b).sum();
    LpOut::Optimal(x, obj)
}

fn milp_with(p: &Lp, n: usize, ints: &[usize], gap: f64, max_nodes: usize) -> LpOut {
    let mut best: Option<(Vec<f64>, f64)> = None;
    let mut nodes = 0;
    let mut unbounded = false;
    let mut stack: Vec<Vec<(Vec<f64>, Rel, f64)>> = vec![Vec::new()];
    while let Some(extra) = stack.pop() {
        nodes += 1;
        if nodes > max_nodes {
            break;
        }
        let mut q = Lp { c: p.c.clone(), rows: p.rows.clone() };
        q.rows.extend(extra.iter().cloned());
        match lp_solve(&q, n) {
            LpOut::Infeasible => continue,
            LpOut::Unbounded => {
                unbounded = true;
                break;
            }
            LpOut::Optimal(x, obj) => {
                if best.as_ref().is_some_and(|b| obj >= b.1 - 1e-9 - gap * b.1.abs()) {
                    continue;
                }
                let frac = ints.iter().filter(|i| (x[**i] - x[**i].round()).abs() > 1e-6).max_by(|a, b| (x[**a] - x[**a].floor()).min(x[**a].ceil() - x[**a]).partial_cmp(&(x[**b] - x[**b].floor()).min(x[**b].ceil() - x[**b])).unwrap_or(std::cmp::Ordering::Equal));
                match frac {
                    None => best = Some((x, obj)),
                    Some(&i) => {
                        let mut unit = vec![0.0; n];
                        unit[i] = 1.0;
                        let mut up = extra.clone();
                        up.push((unit.clone(), Rel::Ge, x[i].ceil()));
                        let mut down = extra;
                        down.push((unit, Rel::Le, x[i].floor()));
                        stack.push(up);
                        stack.push(down);
                    }
                }
            }
        }
    }
    if unbounded {
        return LpOut::Unbounded;
    }
    match best {
        Some((x, o)) => LpOut::Optimal(x, o),
        None => LpOut::Infeasible,
    }
}

#[derive(Clone, Debug)]
struct Con {
    lhs: Key,
    op: String,
    rhs: Option<Key>,
    rhs_num: f64,
    text: String,
}

#[derive(Clone, Debug)]
struct Problem {
    obj: Key,
    mode: String,
    target: f64,
    vars: Vec<Key>,
    nonneg: bool,
    cons: Vec<Con>,
    int: Vec<bool>,
    bin: Vec<bool>,
    dif: Vec<Vec<usize>>,
    opts: opts::Opts,
}

struct Sample {
    obj: f64,
    gaps: Vec<(f64, f64, String)>,
}

impl Workbook {
    pub fn whatif_state(&self) -> Vec<String> {
        self.whatif.lines()
    }

    pub fn load_whatif(&mut self, lines: &[String]) {
        self.whatif = State::from_lines(lines);
    }

    pub(crate) fn whatif_replay(&mut self, lines: &[String]) {
        self.whatif = State::from_lines(lines);
    }

    fn state_change(&mut self, next: State) {
        let before = self.whatif.lines();
        let after = next.lines();
        self.whatif = next;
        if before != after {
            self.record(Tx::WhatIf { before, after });
        }
    }

    pub fn whatif_run(&mut self, cmd: &str) -> (String, Effect) {
        let a = args(cmd);
        let verb = a.first().cloned().unwrap_or_default();
        let mark = self.undo_mark();
        let mut fx = Effect::default();
        let r = self.whatif_verb(&verb, &a[1.min(a.len())..], &mut fx);
        self.undo_group(mark);
        let text = match r {
            Ok(t) => t,
            Err(m) => format!("error\t{m}"),
        };
        (text, fx)
    }

    fn sheet_of(&self, s: &str) -> Result<usize, String> {
        let i: usize = s.trim().parse().map_err(|_| "That sheet is not known.".to_string())?;
        if i >= self.sheets.len() {
            return Err("That sheet is not known.".to_string());
        }
        Ok(i)
    }

    fn dst_of(&self, s: &str) -> Result<usize, String> {
        if s.trim() == "-" {
            return Ok(usize::MAX);
        }
        self.sheet_of(s)
    }

    fn resolve(&self, s: &str, sheet: usize) -> Result<(usize, Area), String> {
        let (sh, rest) = match s.rfind('!') {
            Some(i) => {
                let n = s[..i].trim().trim_matches('\'').replace("''", "'");
                (self.sheet_by_name(&n).ok_or_else(|| format!("There is no sheet named {n}."))?, &s[i + 1..])
            }
            None => (sheet, s),
        };
        let mut it = rest.trim().split(':');
        let p = it.next().unwrap_or("");
        let a = parse_a1(p).map_err(|_| format!("{} is not a cell reference.", s.trim()))?;
        let b = match it.next() {
            Some(q) => parse_a1(q).map_err(|_| format!("{} is not a cell reference.", s.trim()))?,
            None => a,
        };
        Ok((sh, area_norm(a, b)))
    }

    fn one(&self, s: &str, sheet: usize) -> Result<Key, String> {
        let (sh, ar) = self.resolve(s, sheet)?;
        if ar.r0 != ar.r1 || ar.c0 != ar.c1 {
            return Err(format!("{} must be a single cell.", s.trim()));
        }
        Ok((sh, Addr { row: ar.r0, col: ar.c0 }))
    }

    fn val(&self, k: Key) -> Value {
        self.sheets.get(k.0).and_then(|s| s.cells.get(k.1)).cloned().unwrap_or(Value::Empty)
    }

    fn numval(&self, k: Key) -> Option<f64> {
        match self.val(k) {
            Value::Number(n) => Some(n),
            Value::Bool(b) => Some(f64::from(u8::from(b))),
            Value::Empty => Some(0.0),
            _ => None,
        }
    }

    fn block(&self, sheet: usize, a: Area) -> Vec<Vec<Value>> {
        (a.r0..=a.r1).map(|r| (a.c0..=a.c1).map(|c| self.val((sheet, Addr { row: r, col: c }))).collect()).collect()
    }

    fn put_all(&mut self, sheet: usize, edits: &[(Addr, String)], fx: &mut Effect) -> Result<(), String> {
        if sheet == usize::MAX {
            return Ok(());
        }
        let changed = self.apply(sheet, edits).map_err(|e| e.to_string())?;
        fx.cells.extend(changed);
        Ok(())
    }

    fn temp(&mut self, sets: &[(Key, String)]) {
        let seeds: Vec<Key> = sets.iter().map(|s| s.0).collect();
        for (k, raw) in sets {
            self.set_raw(k.0, k.1, raw);
        }
        self.recalc(&seeds);
    }

    fn whatif_verb(&mut self, verb: &str, a: &[String], fx: &mut Effect) -> Reply {
        let need = |n: usize| if a.len() < n { Err("The request was incomplete.".to_string()) } else { Ok(()) };
        match verb {
            "state" => Ok(self.whatif.lines().join("\n")),
            "inputs" => {
                need(2)?;
                let sheet = self.sheet_of(&a[0])?;
                let mut out = Vec::new();
                for r in a[1].split(',').filter(|s| !s.trim().is_empty()) {
                    let (sh, ar) = self.resolve(r, sheet)?;
                    for c in cells_of(ar) {
                        let mut l = to_a1(c);
                        l.push('\t');
                        escape(&self.input(sh, c), &mut l);
                        out.push(l);
                    }
                }
                Ok(out.join("\n"))
            }
            "goal" => {
                need(4)?;
                self.goal_seek(a, fx)
            }
            "dt.set" => {
                need(4)?;
                self.dt_set(a, fx)
            }
            "dt.list" => Ok(self.whatif.tables.iter().map(|t| format!("{}\t{}\t{}\t{}", t.sheet, to_a1(Addr { row: t.area.r0, col: t.area.c0 }) + ":" + &to_a1(Addr { row: t.area.r1, col: t.area.c1 }), t.row_in.map(to_a1).unwrap_or_default(), t.col_in.map(to_a1).unwrap_or_default())).collect::<Vec<_>>().join("\n")),
            "dt.remove" => {
                need(1)?;
                let i: usize = a[0].parse().map_err(|_| "No such data table.".to_string())?;
                let mut next = self.whatif.clone();
                if i >= next.tables.len() {
                    return Err("No such data table.".to_string());
                }
                next.tables.remove(i);
                self.state_change(next);
                Ok("ok".to_string())
            }
            "dt.run" => self.dt_refresh(fx),
            "sc.set" => {
                need(4)?;
                self.sc_set(a)
            }
            "sc.list" => Ok(self.whatif.scenarios.iter().map(|s| {
                let mut l = String::new();
                for (i, p) in [s.name.clone(), s.comment.clone(), s.sheet.to_string()].iter().enumerate() {
                    if i > 0 {
                        l.push('\t');
                    }
                    escape(p, &mut l);
                }
                for (ad, raw) in &s.cells {
                    l.push('\t');
                    l.push_str(&to_a1(*ad));
                    l.push('\t');
                    escape(raw, &mut l);
                }
                l
            }).collect::<Vec<_>>().join("\n")),
            "sc.show" => {
                need(1)?;
                let s = self.whatif.scenarios.iter().find(|s| s.name.eq_ignore_ascii_case(&a[0])).cloned().ok_or("There is no scenario with that name.")?;
                self.put_all(s.sheet, &s.cells, fx)?;
                Ok("ok".to_string())
            }
            "sc.delete" => {
                need(1)?;
                let mut next = self.whatif.clone();
                let n = next.scenarios.len();
                next.scenarios.retain(|s| !s.name.eq_ignore_ascii_case(&a[0]));
                if next.scenarios.len() == n {
                    return Err("There is no scenario with that name.".to_string());
                }
                self.state_change(next);
                Ok("ok".to_string())
            }
            "sc.summary" => {
                need(3)?;
                self.sc_summary(a, fx)
            }
            "sc.merge" => {
                need(2)?;
                let (from, to) = (self.sheet_of(&a[0])?, self.sheet_of(&a[1])?);
                let mut next = self.whatif.clone();
                let mut added = 0;
                for s in self.whatif.scenarios.iter().filter(|s| s.sheet == from) {
                    let mut name = s.name.clone();
                    let mut k = 2;
                    while next.scenarios.iter().any(|o| o.sheet == to && o.name.eq_ignore_ascii_case(&name)) {
                        name = format!("{} ({k})", s.name);
                        k += 1;
                    }
                    next.scenarios.push(Scenario { name, sheet: to, ..s.clone() });
                    added += 1;
                }
                if added == 0 {
                    return Err("That sheet has no scenarios to merge.".to_string());
                }
                self.state_change(next);
                Ok(format!("ok\t{added}"))
            }
            "sc.pivot" => {
                need(3)?;
                self.sc_pivot(a, fx)
            }
            "dt.at" => {
                need(2)?;
                let sheet = self.sheet_of(&a[0])?;
                let at = parse_a1(&a[1]).map_err(|_| "That is not a cell reference.".to_string())?;
                Ok(self.whatif.tables.iter().find(|t| t.sheet == sheet && at.row > t.area.r0 && at.row <= t.area.r1 && at.col > t.area.c0 && at.col <= t.area.c1).map_or(String::new(), |t| format!("{{=TABLE({},{})}}", t.row_in.map(to_a1).unwrap_or_default(), t.col_in.map(to_a1).unwrap_or_default())))
            }
            "solve" => {
                need(7)?;
                self.solve(a, fx)
            }
            "solve.scen" => {
                need(2)?;
                self.solve_scenario(a)
            }
            "solve.report" => {
                need(1)?;
                self.solve_report(a, fx)
            }
            "model.set" => {
                need(2)?;
                let s = self.sheet_of(&a[0])?;
                let mut next = self.whatif.clone();
                next.models.retain(|m| m.0 != s);
                if !a[1].is_empty() {
                    next.models.push((s, a[1].clone()));
                }
                self.state_change(next);
                Ok("ok".to_string())
            }
            "model.get" => {
                need(1)?;
                let s = self.sheet_of(&a[0])?;
                Ok(self.whatif.models.iter().find(|m| m.0 == s).map(|m| m.1.clone()).unwrap_or_default())
            }
            "fsheet" => {
                need(9)?;
                self.forecast_sheet(a, fx)
            }
            "desc" => {
                need(9)?;
                self.describe(a, fx)
            }
            "regress" => {
                need(9)?;
                self.regress(a, fx)
            }
            "explore" => {
                need(2)?;
                self.explore(a)
            }
            "tp" => {
                need(5)?;
                self.toolpak(&a[0], &a[1..], fx)
            }
            "ask" => {
                need(3)?;
                self.ask(a, fx)
            }
            "ask.fields" => {
                need(2)?;
                self.ask_fields(a)
            }
            "ask.pivot" => {
                need(6)?;
                self.ask_pivot(a, fx)
            }
            _ => Err("The engine does not know that request.".to_string()),
        }
    }

    fn goal_seek(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let sheet = self.sheet_of(&a[0])?;
        let set = self.one(&a[1], sheet)?;
        let target = pnum(&a[2])?;
        let change = self.one(&a[3], sheet)?;
        if !self.formulas.contains_key(&set) {
            return Err(format!("Cell {} does not contain a formula, so Goal Seek has nothing to solve.", to_a1(set.1)));
        }
        if self.formulas.contains_key(&change) {
            return Err(format!("Cell {} contains a formula. Goal Seek changes a cell that holds a value.", to_a1(change.1)));
        }
        let original = self.input(change.0, change.1);
        let x0 = match self.val(change) {
            Value::Number(n) => n,
            Value::Empty => 0.0,
            _ => return Err(format!("Cell {} holds text; Goal Seek needs a number there.", to_a1(change.1))),
        };
        let cap = a.get(4).and_then(|s| s.trim().parse::<u32>().ok()).filter(|n| *n > 0).unwrap_or(u32::MAX);
        let tol = a.get(5).and_then(|s| s.trim().parse::<f64>().ok()).filter(|t| *t > 0.0);
        let commit = a.get(6).is_none_or(|s| s != "preview");
        let mut iters = 0u32;
        let mut probe = |wb: &mut Workbook, x: f64| -> Option<f64> {
            if iters >= cap {
                return None;
            }
            iters += 1;
            wb.temp(&[(change, num_raw(x))]);
            match wb.val(set) {
                Value::Number(n) => Some(n - target),
                _ => None,
            }
        };
        let mut best: (f64, f64) = (x0, f64::INFINITY);
        let note = |x: f64, f: f64, best: &mut (f64, f64)| {
            if f.abs() < best.1 {
                *best = (x, f.abs());
            }
        };
        let f0 = probe(self, x0);
        if let Some(f) = f0 {
            note(x0, f, &mut best);
        }
        let mut bracket: Option<(f64, f64, f64, f64)> = None;
        if f0 == Some(0.0) {
            bracket = Some((x0, x0, 0.0, 0.0));
        }
        if bracket.is_none() {
            let delta = (x0.abs() * 0.01).max(0.01);
            let mut prev: Vec<(f64, f64)> = f0.map(|f| (x0, f)).into_iter().collect();
            for k in 0..80 {
                let step = delta * 2f64.powi(k);
                for x in [x0 + step, x0 - step] {
                    if let Some(f) = probe(self, x) {
                        note(x, f, &mut best);
                        if let Some(&(px, pf)) = prev.iter().find(|(_, pf)| pf.signum() != f.signum() && *pf != 0.0 && f != 0.0) {
                            bracket = Some((px, x, pf, f));
                            break;
                        }
                        if f == 0.0 {
                            bracket = Some((x, x, 0.0, 0.0));
                            break;
                        }
                        prev.push((x, f));
                    }
                }
                if bracket.is_some() || step > 1e15 {
                    break;
                }
            }
        }
        if let Some((mut lo, mut hi, mut flo, mut fhi)) = bracket {
            if lo != hi {
                let mut side = 0;
                for _ in 0..200 {
                    let mid = if (fhi - flo).abs() > 0.0 { (lo * fhi - hi * flo) / (fhi - flo) } else { (lo + hi) / 2.0 };
                    let mid = if mid.is_finite() && mid > lo.min(hi) && mid < lo.max(hi) { mid } else { (lo + hi) / 2.0 };
                    let Some(f) = probe(self, mid) else { break };
                    note(mid, f, &mut best);
                    if f.abs() <= 1e-12 * target.abs().max(1.0) || (hi - lo).abs() <= 1e-14 * mid.abs().max(1.0) {
                        break;
                    }
                    if f.signum() == flo.signum() {
                        lo = mid;
                        flo = f;
                        if side == -1 {
                            fhi /= 2.0;
                        }
                        side = -1;
                    } else {
                        hi = mid;
                        fhi = f;
                        if side == 1 {
                            flo /= 2.0;
                        }
                        side = 1;
                    }
                }
            }
        }
        self.set_raw(change.0, change.1, &original);
        self.recalc(&[change]);
        let ok = match tol {
            Some(t) => best.1 <= t,
            None => best.1 <= 1e-3 * target.abs().max(1.0).min(1e3) || best.1 <= 1e-3,
        };
        let status = if ok { "ok" } else if iters >= cap { "stop" } else { "fail" };
        let force = a.get(6).is_some_and(|s| s == "force");
        if !ok && !force && !(status == "stop" && !commit) {
            return Ok(format!("{status}\t{}\t{}\t{}", fnum(best.0), fnum(target + best.1), iters));
        }
        if !commit {
            self.temp(&[(change, num_raw(best.0))]);
            let at = self.numval(set).unwrap_or(f64::NAN);
            self.temp(&[(change, original)]);
            return Ok(format!("{status}\t{}\t{}\t{}", fnum(best.0), fnum(at), iters));
        }
        self.put_all(change.0, &[(change.1, num_raw(best.0))], fx)?;
        Ok(format!("{status}\t{}\t{}\t{}", fnum(best.0), fnum(self.numval(set).unwrap_or(f64::NAN)), iters))
    }

    fn dt_compute(&mut self, t: &DataTable) -> Result<Vec<(Addr, String)>, String> {
        let (s, ar) = (t.sheet, t.area);
        if ar.r1 <= ar.r0 || ar.c1 <= ar.c0 {
            return Err("A data table needs at least two rows and two columns.".to_string());
        }
        let at = |r: u32, c: u32| (s, Addr { row: r, col: c });
        let mut out = Vec::new();
        let raw_at = |wb: &Workbook, r: u32, c: u32| wb.input(s, Addr { row: r, col: c });
        match (t.row_in, t.col_in) {
            (Some(ri), Some(ci)) => {
                let f = at(ar.r0, ar.c0);
                let (kr, kc) = ((s, ri), (s, ci));
                let (orig_r, orig_c) = (self.input(s, ri), self.input(s, ci));
                for r in ar.r0 + 1..=ar.r1 {
                    for c in ar.c0 + 1..=ar.c1 {
                        let (vr, vc) = (raw_at(self, ar.r0, c), raw_at(self, r, ar.c0));
                        self.temp(&[(kr, vr), (kc, vc)]);
                        out.push((Addr { row: r, col: c }, value_raw(&self.val(f))));
                    }
                }
                self.temp(&[(kr, orig_r), (kc, orig_c)]);
            }
            (None, Some(ci)) => {
                let k = (s, ci);
                let orig = self.input(s, ci);
                for r in ar.r0 + 1..=ar.r1 {
                    let v = raw_at(self, r, ar.c0);
                    self.temp(&[(k, v)]);
                    for c in ar.c0 + 1..=ar.c1 {
                        out.push((Addr { row: r, col: c }, value_raw(&self.val(at(ar.r0, c)))));
                    }
                }
                self.temp(&[(k, orig)]);
            }
            (Some(ri), None) => {
                let k = (s, ri);
                let orig = self.input(s, ri);
                for c in ar.c0 + 1..=ar.c1 {
                    let v = raw_at(self, ar.r0, c);
                    self.temp(&[(k, v)]);
                    for r in ar.r0 + 1..=ar.r1 {
                        out.push((Addr { row: r, col: c }, value_raw(&self.val(at(r, ar.c0)))));
                    }
                }
                self.temp(&[(k, orig)]);
            }
            (None, None) => return Err("Give a row input cell, a column input cell, or both.".to_string()),
        }
        Ok(out)
    }

    fn dt_set(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let sheet = self.sheet_of(&a[0])?;
        let (s, area) = self.resolve(&a[1], sheet)?;
        let pick = |wb: &Workbook, t: &str| -> Result<Option<Addr>, String> {
            if t.trim().is_empty() {
                Ok(None)
            } else {
                wb.one(t, s).map(|k| Some(k.1))
            }
        };
        let (row_in, col_in) = (pick(self, &a[2])?, pick(self, &a[3])?);
        let t = DataTable { sheet: s, area, row_in, col_in };
        let cells = self.dt_compute(&t)?;
        let mut next = self.whatif.clone();
        next.tables.retain(|x| !(x.sheet == s && x.area == area));
        next.tables.push(t);
        self.state_change(next);
        let n = cells.len();
        self.put_all(s, &cells, fx)?;
        Ok(format!("ok\t{n}"))
    }

    pub(crate) fn dt_refresh(&mut self, fx: &mut Effect) -> Reply {
        let tables = self.whatif.tables.clone();
        let mut total = 0;
        for t in tables {
            let Ok(cells) = self.dt_compute(&t) else { continue };
            let mut seeds = Vec::new();
            for (ad, raw) in &cells {
                if self.input(t.sheet, *ad) != *raw {
                    self.set_raw(t.sheet, *ad, raw);
                    seeds.push((t.sheet, *ad));
                }
            }
            if !seeds.is_empty() {
                total += seeds.len();
                let changed = self.recalc(&seeds);
                let mut shown = changed;
                for k in &seeds {
                    shown.push((k.0, k.1, self.val(*k)));
                }
                fx.cells.extend(self.present(shown));
            }
        }
        Ok(format!("ok\t{total}"))
    }

    fn sc_set(&mut self, a: &[String]) -> Reply {
        let sheet = self.sheet_of(&a[2])?;
        let name = a[0].trim().to_string();
        if name.is_empty() {
            return Err("Give the scenario a name.".to_string());
        }
        let mut cells = Vec::new();
        let mut i = 3;
        while i + 1 < a.len() {
            let ad = parse_a1(&a[i]).map_err(|_| format!("{} is not a cell reference.", a[i]))?;
            cells.push((ad, a[i + 1].clone()));
            i += 2;
        }
        if cells.is_empty() {
            return Err("A scenario needs at least one changing cell.".to_string());
        }
        if cells.len() > 32 {
            return Err("A scenario can have at most 32 changing cells.".to_string());
        }
        let mut next = self.whatif.clone();
        next.scenarios.retain(|s| !s.name.eq_ignore_ascii_case(&name));
        next.scenarios.push(Scenario { name, comment: a[1].clone(), sheet, cells });
        self.state_change(next);
        Ok("ok".to_string())
    }

    fn sc_summary(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let dst = self.dst_of(&a[0])?;
        let src = self.sheet_of(&a[1])?;
        let scenarios: Vec<Scenario> = self.whatif.scenarios.iter().filter(|s| s.sheet == src).cloned().collect();
        if scenarios.is_empty() {
            return Err("This sheet has no scenarios yet.".to_string());
        }
        let mut results: Vec<Addr> = Vec::new();
        for r in a[2].split(',').filter(|s| !s.trim().is_empty()) {
            let (_, ar) = self.resolve(r, src)?;
            results.extend(cells_of(ar));
        }
        let mut changing: Vec<Addr> = Vec::new();
        for s in &scenarios {
            for (ad, _) in &s.cells {
                if !changing.contains(ad) {
                    changing.push(*ad);
                }
            }
        }
        let current_in: Vec<String> = changing.iter().map(|c| self.input(src, *c)).collect();
        let current_out: Vec<String> = results.iter().map(|c| value_raw(&self.val((src, *c)))).collect();
        let mut scen_out: Vec<Vec<String>> = Vec::new();
        for s in &scenarios {
            let mut sets: Vec<(Key, String)> = s.cells.iter().map(|(ad, raw)| ((src, *ad), raw.clone())).collect();
            let orig: Vec<(Key, String)> = s.cells.iter().map(|(ad, _)| ((src, *ad), self.input(src, *ad))).collect();
            self.temp(&sets);
            scen_out.push(results.iter().map(|c| value_raw(&self.val((src, *c)))).collect());
            sets.clear();
            self.temp(&orig);
        }
        let sheet_name = self.sheets[src].name.clone();
        let mut out = Vec::new();
        put(&mut out, 1, 1, "Scenario Summary");
        put(&mut out, 3, 2, "Current Values:");
        for (i, s) in scenarios.iter().enumerate() {
            put(&mut out, 3, 3 + i as u32, s.name.clone());
        }
        put(&mut out, 4, 1, "Changing Cells:");
        for (j, c) in changing.iter().enumerate() {
            let r = 5 + j as u32;
            put(&mut out, r, 1, format!("{}!${}${}", sheet_name, crate::col_name(c.col), c.row + 1));
            put(&mut out, r, 2, current_in[j].clone());
            for (i, s) in scenarios.iter().enumerate() {
                let raw = s.cells.iter().find(|(ad, _)| ad == c).map(|(_, raw)| raw.clone()).unwrap_or_else(|| current_in[j].clone());
                put(&mut out, r, 3 + i as u32, raw);
            }
        }
        let base = 5 + changing.len() as u32;
        put(&mut out, base, 1, "Result Cells:");
        for (j, c) in results.iter().enumerate() {
            let r = base + 1 + j as u32;
            put(&mut out, r, 1, format!("{}!${}${}", sheet_name, crate::col_name(c.col), c.row + 1));
            put(&mut out, r, 2, current_out[j].clone());
            for (i, _) in scenarios.iter().enumerate() {
                put(&mut out, r, 3 + i as u32, scen_out[i][j].clone());
            }
        }
        let notes = base + 2 + results.len() as u32;
        put(&mut out, notes, 1, "Notes: The Current Values column shows the values of the changing cells when this summary was created. The scenario columns show the values each scenario sets and the result cells that follow from them.");
        self.put_all(dst, &out, fx)?;
        Ok(format!("ok\t{}", scenarios.len()))
    }
}

#[path = "whatif_solver.rs"]
mod solver;
#[path = "whatif_sens.rs"]
mod sens;
#[path = "whatif_scen.rs"]
mod scen;
#[path = "whatif_toolpak.rs"]
mod toolpak;
#[path = "whatif_ask.rs"]
mod ask;
#[path = "whatif_report.rs"]
mod report;
#[path = "whatif_opts.rs"]
mod opts;
