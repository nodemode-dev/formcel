use crate::eval::{self, Out};
use crate::formula::{self, Area, ErrKind, Expr};
use crate::graph::{FastMap, FastSet, Key};
use crate::{col_name, Addr, Changed, Fmt, Value, Workbook};
#[cfg(feature = "parallel")]
use std::sync::Arc;

pub const RULE_ERROR: u16 = 1;
pub const RULE_COLUMN: u16 = 2;
pub const RULE_YEAR: u16 = 4;
pub const RULE_TEXT_NUMBER: u16 = 8;
pub const RULE_INCONSISTENT: u16 = 16;
pub const RULE_OMITS: u16 = 32;
pub const RULE_UNLOCKED: u16 = 64;
pub const RULE_EMPTY: u16 = 128;
pub const RULE_TABLE_INVALID: u16 = 256;
pub const RULES_DEFAULT: u16 = RULE_ERROR | RULE_COLUMN | RULE_YEAR | RULE_TEXT_NUMBER | RULE_INCONSISTENT | RULE_OMITS | RULE_UNLOCKED | RULE_TABLE_INVALID;

#[cfg(feature = "parallel")]
const PAR_MIN: usize = 512;
#[cfg(feature = "parallel")]
const PAR_CHUNK: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Auto,
    AutoNoTables,
    Manual,
}

#[derive(Clone, Debug)]
pub struct Settings {
    pub mode: Mode,
    pub r1c1: bool,
    pub iterate: bool,
    pub max_iter: u32,
    pub max_change: f64,
    pub threads: u32,
    pub on_save: bool,
    pub background: bool,
    pub rules: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { mode: Mode::Auto, r1c1: false, iterate: false, max_iter: 100, max_change: 0.001, threads: 0, on_save: true, background: true, rules: RULES_DEFAULT }
    }
}

#[derive(Default)]
pub struct State {
    pub set: Settings,
    pub stale: FastSet<Key>,
    pub circular: FastSet<Key>,
    pub forcing: bool,
    pub in_tables: bool,
    pub free_arrays: bool,
    pub removed_arrays: Vec<(Key, (u32, u32))>,
    pub ignored: Vec<(usize, u32, u32, u16)>,
    #[cfg(feature = "parallel")]
    pool: Option<(usize, Arc<rayon::ThreadPool>)>,
}

impl std::fmt::Debug for State {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("State").field("set", &self.set).field("stale", &self.stale.len()).field("circular", &self.circular.len()).finish()
    }
}

impl State {
    pub fn hold(&self) -> bool {
        self.set.mode == Mode::Manual && !self.forcing
    }

    pub fn text(&self) -> String {
        let s = &self.set;
        let mode = match s.mode {
            Mode::Auto => "auto",
            Mode::AutoNoTables => "tables",
            Mode::Manual => "manual",
        };
        let mut out = format!(
            "mode={mode}\nstyle={}\niterate={}\niterations={}\ndelta={}\nthreads={}\nsave={}\nbackground={}\nrules={}\n",
            if s.r1c1 { "r1c1" } else { "a1" },
            u8::from(s.iterate),
            s.max_iter,
            s.max_change,
            s.threads,
            u8::from(s.on_save),
            u8::from(s.background),
            s.rules
        );
        for (sheet, r, c, rule) in &self.ignored {
            out.push_str(&format!("ignore={sheet},{r},{c},{rule}\n"));
        }
        out
    }

