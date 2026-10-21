use graph::{FastMap, FastSet};
use std::collections::{HashMap, VecDeque};
use std::fmt;

pub mod eval;
pub mod formula;
mod graph;
pub mod numfmt;
pub use numfmt::Fmt;
mod store;
pub mod wire;
pub use formula::ErrKind;
use formula::{Area, Expr};
pub use store::{Dir, Store};

pub const HISTORY_LIMIT: usize = 500;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const MAX_ROWS: u32 = 1_048_576;
pub const MAX_COLS: u32 = 16_384;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Empty,
    Number(f64),
    Text(String),
    Bool(bool),
    Error(ErrKind),
}

impl Value {
    pub fn parse_input(raw: &str) -> Value {
        Value::parse_with_fmt(raw).0
    }

    pub fn parse_with_fmt(raw: &str) -> (Value, Option<Fmt>) {
        let v = Value::parse_plain(raw);
        let t = raw.trim();
        let dec = |s: &str| if s.contains('.') { 2 } else { 0 };
        match v {
            Value::Number(n) if t.contains('$') => (Value::Number(n), Some(Fmt::Currency(dec(t)))),
            Value::Number(n) if t.ends_with('%') => (Value::Number(n), Some(Fmt::Percent(dec(t)))),
            Value::Text(_) => match numfmt::parse(t) {
                Some((n, f)) => (Value::Number(n), Some(f)),
                None => (v, None),
            },
            o => (o, None),
        }
    }

