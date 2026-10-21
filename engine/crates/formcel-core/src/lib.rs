use graph::{FastMap, FastSet};
use std::collections::{HashMap, VecDeque};
use std::fmt;

pub mod eval;
pub mod formula;
mod graph;
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
        let t = raw.trim();
        if t.is_empty() {
            return Value::Empty;
        }
        match t.to_ascii_uppercase().as_str() {
            "TRUE" => return Value::Bool(true),
            "FALSE" => return Value::Bool(false),
            _ => {}
        }
        match t.replace(',', "").parse::<f64>() {
            Ok(n) if n.is_finite() => Value::Number(n),
            _ => Value::Text(raw.to_string()),
        }
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
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::BadAddress(a) => write!(f, "not a cell address: {a}"),
            EngineError::OutOfRange { row, col } => write!(f, "cell outside the grid: row {row}, column {col}"),
            EngineError::NoSheet(i) => write!(f, "no sheet at index {i}"),
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
}

impl Formula {
    fn new(raw: &str) -> Formula {
        let body = raw.trim_start().strip_prefix('=').unwrap_or(raw);
        Formula { ast: formula::parse(body), src: body.to_string() }
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
}

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
}

impl Default for Workbook {
    fn default() -> Self {
        Self::new()
    }
}

impl Workbook {
    pub fn new() -> Self {
        Workbook { sheets: vec![Sheet::new("Sheet1")], undo: Vec::new(), redo: Vec::new(), formulas: FastMap::default(), graph: graph::Graph::default() }
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
        Ok(self.recalc(&seeds))
    }

    pub fn input(&self, sheet: usize, a: Addr) -> String {
        if let Some(f) = self.formulas.get(&(sheet, a)) {
            return f.text();
        }
        self.sheets.get(sheet).and_then(|s| s.cells.get(a)).map(Value::to_string).unwrap_or_default()
    }

    pub fn formula_text(&self, sheet: usize, a: Addr) -> Option<String> {
        self.formulas.get(&(sheet, a)).map(Formula::text)
    }

    pub fn inputs(&self, sheet: usize) -> Result<Vec<(Addr, String)>, EngineError> {
        let s = self.sheets.get(sheet).ok_or(EngineError::NoSheet(sheet))?;
        let mut out = Vec::with_capacity(s.len());
        if let Some(bottom) = s.cells.extent() {
            s.cells.for_each_in(Addr { row: 0, col: 0 }, bottom, |a, v| {
                let text = self.formulas.get(&(sheet, a)).map_or_else(|| v.to_string(), Formula::text);
                out.push((a, text));
            });
        }
        Ok(out)
    }

    fn set_raw(&mut self, sheet: usize, a: Addr, raw: &str) {
        let k = (sheet, a);
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
            self.sheets[sheet].cells.set(a, Value::parse_input(raw));
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
            formula::refs(e, &mut |s, area| {
                let idx = match s {
                    None => Some(k.0),
                    Some(n) => self.sheet_by_name(n),
                };
                if let Some(i) = idx {
                    out.push((i, area));
                }
            });
        }
        out
    }

    fn recalc(&mut self, seeds: &[Key]) -> Changed {
        self.recalc_with(seeds, false)
    }

    fn recalc_with(&mut self, seeds: &[Key], everything: bool) -> Changed {
        self.ensure_graph();
        let mut dirty: FastSet<Key> = FastSet::default();
        if everything {
            dirty.extend(self.formulas.keys().copied());
        } else {
            let mut queue: VecDeque<Key> = seeds.iter().copied().collect();
            for k in seeds {
                if self.formulas.contains_key(k) {
                    dirty.insert(*k);
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
            let v = match &self.formulas[&(s, a)].ast {
                None => Value::Error(ErrKind::Error),
                Some(e) => eval::Eval { ctx: &*self, sheet: s }.formula(e),
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
        let dropped = values.into_iter().map(|(a, v)| (a, lost.get(&a).cloned().unwrap_or_else(|| v.to_string()))).collect();
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
        Some(out)
    }

    pub fn redo(&mut self) -> Option<Effect> {
        let tx = self.redo.pop()?;
        let out = self.replay(&tx, true);
        self.undo.push(tx);
        Some(out)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn get(&self, sheet: usize, addr: Addr) -> Result<Value, EngineError> {
        self.check(sheet, addr)?;
        Ok(self.sheets[sheet].cells.get(addr).cloned().unwrap_or(Value::Empty))
    }

    pub fn read(&self, sheet: usize, top: Addr, bottom: Addr) -> Result<Vec<(Addr, Value)>, EngineError> {
        self.check(sheet, top)?;
        self.check(sheet, bottom)?;
        let mut out = Vec::new();
        self.sheets[sheet].cells.for_each_in(top, bottom, |a, v| out.push((a, v.clone())));
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