    pub fn parse(&mut self, text: &str) {
        let mut set = Settings::default();
        let mut ignored = Vec::new();
        for line in text.lines() {
            let Some((k, v)) = line.split_once('=') else { continue };
            let v = v.trim();
            let flag = || v == "1" || v.eq_ignore_ascii_case("true");
            match k.trim() {
                "mode" => {
                    set.mode = match v {
                        "manual" => Mode::Manual,
                        "tables" => Mode::AutoNoTables,
                        _ => Mode::Auto,
                    }
                }
                "style" => set.r1c1 = v.eq_ignore_ascii_case("r1c1"),
                "iterate" => set.iterate = flag(),
                "iterations" => set.max_iter = v.parse().map_or(100, |n: u32| n.clamp(1, 32767)),
                "delta" => set.max_change = v.parse().map_or(0.001, |n: f64| if n.is_finite() && n >= 0.0 { n } else { 0.001 }),
                "threads" => set.threads = v.parse().map_or(0, |n: u32| n.min(256)),
                "save" => set.on_save = flag(),
                "background" => set.background = flag(),
                "rules" => set.rules = v.parse().map_or(RULES_DEFAULT, |n: u16| n & 0x1ff),
                "ignore" => {
                    let p: Vec<&str> = v.split(',').collect();
                    if let [s, r, c, rule] = p[..] {
                        if let (Ok(s), Ok(r), Ok(c), Ok(rule)) = (s.parse(), r.parse(), c.parse(), rule.parse()) {
                            ignored.push((s, r, c, rule));
                        }
                    }
                }
                _ => {}
            }
        }
        self.set = set;
        self.ignored = ignored;
    }

    #[cfg(feature = "parallel")]
    fn workers(&self) -> usize {
        match self.set.threads {
            0 => std::thread::available_parallelism().map_or(1, usize::from),
            n => n as usize,
        }
    }

    #[cfg(feature = "parallel")]
    fn pool(&mut self) -> Option<Arc<rayon::ThreadPool>> {
        let n = self.workers();
        if n <= 1 {
            return None;
        }
        if self.pool.as_ref().is_none_or(|p| p.0 != n) {
            self.pool = rayon::ThreadPoolBuilder::new().num_threads(n).build().ok().map(|p| (n, Arc::new(p)));
        }
        self.pool.as_ref().map(|p| p.1.clone())
    }
}

fn sheet_prefix(wb: &Workbook, s: usize) -> String {
    let mut t = String::new();
    formula::sheet_text(&wb.sheets[s].name, &mut t);
    t
}

fn value_reading(e: &Expr, out: &mut Vec<Area>, sheet_of: &dyn Fn(Option<&str>) -> bool) {
    match e {
        Expr::Call(n, _) if matches!(n.as_str(), "ROW" | "COLUMN" | "ROWS" | "COLUMNS" | "AREAS" | "ISREF" | "SHEET" | "SHEETS" | "ADDRESS" | "FORMULATEXT" | "ISFORMULA" | "CELL") => {}
        Expr::Ref(s, k) => {
            if sheet_of(s.as_deref()) {
                out.push(k.area());
            }
        }
        o => {
            for c in formula::children(o) {
                value_reading(c, out, sheet_of);
            }
        }
    }
}

