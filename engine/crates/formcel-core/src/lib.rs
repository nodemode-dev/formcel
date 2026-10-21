use std::fmt;

mod store;
pub mod wire;
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
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    write!(f, "{}", *n as i64)
                } else {
                    write!(f, "{}", n)
                }
            }
            Value::Text(s) => f.write_str(s),
            Value::Bool(b) => f.write_str(if *b { "TRUE" } else { "FALSE" }),
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
    before: Value,
    after: Value,
}

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
    Shift { shift: Shift, dropped: Vec<(Addr, Value)> },
}

#[derive(Debug)]
pub struct Workbook {
    sheets: Vec<Sheet>,
    undo: Vec<Tx>,
    redo: Vec<Tx>,
}

impl Default for Workbook {
    fn default() -> Self {
        Self::new()
    }
}

impl Workbook {
    pub fn new() -> Self {
        Workbook { sheets: vec![Sheet::new("Sheet1")], undo: Vec::new(), redo: Vec::new() }
    }

    pub fn sheet_count(&self) -> usize {
        self.sheets.len()
    }

    pub fn sheet_names(&self) -> Vec<String> {
        self.sheets.iter().map(|s| s.name.clone()).collect()
    }

    pub fn add_sheet(&mut self, name: &str) -> usize {
        self.sheets.push(Sheet::new(name));
        self.sheets.len() - 1
    }

    pub fn rename_sheet(&mut self, sheet: usize, name: &str) -> Result<(), EngineError> {
        let s = self.sheets.get_mut(sheet).ok_or(EngineError::NoSheet(sheet))?;
        s.name = name.to_string();
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
        let mut out = Vec::with_capacity(edits.len());
        for (a, raw) in edits {
            let after = Value::parse_input(raw);
            let before = self.sheets[sheet].cells.set(*a, after.clone());
            if before != after {
                tx.push(Change { sheet, addr: *a, before, after: after.clone() });
            }
            out.push((sheet, *a, after));
        }
        if !tx.is_empty() {
            self.record(Tx::Cells(tx));
        }
        Ok(out)
    }

    fn record(&mut self, tx: Tx) {
        self.undo.push(tx);
        if self.undo.len() > HISTORY_LIMIT {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    fn do_shift(&mut self, s: Shift) -> Vec<(Addr, Value)> {
        self.sheets[s.sheet].cells.shift(s.rows, s.at, s.delta)
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
        let dropped = self.do_shift(shift);
        self.record(Tx::Shift { shift, dropped });
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
        let dropped = self.do_shift(shift);
        self.record(Tx::Shift { shift, dropped });
        Ok(shift)
    }

    pub fn delete_sheet(&mut self, sheet: usize) -> Result<(), EngineError> {
        if sheet >= self.sheets.len() || self.sheets.len() == 1 {
            return Err(EngineError::NoSheet(sheet));
        }
        self.sheets.remove(sheet);
        self.clear_history();
        Ok(())
    }

    pub fn move_sheet(&mut self, from: usize, to: usize) -> Result<(), EngineError> {
        if from >= self.sheets.len() || to >= self.sheets.len() {
            return Err(EngineError::NoSheet(from.max(to)));
        }
        let s = self.sheets.remove(from);
        self.sheets.insert(to, s);
        self.clear_history();
        Ok(())
    }

    pub fn load(&mut self, sheet: usize, edits: &[(Addr, String)]) -> Result<usize, EngineError> {
        for (a, _) in edits {
            self.check(sheet, *a)?;
        }
        for (a, raw) in edits {
            self.sheets[sheet].cells.set(*a, Value::parse_input(raw));
        }
        Ok(edits.len())
    }

    pub fn clear_history(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    fn replay(&mut self, tx: &Tx, forward: bool) -> Effect {
        match tx {
            Tx::Cells(changes) => {
                let mut cells = Vec::with_capacity(changes.len());
                let steps: Box<dyn Iterator<Item = &Change>> = if forward { Box::new(changes.iter()) } else { Box::new(changes.iter().rev()) };
                for c in steps {
                    let v = if forward { c.after.clone() } else { c.before.clone() };
                    self.sheets[c.sheet].cells.set(c.addr, v.clone());
                    cells.push((c.sheet, c.addr, v));
                }
                Effect { cells, shift: None }
            }
            Tx::Shift { shift, dropped } => {
                if forward {
                    self.do_shift(*shift);
                    return Effect { cells: Vec::new(), shift: Some(*shift) };
                }
                let back = Shift { delta: -shift.delta, ..*shift };
                self.do_shift(back);
                let mut cells = Vec::with_capacity(dropped.len());
                for (a, v) in dropped {
                    self.sheets[shift.sheet].cells.set(*a, v.clone());
                    cells.push((shift.sheet, *a, v.clone()));
                }
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