    fn parse_plain(raw: &str) -> Value {
        let t = raw.trim();
        if t.is_empty() {
            return Value::Empty;
        }
        match t.to_ascii_uppercase().as_str() {
            "TRUE" => return Value::Bool(true),
            "FALSE" => return Value::Bool(false),
            _ => {}
        }
        if t.starts_with('#') {
            if let Some(e) = ErrKind::parse(t) {
                return Value::Error(e);
            }
        }
        let plain = t.replace(',', "");
        if let Ok(n) = plain.parse::<f64>() {
            if n.is_finite() {
                return Value::Number(n);
            }
        }
        if let Some(p) = plain.strip_suffix('%') {
            if let Ok(n) = p.trim().parse::<f64>() {
                return Value::Number(n / 100.0);
            }
        }
        let (neg, body) = match plain.strip_prefix('-') {
            Some(b) => (true, b),
            None => (false, plain.as_str()),
        };
        if let Some(m) = body.strip_prefix('$') {
            let (neg2, m) = match m.strip_prefix('-') {
                Some(b) => (true, b),
                None => (false, m),
            };
            if let Ok(n) = m.parse::<f64>() {
                if n.is_finite() && !m.starts_with('+') {
                    return Value::Number(if neg != neg2 { -n } else { n });
                }
            }
        }
        Value::Text(raw.to_string())
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Empty => Ok(()),
            Value::Number(n) => {
                let n = eval::sig15(*n);
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    write!(f, "{}", n as i64)
                } else {
                    write!(f, "{}", n)
                }
            }
            Value::Text(s) => f.write_str(s),
            Value::Bool(b) => f.write_str(if *b { "TRUE" } else { "FALSE" }),
            Value::Error(e) => f.write_str(e.text()),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Addr {
    pub row: u32,
    pub col: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub enum EngineError {
    BadAddress(String),
    OutOfRange { row: u32, col: u32 },
    NoSheet(usize),
    BadName(String),
    BadFormula(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::BadAddress(a) => write!(f, "not a cell address: {a}"),
            EngineError::OutOfRange { row, col } => write!(f, "cell outside the grid: row {row}, column {col}"),
            EngineError::NoSheet(i) => write!(f, "no sheet at index {i}"),
            EngineError::BadName(n) => write!(f, "not a valid name: {n}"),
            EngineError::BadFormula(s) => write!(f, "not a valid formula: {s}"),
        }
    }
}

impl std::error::Error for EngineError {}

pub fn col_name(col: u32) -> String {
    let mut n = col + 1;
    let mut out = Vec::new();
    while n > 0 {
        let r = (n - 1) % 26;
        out.push(b'A' + r as u8);
        n = (n - 1) / 26;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

pub fn parse_a1(a1: &str) -> Result<Addr, EngineError> {
    let s = a1.trim().replace('$', "");
    let split = s.find(|c: char| c.is_ascii_digit()).ok_or_else(|| EngineError::BadAddress(a1.to_string()))?;
    let (letters, digits) = s.split_at(split);
    if letters.is_empty() || !letters.chars().all(|c| c.is_ascii_alphabetic()) || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(EngineError::BadAddress(a1.to_string()));
    }
    let mut col: u64 = 0;
    for c in letters.to_ascii_uppercase().bytes() {
        col = col * 26 + u64::from(c - b'A' + 1);
        if col > u64::from(MAX_COLS) {
            return Err(EngineError::BadAddress(a1.to_string()));
        }
    }
    let row: u64 = digits.parse().map_err(|_| EngineError::BadAddress(a1.to_string()))?;
    if row == 0 || row > u64::from(MAX_ROWS) {
        return Err(EngineError::BadAddress(a1.to_string()));
    }
    Ok(Addr { row: (row - 1) as u32, col: (col - 1) as u32 })
}

pub fn to_a1(addr: Addr) -> String {
    format!("{}{}", col_name(addr.col), addr.row + 1)
}

#[derive(Default, Debug)]
pub struct Sheet {
    pub name: String,
    cells: Store,
}

impl Sheet {
    pub fn new(name: &str) -> Self {
        Sheet { name: name.to_string(), cells: Store::default() }
    }

    pub fn len(&self) -> usize {
        self.cells.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }
}

#[derive(Clone, Debug)]
struct Change {
    sheet: usize,
    addr: Addr,
    before: String,
    after: String,
}

#[derive(Clone, Debug)]
struct Formula {
    ast: Option<Expr>,
    src: String,
    volatile: bool,
}

impl Formula {
    fn new(raw: &str) -> Formula {
        let body = raw.trim_start().strip_prefix('=').unwrap_or(raw);
        let ast = formula::parse(body);
        let volatile = ast.as_ref().is_some_and(formula::is_volatile);
        Formula { ast, src: body.to_string(), volatile }
    }

    fn text(&self) -> String {
        match &self.ast {
            Some(e) => format!("={}", formula::to_text(e)),
            None => format!("={}", self.src),
        }
    }
}

fn is_formula(raw: &str) -> bool {
    let t = raw.trim_start();
    t.starts_with('=') && t.len() > 1
}

type Key = (usize, Addr);
type Dropped = Vec<(Addr, String)>;
type Rewritten = Vec<(usize, Addr, String)>;

pub type Changed = Vec<(usize, Addr, Value)>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shift {
    pub sheet: usize,
    pub rows: bool,
    pub at: u32,
    pub delta: i64,
}

#[derive(Debug, Default)]
pub struct Effect {
    pub cells: Changed,
    pub shift: Option<Shift>,
}

#[derive(Clone, Debug)]
enum Tx {
    Cells(Vec<Change>),
    Shift { shift: Shift, dropped: Vec<(Addr, String)>, rewritten: Vec<(usize, Addr, String)> },
}

#[derive(Debug)]
pub struct Workbook {
    sheets: Vec<Sheet>,
    undo: Vec<Tx>,
    redo: Vec<Tx>,
    formulas: FastMap<Key, Formula>,
    graph: graph::Graph,
    fmts: FastMap<Key, Fmt>,
    spills: FastMap<Key, (u32, u32)>,
    spilled: FastMap<Key, Key>,
    touched: Vec<Key>,
    names: FastMap<String, (String, Expr)>,
}

const SPILL_PASSES: usize = 8;

impl eval::Ctx for Workbook {
    fn sheet_index(&self, name: &str) -> Option<usize> {
        self.sheet_by_name(name)
    }

    fn cell(&self, sheet: usize, a: Addr) -> Value {
        self.sheets.get(sheet).and_then(|s| s.cells.get(a)).cloned().unwrap_or(Value::Empty)
    }

    fn each(&self, sheet: usize, area: Area, f: &mut dyn FnMut(Addr, &Value)) {
        if let Some(s) = self.sheets.get(sheet) {
            s.cells.for_each_in(Addr { row: area.r0, col: area.c0 }, Addr { row: area.r1, col: area.c1 }, |a, v| f(a, v));
        }
    }

    fn name(&self, name: &str) -> Option<&Expr> {
        if self.names.is_empty() {
            return None;
        }
        self.names.get(&name.to_ascii_uppercase()).map(|n| &n.1)
    }
}

impl Default for Workbook {
    fn default() -> Self {
        Self::new()
    }
}

impl Workbook {
    pub fn new() -> Self {
        Workbook {
            sheets: vec![Sheet::new("Sheet1")],
            undo: Vec::new(),
            redo: Vec::new(),
            formulas: FastMap::default(),
            graph: graph::Graph::default(),
            fmts: FastMap::default(),
            spills: FastMap::default(),
            spilled: FastMap::default(),
            touched: Vec::new(),
            names: FastMap::default(),
        }
    }

    pub fn sheet_count(&self) -> usize {
        self.sheets.len()
    }

    pub fn sheet_names(&self) -> Vec<String> {
        self.sheets.iter().map(|s| s.name.clone()).collect()
    }

    pub fn add_sheet(&mut self, name: &str) -> usize {
        self.sheets.push(Sheet::new(name));
        self.graph.built = false;
        if !self.formulas.is_empty() {
            self.recalc_all();
        }
        self.sheets.len() - 1
    }

    pub fn rename_sheet(&mut self, sheet: usize, name: &str) -> Result<(), EngineError> {
        let s = self.sheets.get_mut(sheet).ok_or(EngineError::NoSheet(sheet))?;
        let old = std::mem::replace(&mut s.name, name.to_string());
        for f in self.formulas.values_mut() {
            if let Some(e) = f.ast.as_mut() {
                formula::rename_refs(e, &old, name);
            }
        }
        for (_, e) in self.names.values_mut() {
            formula::rename_refs(e, &old, name);
        }
        self.graph.built = false;
        self.recalc_all();
        Ok(())
    }

    fn check(&self, sheet: usize, addr: Addr) -> Result<(), EngineError> {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        if addr.row >= MAX_ROWS || addr.col >= MAX_COLS {
            return Err(EngineError::OutOfRange { row: addr.row, col: addr.col });
        }
        Ok(())
    }

    pub fn set_input(&mut self, sheet: usize, addr: Addr, raw: &str) -> Result<Value, EngineError> {
        let changed = self.apply(sheet, &[(addr, raw.to_string())])?;
        Ok(changed.into_iter().next().map(|c| c.2).unwrap_or(Value::Empty))
    }

    pub fn apply(&mut self, sheet: usize, edits: &[(Addr, String)]) -> Result<Changed, EngineError> {
        for (a, _) in edits {
            self.check(sheet, *a)?;
        }
        let mut tx = Vec::with_capacity(edits.len());
        let mut seeds = Vec::with_capacity(edits.len());
        for (a, raw) in edits {
            let before = self.input(sheet, *a);
            self.set_raw(sheet, *a, raw);
            let after = self.input(sheet, *a);
            if before != after {
                tx.push(Change { sheet, addr: *a, before, after });
            }
            seeds.push((sheet, *a));
        }
        if !tx.is_empty() {
            self.record(Tx::Cells(tx));
        }
        let changed = self.recalc(&seeds);
        Ok(self.present(changed))
    }

    pub fn fmt(&self, sheet: usize, a: Addr) -> Option<Fmt> {
        self.fmts.get(&(sheet, a)).copied()
    }

    fn shown(&self, sheet: usize, a: Addr, v: Value) -> Value {
        match (&v, self.fmts.get(&(sheet, a))) {
            (Value::Number(n), Some(f)) => numfmt::show(*n, *f).map_or(v, Value::Text),
            _ => v,
        }
    }

    fn present(&self, changed: Changed) -> Changed {
        changed.into_iter().map(|(s, a, v)| (s, a, self.shown(s, a, v))).collect()
    }

    pub fn input(&self, sheet: usize, a: Addr) -> String {
        if let Some(f) = self.formulas.get(&(sheet, a)) {
            return f.text();
        }
        if self.spilled.contains_key(&(sheet, a)) {
            return String::new();
        }
        match self.sheets.get(sheet).and_then(|s| s.cells.get(a)) {
            Some(v) => self.shown(sheet, a, v.clone()).to_string(),
            None => String::new(),
        }
    }

    pub fn formula_text(&self, sheet: usize, a: Addr) -> Option<String> {
        if self.spilled.contains_key(&(sheet, a)) {
            return Some(String::new());
        }
        self.formulas.get(&(sheet, a)).map(Formula::text)
    }

    pub fn inputs(&self, sheet: usize) -> Result<Vec<(Addr, String)>, EngineError> {
        let s = self.sheets.get(sheet).ok_or(EngineError::NoSheet(sheet))?;
        let mut out = Vec::with_capacity(s.len());
        if let Some(bottom) = s.cells.extent() {
            s.cells.for_each_in(Addr { row: 0, col: 0 }, bottom, |a, v| {
                if self.spilled.contains_key(&(sheet, a)) {
                    return;
                }
                let text = self.formulas.get(&(sheet, a)).map_or_else(|| self.shown(sheet, a, v.clone()).to_string(), Formula::text);
                out.push((a, text));
            });
        }
        Ok(out)
    }

    fn set_raw(&mut self, sheet: usize, a: Addr, raw: &str) {
        let k = (sheet, a);
        self.spilled.remove(&k);
        if is_formula(raw) {
            let f = Formula::new(raw);
            if self.graph.built {
                let areas = self.areas_of(&k, &f);
                self.graph.insert(k, areas);
            }
            self.formulas.insert(k, f);
            self.sheets[sheet].cells.set(a, Value::Number(0.0));
        } else {
            if self.formulas.remove(&k).is_some() {
                self.graph.remove(&k);
            }
            let (v, f) = Value::parse_with_fmt(raw);
            match f {
                Some(f) => self.fmts.insert(k, f),
                None => self.fmts.remove(&k),
            };
            self.sheets[sheet].cells.set(a, v);
        }
    }

    fn infer(&self, sheet: usize, e: &Expr) -> Option<Fmt> {
        use formula::{Op, RefKind};
        match e {
            Expr::Call(n, args) => match n.as_str() {
                "DATE" | "TODAY" | "EDATE" | "EOMONTH" => Some(Fmt::Date),
                "NOW" => Some(Fmt::DateTime { secs: false, ampm: false }),
                "TIME" => Some(Fmt::Time { secs: false, ampm: true }),
                "MIN" | "MAX" | "IF" | "IFERROR" => args.iter().skip(usize::from(n == "IF")).find_map(|x| self.infer(sheet, x)).filter(|f| f.is_date()),
                _ => None,
            },
            Expr::Ref(s, RefKind::Cell(c)) => {
                let idx = match s {
                    None => Some(sheet),
                    Some(name) => self.sheet_by_name(name),
                }?;
                self.fmts.get(&(idx, Addr { row: c.row, col: c.col })).copied()
            }
            Expr::Paren(x) => self.infer(sheet, x),
            Expr::Bin(Op::Add | Op::Sub, a, b) => match (self.infer(sheet, a), self.infer(sheet, b)) {
                (Some(f), None) | (None, Some(f)) if f.is_date() => Some(f),
                (Some(f @ Fmt::Currency(_)), _) | (_, Some(f @ Fmt::Currency(_))) => Some(f),
                _ => None,
            },
            Expr::Bin(Op::Mul | Op::Div, a, b) => match (self.infer(sheet, a), self.infer(sheet, b)) {
                (Some(f @ Fmt::Currency(_)), _) | (_, Some(f @ Fmt::Currency(_))) => Some(f),
                _ => None,
            },
            _ => None,
        }
    }

    fn ensure_graph(&mut self) {
        if self.graph.built {
            return;
        }
        let all: Vec<(Key, Vec<(usize, Area)>)> = self.formulas.iter().map(|(k, f)| (*k, self.areas_of(k, f))).collect();
        self.graph.clear();
        for (k, areas) in all {
            self.graph.insert(k, areas);
        }
        self.graph.built = true;
    }

    fn sheet_by_name(&self, name: &str) -> Option<usize> {
        self.sheets.iter().position(|s| s.name.eq_ignore_ascii_case(name))
    }

    fn areas_of(&self, k: &Key, f: &Formula) -> Vec<(usize, Area)> {
        let mut out = Vec::new();
        if let Some(e) = &f.ast {
            let mut seen: Vec<String> = Vec::new();
            self.expr_areas(k.0, e, &mut out, &mut seen);
        }
        out
    }

    fn expr_areas(&self, sheet: usize, e: &Expr, out: &mut Vec<(usize, Area)>, seen: &mut Vec<String>) {
        formula::refs(e, &mut |s, area| {
            let idx = match s {
                None => Some(sheet),
                Some(n) => self.sheet_by_name(n),
            };
            if let Some(i) = idx {
                out.push((i, area));
            }
        });
        if self.names.is_empty() {
            return;
        }
        let mut used = Vec::new();
        formula::names(e, &mut |n| used.push(n.to_ascii_uppercase()));
        for n in used {
            if seen.contains(&n) {
                continue;
            }
            if let Some((_, x)) = self.names.get(&n) {
                seen.push(n);
                self.expr_areas(sheet, x, out, seen);
            }
        }
    }

    pub fn define_name(&mut self, name: &str, refers: &str) -> Result<Changed, EngineError> {
        let key = name.to_ascii_uppercase();
        if refers.trim().is_empty() {
            self.names.remove(&key);
        } else {
            if !formula::valid_name(name) {
                return Err(EngineError::BadName(name.to_string()));
            }
            let src = refers.strip_prefix('=').unwrap_or(refers);
            let e = formula::parse(src).ok_or_else(|| EngineError::BadFormula(refers.to_string()))?;
            self.names.insert(key, (name.to_string(), e));
        }
        self.graph.built = false;
        let changed = self.recalc_all();
        Ok(self.present(changed))
    }

    pub fn names(&self) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = self.names.values().map(|(n, e)| (n.clone(), format!("={}", formula::to_text(e)))).collect();
        out.sort_by_key(|a| a.0.to_ascii_uppercase());
        out
    }

    fn recalc(&mut self, seeds: &[Key]) -> Changed {
        self.recalc_with(seeds, false)
    }

    fn recalc_with(&mut self, seeds: &[Key], everything: bool) -> Changed {
        self.touched.clear();
        let mut out = self.recalc_pass(seeds, everything, true);
        for _ in 0..SPILL_PASSES {
            let touched = std::mem::take(&mut self.touched);
            if touched.is_empty() {
                break;
            }
            out.extend(self.recalc_pass(&touched, false, false));
        }
        self.touched.clear();
        out
    }

    fn recalc_pass(&mut self, seeds: &[Key], everything: bool, volatile: bool) -> Changed {
        self.ensure_graph();
        let mut dirty: FastSet<Key> = FastSet::default();
        for k in seeds {
            if !self.formulas.contains_key(k) {
                self.unspill(*k);
            }
        }
        let anchors: Vec<Key> = seeds
            .iter()
            .filter(|k| !self.spilled.contains_key(k))
            .flat_map(|k| self.spills.iter().filter(move |(o, &(h, w))| o.0 == k.0 && *o != k && (o.1.row..o.1.row + h).contains(&k.1.row) && (o.1.col..o.1.col + w).contains(&k.1.col)).map(|(o, _)| *o))
            .collect();
        if everything {
            dirty.extend(self.formulas.keys().copied());
        } else {
            let mut queue: VecDeque<Key> = seeds.iter().chain(&anchors).copied().collect();
            for k in seeds.iter().chain(&anchors) {
                if self.formulas.contains_key(k) {
                    dirty.insert(*k);
                }
            }
            for (k, f) in &self.formulas {
                if volatile && f.volatile && dirty.insert(*k) {
                    queue.push_back(*k);
                }
            }
            let mut found = Vec::new();
            while let Some(k) = queue.pop_front() {
                self.graph.dependents(&k, &mut |x| found.push(x));
                for x in found.drain(..) {
                    if dirty.insert(x) {
                        queue.push_back(x);
                    }
                }
            }
        }
        let mut out: Changed = seeds.iter().filter(|k| !self.formulas.contains_key(k)).map(|k| (k.0, k.1, self.sheets[k.0].cells.get(k.1).cloned().unwrap_or(Value::Empty))).collect();
        out.extend(self.evaluate(dirty));
        out
    }

    fn evaluate(&mut self, dirty: FastSet<Key>) -> Changed {
        let ids: Vec<Key> = dirty.into_iter().collect();
        let id_of: FastMap<Key, usize> = ids.iter().enumerate().map(|(i, k)| (*k, i)).collect();
        let mut by_sheet: FastMap<usize, Vec<usize>> = FastMap::default();
        for (i, k) in ids.iter().enumerate() {
            by_sheet.entry(k.0).or_default().push(i);
        }
        let mut indeg = vec![0u32; ids.len()];
        let mut users: Vec<Vec<usize>> = vec![Vec::new(); ids.len()];
        let mut pre: Vec<usize> = Vec::new();
        for i in 0..ids.len() {
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
                }
            }
        }
        let mut ready: VecDeque<usize> = (0..ids.len()).filter(|&i| indeg[i] == 0).collect();
        let mut done = vec![false; ids.len()];
        let mut out = Vec::with_capacity(ids.len());
        while let Some(i) = ready.pop_front() {
            done[i] = true;
            let (s, a) = ids[i];
            let (o, f) = match &self.formulas[&(s, a)].ast {
                None => (eval::Out::V(Value::Error(ErrKind::Error)), None),
                Some(e) => (eval::Eval::new(&*self, s).formula(e), self.infer(s, e)),
            };
            let v = match o {
                eval::Out::V(v) => {
                    self.unspill((s, a));
                    v
                }
                eval::Out::A(x) => self.spill((s, a), x),
            };
            match f {
                Some(f) if matches!(v, Value::Number(_)) => self.fmts.insert((s, a), f),
                _ => self.fmts.remove(&(s, a)),
            };
            self.sheets[s].cells.set(a, v.clone());
            out.push((s, a, v));
            for &u in &users[i] {
                indeg[u] -= 1;
                if indeg[u] == 0 {
                    ready.push_back(u);
                }
            }
        }
        for (i, &(s, a)) in ids.iter().enumerate() {
            if !done[i] {
                let v = Value::Error(ErrKind::Ref);
                self.sheets[s].cells.set(a, v.clone());
                out.push((s, a, v));
            }
        }
        out
    }

    fn spill(&mut self, k: Key, x: eval::Array) -> Value {
        let (s, a) = k;
        let (h, w) = (x.rows as u32, x.cols as u32);
        let prev = self.spills.insert(k, (h, w));
        let fits = a.row + h <= MAX_ROWS && a.col + w <= MAX_COLS;
        let blocked = !fits
            || (a.row..a.row + h).any(|r| {
                (a.col..a.col + w).any(|c| {
                    let p = (s, Addr { row: r, col: c });
                    p != k && (self.formulas.contains_key(&p) || (self.spilled.get(&p) != Some(&k) && self.sheets[s].cells.get(p.1).is_some()))
                })
            });
        if let Some((ph, pw)) = prev {
            for r in a.row..a.row + ph {
                for c in a.col..a.col + pw {
                    let p = (s, Addr { row: r, col: c });
                    if p != k && self.spilled.get(&p) == Some(&k) && (blocked || r >= a.row + h || c >= a.col + w) {
                        self.spilled.remove(&p);
                        self.sheets[s].cells.set(p.1, Value::Empty);
                        self.touched.push(p);
                    }
                }
            }
        }
        if blocked {
            return Value::Error(ErrKind::Spill);
        }
        let mut first = Value::Empty;
        for (i, v) in x.data.into_iter().enumerate() {
            let p = (s, Addr { row: a.row + i as u32 / w, col: a.col + i as u32 % w });
            if p == k {
                first = v;
                continue;
            }
            self.spilled.insert(p, k);
            if self.sheets[s].cells.get(p.1) != Some(&v) {
                self.sheets[s].cells.set(p.1, v);
                self.touched.push(p);
            }
        }
        first
    }

    fn unspill(&mut self, k: Key) {
        let Some((h, w)) = self.spills.remove(&k) else { return };
        for r in k.1.row..k.1.row + h {
            for c in k.1.col..k.1.col + w {
                let p = (k.0, Addr { row: r, col: c });
                if self.spilled.get(&p) == Some(&k) {
                    self.spilled.remove(&p);
                    self.sheets[k.0].cells.set(p.1, Value::Empty);
                    self.touched.push(p);
                }
            }
        }
    }

    fn unspill_all(&mut self) {
        for ((s, p), _) in self.spilled.drain() {
            self.sheets[s].cells.set(p, Value::Empty);
        }
        self.spills.clear();
        self.touched.clear();
    }

    fn recalc_all(&mut self) -> Changed {
        let seeds: Vec<Key> = self.formulas.keys().copied().collect();
        self.recalc_with(&seeds, true)
    }

    fn record(&mut self, tx: Tx) {
        self.undo.push(tx);
        if self.undo.len() > HISTORY_LIMIT {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    fn do_shift(&mut self, s: Shift) -> (Dropped, Rewritten) {
        let limit = i64::from(if s.rows { MAX_ROWS } else { MAX_COLS });
        let moved = |a: Addr| -> Option<Addr> {
            let c = i64::from(if s.rows { a.row } else { a.col });
            let at = i64::from(s.at);
            let n = if s.delta >= 0 {
                if c >= at { c + s.delta } else { c }
            } else if c >= at && c < at - s.delta {
                return None;
            } else if c >= at - s.delta {
                c + s.delta
            } else {
                c
            };
            if n >= limit {
                return None;
            }
            Some(if s.rows { Addr { row: n as u32, ..a } } else { Addr { col: n as u32, ..a } })
        };
        self.unspill_all();
        let lost: HashMap<Addr, String> = self.formulas.iter().filter(|((sh, a), _)| *sh == s.sheet && moved(*a).is_none()).map(|((_, a), f)| (*a, f.text())).collect();
        let target = self.sheets[s.sheet].name.clone();
        let names = self.sheet_names();
        let mut rewritten = Vec::new();
        for ((sh, a), f) in self.formulas.iter_mut() {
            if let Some(e) = f.ast.as_mut() {
                let before = format!("={}", formula::to_text(e));
                if formula::shift_refs(e, &names[*sh], &target, s.rows, s.at, s.delta) {
                    rewritten.push((*sh, *a, before));
                }
            }
        }
        for (_, e) in self.names.values_mut() {
            formula::shift_refs(e, "\u{0}", &target, s.rows, s.at, s.delta);
        }
        self.graph.built = false;
        let values = self.sheets[s.sheet].cells.shift(s.rows, s.at, s.delta);
        let on_sheet: Vec<Key> = self.formulas.keys().filter(|(sh, _)| *sh == s.sheet).copied().collect();
        let mut moving = Vec::with_capacity(on_sheet.len());
        for k in on_sheet {
            if let Some(f) = self.formulas.remove(&k) {
                moving.push((k.1, f));
            }
        }
        for (a, f) in moving {
            if let Some(b) = moved(a) {
                self.formulas.insert((s.sheet, b), f);
            }
        }
        let dropped = values.into_iter().map(|(a, v)| (a, lost.get(&a).cloned().unwrap_or_else(|| self.shown(s.sheet, a, v).to_string()))).collect();
        let fmts: Vec<(Key, Fmt)> = self.fmts.iter().filter(|((sh, _), _)| *sh == s.sheet).map(|(k, f)| (*k, *f)).collect();
        for (k, _) in &fmts {
            self.fmts.remove(k);
        }
        for ((sh, a), f) in fmts {
            if let Some(b) = moved(a) {
                self.fmts.insert((sh, b), f);
            }
        }
        self.recalc_all();
        (dropped, rewritten)
    }

    fn rekey(&mut self, map: impl Fn(usize) -> Option<usize>) {
        let old = std::mem::take(&mut self.formulas);
        for ((s, a), f) in old {
            if let Some(n) = map(s) {
                self.formulas.insert((n, a), f);
            }
        }
        let old = std::mem::take(&mut self.fmts);
        for ((s, a), f) in old {
            if let Some(n) = map(s) {
                self.fmts.insert((n, a), f);
            }
        }
    }

    pub fn insert(&mut self, sheet: usize, rows: bool, at: u32, n: u32) -> Result<Shift, EngineError> {
        let limit = if rows { MAX_ROWS } else { MAX_COLS };
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        if n == 0 || at >= limit {
            return Err(EngineError::OutOfRange { row: at, col: n });
        }
        let shift = Shift { sheet, rows, at, delta: i64::from(n) };
        let (dropped, rewritten) = self.do_shift(shift);
        self.record(Tx::Shift { shift, dropped, rewritten });
        Ok(shift)
    }

    pub fn delete(&mut self, sheet: usize, rows: bool, at: u32, n: u32) -> Result<Shift, EngineError> {
        let limit = if rows { MAX_ROWS } else { MAX_COLS };
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        if n == 0 || at >= limit {
            return Err(EngineError::OutOfRange { row: at, col: n });
        }
        let n = n.min(limit - at);
        let shift = Shift { sheet, rows, at, delta: -i64::from(n) };
        let (dropped, rewritten) = self.do_shift(shift);
        self.record(Tx::Shift { shift, dropped, rewritten });
        Ok(shift)
    }

    pub fn delete_sheet(&mut self, sheet: usize) -> Result<(), EngineError> {
        if sheet >= self.sheets.len() || self.sheets.len() == 1 {
            return Err(EngineError::NoSheet(sheet));
        }
        self.unspill_all();
        self.sheets.remove(sheet);
        self.graph.built = false;
        self.rekey(|s| match s.cmp(&sheet) {
            std::cmp::Ordering::Less => Some(s),
            std::cmp::Ordering::Equal => None,
            std::cmp::Ordering::Greater => Some(s - 1),
        });
        self.clear_history();
        self.recalc_all();
        Ok(())
    }

    pub fn move_sheet(&mut self, from: usize, to: usize) -> Result<(), EngineError> {
        if from >= self.sheets.len() || to >= self.sheets.len() {
            return Err(EngineError::NoSheet(from.max(to)));
        }
        self.unspill_all();
        let s = self.sheets.remove(from);
        self.sheets.insert(to, s);
        self.graph.built = false;
        let mut order: Vec<usize> = (0..self.sheets.len()).collect();
        let m = order.remove(from);
        order.insert(to, m);
        self.rekey(|s| order.iter().position(|&o| o == s));
        self.clear_history();
        self.recalc_all();
        Ok(())
    }

    pub fn load(&mut self, sheet: usize, edits: &[(Addr, String)]) -> Result<usize, EngineError> {
        for (a, _) in edits {
            self.check(sheet, *a)?;
        }
        for (a, raw) in edits {
            self.set_raw(sheet, *a, raw);
        }
        self.recalc_all();
        Ok(edits.len())
    }

    pub fn clear_history(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    fn replay(&mut self, tx: &Tx, forward: bool) -> Effect {
        match tx {
            Tx::Cells(changes) => {
                let steps: Box<dyn Iterator<Item = &Change>> = if forward { Box::new(changes.iter()) } else { Box::new(changes.iter().rev()) };
                let mut seeds = Vec::with_capacity(changes.len());
                for c in steps {
                    let raw = if forward { &c.after } else { &c.before };
                    self.set_raw(c.sheet, c.addr, raw);
                    seeds.push((c.sheet, c.addr));
                }
                Effect { cells: self.recalc(&seeds), shift: None }
            }
            Tx::Shift { shift, dropped, rewritten } => {
                if forward {
                    self.do_shift(*shift);
                    return Effect { cells: Vec::new(), shift: Some(*shift) };
                }
                let back = Shift { delta: -shift.delta, ..*shift };
                self.do_shift(back);
                for (s, a, raw) in rewritten {
                    self.set_raw(*s, *a, raw);
                }
                for (a, raw) in dropped {
                    self.set_raw(shift.sheet, *a, raw);
                }
                self.recalc_all();
                let cells = dropped.iter().map(|(a, _)| (shift.sheet, *a, self.sheets[shift.sheet].cells.get(*a).cloned().unwrap_or(Value::Empty))).collect();
                Effect { cells, shift: Some(back) }
            }
        }
    }

    pub fn undo(&mut self) -> Option<Effect> {
        let tx = self.undo.pop()?;
        let out = self.replay(&tx, false);
        self.redo.push(tx);
        Some(Effect { cells: self.present(out.cells), shift: out.shift })
    }

    pub fn redo(&mut self) -> Option<Effect> {
        let tx = self.redo.pop()?;
        let out = self.replay(&tx, true);
        self.undo.push(tx);
        Some(Effect { cells: self.present(out.cells), shift: out.shift })
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn get(&self, sheet: usize, addr: Addr) -> Result<Value, EngineError> {
        self.check(sheet, addr)?;
        Ok(self.shown(sheet, addr, self.sheets[sheet].cells.get(addr).cloned().unwrap_or(Value::Empty)))
    }

    pub fn value(&self, sheet: usize, addr: Addr) -> Result<Value, EngineError> {
        self.check(sheet, addr)?;
        Ok(self.sheets[sheet].cells.get(addr).cloned().unwrap_or(Value::Empty))
    }

    pub fn read(&self, sheet: usize, top: Addr, bottom: Addr) -> Result<Vec<(Addr, Value)>, EngineError> {
        self.check(sheet, top)?;
        self.check(sheet, bottom)?;
        let mut out = Vec::new();
        self.sheets[sheet].cells.for_each_in(top, bottom, |a, v| out.push((a, self.shown(sheet, a, v.clone()))));
        Ok(out)
    }

    pub fn extent(&self, sheet: usize) -> Result<Option<Addr>, EngineError> {
        self.sheets.get(sheet).map(|s| s.cells.extent()).ok_or(EngineError::NoSheet(sheet))
    }

    pub fn edge(&self, sheet: usize, from: Addr, dir: Dir) -> Result<Addr, EngineError> {
        self.check(sheet, from)?;
        Ok(self.sheets[sheet].cells.edge(from, dir))
    }

    pub fn cell_count(&self, sheet: usize) -> Result<usize, EngineError> {
        self.sheets.get(sheet).map(Sheet::len).ok_or(EngineError::NoSheet(sheet))
    }
}