fn tarjan(adj: &[Vec<usize>], active: &[bool]) -> Vec<usize> {
    let n = adj.len();
    let mut index = vec![usize::MAX; n];
    let mut low = vec![0usize; n];
    let mut on = vec![false; n];
    let mut comp = vec![usize::MAX; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut next = 0usize;
    let mut comps = 0usize;
    for root in 0..n {
        if !active[root] || index[root] != usize::MAX {
            continue;
        }
        let mut work: Vec<(usize, usize)> = vec![(root, 0)];
        index[root] = next;
        low[root] = next;
        next += 1;
        stack.push(root);
        on[root] = true;
        while let Some(&(v, pos)) = work.last() {
            if pos < adj[v].len() {
                if let Some(top) = work.last_mut() {
                    top.1 += 1;
                }
                let w = adj[v][pos];
                if !active[w] {
                    continue;
                }
                if index[w] == usize::MAX {
                    index[w] = next;
                    low[w] = next;
                    next += 1;
                    stack.push(w);
                    on[w] = true;
                    work.push((w, 0));
                } else if on[w] {
                    low[v] = low[v].min(index[w]);
                }
            } else {
                work.pop();
                if let Some(&(p, _)) = work.last() {
                    low[p] = low[p].min(low[v]);
                }
                if low[v] == index[v] {
                    while let Some(w) = stack.pop() {
                        on[w] = false;
                        comp[w] = comps;
                        if w == v {
                            break;
                        }
                    }
                    comps += 1;
                }
            }
        }
    }
    comp
}

fn area_line(a: Area) -> String {
    format!("{}\t{}\t{}\t{}", a.r0, a.c0, a.r1, a.c1)
}

impl Workbook {
    pub fn calc_run(&mut self, cmd: &str) -> (String, crate::Effect) {
        let p: Vec<String> = cmd.split('\t').map(crate::wire::unescape).collect();
        let arg = |i: usize| p.get(i).map_or("", String::as_str);
        let num = |i: usize| arg(i).parse::<u32>().unwrap_or(0);
        let sheet = num(1) as usize;
        let at = |r: usize, c: usize| Addr { row: num(r), col: num(c) };
        let mut fx = crate::Effect::default();
        let fail = |e: crate::EngineError| format!("error\t{e}");
        let reply = match arg(0) {
            "get" => self.calc_text(),
            "set" | "load" => {
                fx.cells = self.set_calc(arg(1));
                "ok".to_string()
            }
            "status" => self.calc_status(),
            "calculate" => {
                let changed = self.calculate(arg(1));
                fx.cells = self.present(changed);
                "ok".to_string()
            }
            "convert" => crate::r1c1::convert(arg(4), at(1, 2), arg(3) == "1"),
            "array" => match self.set_array(sheet, at(2, 3), at(4, 5), arg(6)) {
                Ok(e) => {
                    fx = e;
                    "ok".to_string()
                }
                Err(e) => fail(e),
            },
            "arrayat" => self.array_at(sheet, at(2, 3)).map(area_line).unwrap_or_default(),
            "arrays" => self.arrays(sheet).into_iter().map(area_line).collect::<Vec<_>>().join("\n"),
            "loadarrays" => {
                let list: Vec<Area> = arg(2)
                    .lines()
                    .filter_map(|l| {
                        let n: Vec<u32> = l.split('\t').filter_map(|x| x.parse().ok()).collect();
                        (n.len() == 4).then(|| Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] })
                    })
                    .collect();
                self.load_arrays(sheet, &list).to_string()
            }
            "spillat" => self.spill_at(sheet, at(2, 3)).map(|(a, cse)| format!("{}\t{}", area_line(a), if cse { "a" } else { "s" })).unwrap_or_default(),
            "spills" => self.spill_list(sheet).into_iter().map(|(a, cse)| format!("{}\t{}", area_line(a), if cse { "a" } else { "s" })).collect::<Vec<_>>().join("\n"),
            "spillwhy" => self.spill_reason(sheet, at(2, 3)).map(|(m, b)| format!("{m}\t{}", b.map_or(String::new(), |a| format!("{}{}", col_name(a.col), a.row + 1)))).unwrap_or_default(),
            "check" => self.errcheck_lines(sheet, at(2, 3), at(4, 5)),
            "ignore" => {
                self.errcheck_ignore(sheet, at(2, 3), num(4) as u16);
                "ok".to_string()
            }
            "resetignore" => self.errcheck_reset().to_string(),
            "fix" => match self.errcheck_fix(sheet, at(2, 3), num(4) as u16, arg(5)) {
                Ok(e) => {
                    fx = e;
                    "ok".to_string()
                }
                Err(e) => fail(e),
            },
            "traceerr" => crate::audit::encode_arrows(&self.trace_error(sheet, at(2, 3))),
            "extlist" => self.ext_list().join("\n"),
            "extlines" => self.ext_lines().join("\n"),
            "extload" => {
                let lines: Vec<String> = arg(1).lines().map(String::from).collect();
                self.load_ext(&lines);
                "ok".to_string()
            }
            "extrefresh" => {
                let only = (!arg(2).is_empty()).then(|| (arg(1), arg(2)));
                self.ext_refresh(only).to_string()
            }
            "extchange" => match self.ext_change((arg(1), arg(2)), arg(3), arg(4)) {
                Ok(e) => {
                    fx = e;
                    "ok".to_string()
                }
                Err(e) => fail(e),
            },
            "extbreak" => match self.ext_break((arg(1), arg(2))) {
                Ok(e) => {
                    fx = e;
                    "ok".to_string()
                }
                Err(e) => fail(e),
            },
            other => format!("error\tUnknown calculation command {other}."),
        };
        (reply, fx)
    }

    pub fn calc_text(&self) -> String {
        self.calc.text()
    }

    pub fn calc_r1c1(&self) -> bool {
        self.calc.set.r1c1
    }

    pub fn load_calc(&mut self, text: &str) {
        self.calc.parse(text);
    }

    pub fn set_calc(&mut self, text: &str) -> Changed {
        let before = self.calc.set.clone();
        self.calc.parse(text);
        let after = self.calc.set.clone();
        let leaving = before.mode == Mode::Manual && after.mode != Mode::Manual;
        let toggled = before.iterate != after.iterate || before.max_iter != after.max_iter || before.max_change != after.max_change;
        let mut out = Vec::new();
        if toggled && !self.calc.circular.is_empty() {
            out = self.calculate("full");
        } else if leaving {
            out = self.calculate("all");
        }
        if before.mode != Mode::AutoNoTables && after.mode == Mode::Auto && !self.whatif.tables.is_empty() {
            out.extend(self.refresh_tables());
        }
        self.present(out)
    }

    pub fn calc_status(&self) -> String {
        let mode = match self.calc.set.mode {
            Mode::Auto => "auto",
            Mode::AutoNoTables => "tables",
            Mode::Manual => "manual",
        };
        let live = |k: &&Key| self.formulas.contains_key(k);
        let mut circ: Vec<Key> = self.calc.circular.iter().filter(live).copied().collect();
        circ.sort_by_key(|k| (k.0, k.1.row, k.1.col));
        let names: Vec<String> = circ.iter().take(50).map(|k| format!("{}{}{}", sheet_prefix(self, k.0), col_name(k.1.col), k.1.row + 1)).collect();
        let stale = self.calc.stale.iter().filter(|k| self.formulas.contains_key(k)).count();
        let tables = u8::from(!self.whatif.tables.is_empty() && self.calc.set.mode != Mode::Auto);
        format!("{mode}\t{stale}\t{}\t{tables}\t{}", circ.len(), names.join(", "))
    }

    pub fn calculate(&mut self, scope: &str) -> Changed {
        self.calc.forcing = true;
        let mut out: Changed = match scope {
            "full" => {
                self.calc.stale.clear();
                self.ext_drop_results();
                self.recalc_all()
            }
            "rebuild" => {
                self.graph.built = false;
                self.calc.stale.clear();
                self.ext_drop_results();
                self.recalc_all()
            }
            s => {
                let only = s.strip_prefix("sheet:").and_then(|n| n.parse::<usize>().ok());
                let mut seeds: Vec<Key> = self.calc.stale.iter().filter(|k| self.formulas.contains_key(k) && only.is_none_or(|n| k.0 == n)).copied().collect();
                seeds.extend(self.formulas.iter().filter(|(k, f)| f.volatile && only.is_none_or(|n| k.0 == n)).map(|(k, _)| *k));
                seeds.sort_unstable_by_key(|k| (k.0, k.1.row, k.1.col));
                seeds.dedup();
                let changed = self.recalc_with(&seeds, false);
                for (s, a, _) in &changed {
                    self.calc.stale.remove(&(*s, *a));
                }
                changed
            }
        };
        out.extend(self.refresh_tables());
        self.calc.forcing = false;
        out
    }

    pub(crate) fn refresh_tables(&mut self) -> Changed {
        if self.whatif.tables.is_empty() || self.calc.in_tables {
            return Vec::new();
        }
        self.calc.in_tables = true;
        let mut fx = crate::Effect::default();
        let _ = self.dt_refresh(&mut fx);
        self.calc.in_tables = false;
        fx.cells
    }

    pub(crate) fn hold_dirty(&mut self, seeds: &[Key], anchors: &[Key], dirty: FastSet<Key>) -> FastSet<Key> {
        let direct: FastSet<Key> = seeds.iter().chain(anchors).filter(|k| self.formulas.contains_key(k)).copied().collect();
        for k in dirty {
            if !direct.contains(&k) {
                self.calc.stale.insert(k);
            }
        }
        direct
    }

    pub(crate) fn self_reading(&self, k: &Key) -> bool {
        let Some(e) = self.formulas.get(k).and_then(|f| f.ast.as_ref()) else { return false };
        let mut areas = Vec::new();
        let names = self.sheet_names();
        let here = k.0;
        value_reading(e, &mut areas, &|s| s.is_none_or(|n| names.get(here).is_some_and(|m| m.eq_ignore_ascii_case(n))));
        areas.iter().any(|a| a.contains(k.1.row, k.1.col))
    }

    fn eval_one(&self, k: Key) -> (Out, Option<Fmt>) {
        let (s, a) = k;
        match &self.formulas[&k].ast {
            None => (Out::V(Value::Error(ErrKind::Error)), None),
            Some(e) => (eval::Eval::new(self, s).placed(a).formula(e), self.infer(s, e)),
        }
    }

    fn commit(&mut self, k: Key, o: Out, f: Option<Fmt>) -> Value {
        let (s, a) = k;
        let v = match o {
            Out::V(v) if self.arrays.contains_key(&k) => self.fill_array(k, Out::V(v)),
            Out::V(v) => {
                self.unspill(k);
                v
            }
            Out::A(x) if self.arrays.contains_key(&k) => self.fill_array(k, Out::A(x)),
            Out::A(x) => self.spill(k, x),
        };
        match f {
            Some(f) if matches!(v, Value::Number(_)) => self.fmts.insert(k, f),
            _ => self.fmts.remove(&k),
        };
        self.sheets[s].cells.set(a, v.clone());
        v
    }

    fn eval_batch(&mut self, ids: &[Key], batch: &[usize]) -> Vec<(Out, Option<Fmt>)> {
        #[cfg(feature = "parallel")]
        if batch.len() >= PAR_MIN {
            if let Some(pool) = self.calc.pool() {
                use rayon::prelude::*;
                let me: &Workbook = self;
                let parts: Vec<Vec<(Out, Option<Fmt>)>> = pool.install(|| batch.par_chunks(PAR_CHUNK).map(|c| c.iter().map(|&i| me.eval_one(ids[i])).collect()).collect());
                return parts.into_iter().flatten().collect();
            }
        }
        batch.iter().map(|&i| self.eval_one(ids[i])).collect()
    }

    pub(crate) fn evaluate_levels(&mut self, dirty: FastSet<Key>) -> Changed {
        let ids: Vec<Key> = dirty.into_iter().collect();
        let n = ids.len();
        let id_of: FastMap<Key, usize> = ids.iter().enumerate().map(|(i, k)| (*k, i)).collect();
        let mut by_sheet: FastMap<usize, Vec<usize>> = FastMap::default();
        for (i, k) in ids.iter().enumerate() {
            by_sheet.entry(k.0).or_default().push(i);
        }
        let mut indeg = vec![0u32; n];
        let mut users: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut selfish = vec![false; n];
        let mut pre: Vec<usize> = Vec::new();
        for i in 0..n {
            pre.clear();
            for (s, ar) in self.graph.areas(&ids[i]) {
                let cells = u64::from(ar.r1 - ar.r0 + 1) * u64::from(ar.c1 - ar.c0 + 1);
                let on_sheet = by_sheet.get(s).map(Vec::as_slice).unwrap_or(&[]);
                if cells <= on_sheet.len() as u64 {
                    for r in ar.r0..=ar.r1 {
                        for c in ar.c0..=ar.c1 {
                            if let Some(&j) = id_of.get(&(*s, Addr { row: r, col: c })) {
                                pre.push(j);
                            }
                        }
                    }
                } else {
                    pre.extend(on_sheet.iter().copied().filter(|&j| ar.contains(ids[j].1.row, ids[j].1.col)));
                }
            }
            pre.sort_unstable();
            pre.dedup();
            for &j in &pre {
                if j != i {
                    indeg[i] += 1;
                    users[j].push(i);
                } else if self.self_reading(&ids[i]) {
                    indeg[i] += 1;
                    selfish[i] = true;
                }
            }
        }
        for k in &ids {
            self.calc.circular.remove(k);
        }
        let mut done = vec![false; n];
        let mut out: Changed = Vec::with_capacity(n);
        let mut level: Vec<usize> = (0..n).filter(|&i| indeg[i] == 0).collect();
        loop {
            while !level.is_empty() {
                let results = self.eval_batch(&ids, &level);
                let mut next = Vec::new();
                for (&i, (o, f)) in level.iter().zip(results) {
                    done[i] = true;
                    let v = self.commit(ids[i], o, f);
                    out.push((ids[i].0, ids[i].1, v));
                    for &u in &users[i] {
                        indeg[u] -= 1;
                        if indeg[u] == 0 {
                            next.push(u);
                        }
                    }
                }
                level = next;
            }
            if done.iter().all(|d| *d) {
                break;
            }
            let active: Vec<bool> = done.iter().map(|d| !d).collect();
            let comp = tarjan(&users, &active);
            let mut size: FastMap<usize, usize> = FastMap::default();
            for i in 0..n {
                if active[i] {
                    *size.entry(comp[i]).or_default() += 1;
                }
            }
            let cyclic = |i: usize| active[i] && (size[&comp[i]] > 1 || selfish[i]);
            let members: Vec<usize> = (0..n).filter(|&i| cyclic(i)).collect();
            for &i in &members {
                self.calc.circular.insert(ids[i]);
            }
            if !self.calc.set.iterate || members.is_empty() {
                for i in 0..n {
                    if active[i] {
                        let (s, a) = ids[i];
                        let v = Value::Error(ErrKind::Ref);
                        self.sheets[s].cells.set(a, v.clone());
                        out.push((s, a, v));
                    }
                }
                break;
            }
            let mut fed: FastSet<usize> = FastSet::default();
            for j in 0..n {
                if active[j] {
                    for &u in &users[j] {
                        if active[u] && comp[u] != comp[j] {
                            fed.insert(comp[u]);
                        }
                    }
                }
            }
            let mut sources: Vec<usize> = members.iter().copied().filter(|&i| !fed.contains(&comp[i])).collect();
            if sources.is_empty() {
                sources = members.clone();
            }
            sources.sort_by_key(|&i| (ids[i].0, ids[i].1.row, ids[i].1.col));
            for &i in &sources {
                let k = ids[i];
                if matches!(self.sheets[k.0].cells.get(k.1), Some(Value::Error(ErrKind::Ref))) {
                    self.sheets[k.0].cells.set(k.1, Value::Number(0.0));
                }
            }
            let rounds = self.calc.set.max_iter;
            let eps = self.calc.set.max_change;
            for _ in 0..rounds {
                let mut worst = 0.0f64;
                for &i in &sources {
                    let k = ids[i];
                    let old = self.sheets[k.0].cells.get(k.1).cloned().unwrap_or(Value::Empty);
                    let (o, f) = self.eval_one(k);
                    let v = self.commit(k, o, f);
                    worst = worst.max(match (&old, &v) {
                        (Value::Number(a), Value::Number(b)) => (a - b).abs(),
                        (a, b) if a == b => 0.0,
                        _ => f64::INFINITY,
                    });
                }
                if worst < eps || worst.is_nan() {
                    break;
                }
            }
            for &i in &sources {
                done[i] = true;
            }
            for &i in &sources {
                let k = ids[i];
                let v = self.sheets[k.0].cells.get(k.1).cloned().unwrap_or(Value::Empty);
                out.push((k.0, k.1, v));
                for &u in &users[i] {
                    if !done[u] {
                        indeg[u] = indeg[u].saturating_sub(1);
                        if indeg[u] == 0 {
                            level.push(u);
                        }
                    }
                }
            }
        }
        out
    }
}
