use graph::{FastMap, FastSet};
use std::collections::{HashMap, VecDeque};
use std::fmt;

pub mod cf;
pub mod eval;
pub mod link;
pub mod formula;
mod graph;
pub mod fmtcode;
pub mod numfmt;
pub use numfmt::Fmt;
mod store;
pub mod style;
pub mod theme;
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
        if let Some(rest) = raw.strip_prefix('\'') {
            return if rest.is_empty() { Value::Empty } else { Value::Text(rest.to_string()) };
        }
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
    BadFormat(String),
    BadStyle(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::BadAddress(a) => write!(f, "not a cell address: {a}"),
            EngineError::OutOfRange { row, col } => write!(f, "cell outside the grid: row {row}, column {col}"),
            EngineError::NoSheet(i) => write!(f, "no sheet at index {i}"),
            EngineError::BadName(n) => write!(f, "not a valid name: {n}"),
            EngineError::BadFormula(s) => write!(f, "not a valid formula: {s}"),
            EngineError::BadFormat(s) => write!(f, "not a valid number format: {s}"),
            EngineError::BadStyle(s) => write!(f, "not a valid cell style: {s}"),
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
    merges: Vec<Area>,
    rules: Vec<cf::Rule>,
}

impl Sheet {
    pub fn new(name: &str) -> Self {
        Sheet { name: name.to_string(), cells: Store::default(), merges: Vec::new(), rules: Vec::new() }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MergeMode {
    Center,
    Across,
    Cells,
    Unmerge,
}

fn shift_area(m: Area, s: Shift) -> Option<Area> {
    shift_span(m, s).filter(|out| out.r0 < out.r1 || out.c0 < out.c1)
}

fn shift_span(m: Area, s: Shift) -> Option<Area> {
    let (a0, a1) = if s.rows { (m.r0, m.r1) } else { (m.c0, m.c1) };
    let (a0, a1, at) = (i64::from(a0), i64::from(a1), i64::from(s.at));
    let limit = i64::from(if s.rows { MAX_ROWS } else { MAX_COLS }) - 1;
    let (n0, n1) = if s.delta >= 0 {
        (if a0 >= at { a0 + s.delta } else { a0 }, if a1 >= at { a1 + s.delta } else { a1 })
    } else {
        let end = at - s.delta;
        let map = |x: i64| if x >= end { x + s.delta } else if x >= at { at } else { x };
        let lo = map(a0);
        let hi = if a1 >= at && a1 < end { at - 1 } else { map(a1) };
        if hi < lo {
            return None;
        }
        (lo, hi)
    };
    if n0 > limit {
        return None;
    }
    let n1 = n1.min(limit);
    Some(if s.rows { Area { r0: n0 as u32, r1: n1 as u32, ..m } } else { Area { c0: n0 as u32, c1: n1 as u32, ..m } })
}

#[derive(Clone, Debug, Default)]
struct Lost {
    codes: Vec<(Key, Option<String>, Option<String>)>,
    styles: Vec<(Key, Option<String>, Option<String>)>,
    merges: Vec<Area>,
    rules: Vec<cf::Rule>,
    links: Vec<(Key, Option<String>, Option<String>)>,
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
    pub formats: Vec<(usize, Addr, String)>,
    pub styles: Vec<(usize, Addr, String)>,
    pub merges: Option<usize>,
    pub theme: bool,
    pub named: bool,
    pub rules: Option<usize>,
}

impl Effect {
    fn join(mut self, o: Effect) -> Effect {
        self.rules = o.rules.or(self.rules);
        self.theme |= o.theme;
        self.named |= o.named;
        self.cells.extend(o.cells);
        self.shift = o.shift.or(self.shift);
        self.formats.extend(o.formats);
        self.styles.extend(o.styles);
        self.merges = o.merges.or(self.merges);
        self
    }
}

type FormatChange = (Key, Option<String>, Option<String>);
type StyleRef = std::sync::Arc<(String, style::Style)>;

const FORMAT_LIMIT: u64 = 1_000_000;

#[derive(Clone, Debug)]
enum Tx {
    Cells(Vec<Change>),
    Shift { shift: Shift, dropped: Vec<(Addr, String)>, rewritten: Vec<(usize, Addr, String)>, lost: Box<Lost> },
    Formats(Vec<FormatChange>),
    Styles(Vec<FormatChange>),
    Merges { sheet: usize, before: Vec<Area>, after: Vec<Area> },
    Group(Vec<Tx>),
    Theme { before: Box<theme::Theme>, after: Box<theme::Theme> },
    Named { before: Vec<theme::NamedStyle>, after: Vec<theme::NamedStyle> },
    Rules { sheet: usize, before: Vec<cf::Rule>, after: Vec<cf::Rule> },
    Links(Vec<FormatChange>),
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
    codes: FastMap<Key, std::sync::Arc<(String, fmtcode::Code)>>,
    styles: FastMap<Key, StyleRef>,
    theme: theme::Theme,
    named: Vec<theme::NamedStyle>,
    named_codes: FastMap<String, std::sync::Arc<(String, fmtcode::Code)>>,
    links: FastMap<Key, String>,
    link_log: Vec<(usize, Addr, String)>,
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
            codes: FastMap::default(),
            styles: FastMap::default(),
            theme: theme::Theme::default(),
            named: theme::builtin_styles(),
            named_codes: FastMap::default(),
            links: FastMap::default(),
            link_log: Vec::new(),
        }
        .with_named_codes()
    }

    fn with_named_codes(mut self) -> Self {
        self.rebuild_named_codes();
        self
    }

    fn rebuild_named_codes(&mut self) {
        self.named_codes = self.named.iter().filter_map(|n| n.code.as_ref().and_then(|c| fmtcode::parse(c).map(|p| (n.name.clone(), std::sync::Arc::new((c.clone(), p)))))).collect();
    }

    pub fn theme_text(&self) -> String {
        self.theme.text()
    }

    pub fn theme_names() -> Vec<&'static str> {
        theme::Theme::names()
    }

    pub fn load_theme(&mut self, text: &str) -> bool {
        match theme::Theme::parse(text) {
            Some(t) => {
                self.theme = t;
                true
            }
            None => false,
        }
    }

    pub fn set_theme(&mut self, text: &str) -> Result<Effect, EngineError> {
        let t = theme::Theme::parse(text).ok_or_else(|| EngineError::BadStyle(text.to_string()))?;
        if t != self.theme {
            let before = std::mem::replace(&mut self.theme, t.clone());
            self.record(Tx::Theme { before: Box::new(before), after: Box::new(t) });
        }
        Ok(Effect { theme: true, ..Effect::default() })
    }

    pub fn named_lines(&self) -> Vec<String> {
        self.named.iter().map(|n| n.line()).collect()
    }

    pub fn load_named(&mut self, lines: &[String]) {
        let list: Vec<theme::NamedStyle> = lines.iter().filter_map(|l| theme::NamedStyle::parse_line(l)).collect();
        if !list.is_empty() {
            self.named = list;
            self.rebuild_named_codes();
        }
    }

    fn set_named(&mut self, after: Vec<theme::NamedStyle>) {
        let before = std::mem::replace(&mut self.named, after.clone());
        self.rebuild_named_codes();
        self.record(Tx::Named { before, after });
    }

    pub fn values_in(&self, sheet: usize, top: Addr, bottom: Addr) -> Vec<(Addr, String)> {
        let mut out = Vec::new();
        if let Some(s) = self.sheets.get(sheet) {
            s.cells.for_each_in(top, bottom, |a, v| out.push((a, if matches!(v, Value::Text(_)) { format!("'{v}") } else { v.to_string() })));
        }
        out
    }

    pub fn encode(&self, e: &Effect) -> String {
        wire::encode_effect(e, &|s, a| self.meta(s, a), &|s, a| self.effective_style(s, a).text())
    }

    pub fn shown_styles_in(&self, sheet: usize, top: Addr, bottom: Addr) -> Vec<(Addr, String)> {
        self.styles_in(sheet, top, bottom).into_iter().map(|(a, _)| (a, self.effective_style(sheet, a).text())).collect()
    }

    pub fn effective_style(&self, sheet: usize, a: Addr) -> style::Style {
        let own = self.styles.get(&(sheet, a)).map(|s| s.1.clone()).unwrap_or_default();
        match own.named.as_ref().and_then(|n| self.named.iter().find(|d| &d.name == n)) {
            Some(d) => {
                let mut e = d.style.overlay(&own);
                e.named = own.named.clone();
                e
            }
            None => own,
        }
    }

    pub fn define_style(&mut self, name: &str, sheet: usize, a: Addr, cats: &str) -> Result<Effect, EngineError> {
        self.check(sheet, a)?;
        let name = style::clean_name(name);
        if name.is_empty() || name.eq_ignore_ascii_case("Normal") {
            return Err(EngineError::BadStyle(name));
        }
        let st = self.effective_style(sheet, a);
        let code = self.code_of(&(sheet, a)).map(|c| c.0.clone()).unwrap_or_default();
        let cats = style::Cats::parse(cats);
        let mut keep = style::Style::default();
        keep = keep.overlay(&st);
        let mut drop = style::Cats::ALL;
        drop.number = false;
        for (on, c) in [(cats.font, &mut drop.font), (cats.alignment, &mut drop.alignment), (cats.border, &mut drop.border), (cats.fill, &mut drop.fill)] {
            if on {
                *c = false;
            }
        }
        keep.clear(drop);
        keep.normalize();
        let mut after = self.named.clone();
        let def = theme::NamedStyle { name: name.clone(), style: keep, code: (cats.number && !code.is_empty()).then(|| code.to_string()), cats, builtin: false };
        match after.iter_mut().find(|n| n.name.eq_ignore_ascii_case(&name)) {
            Some(n) => {
                let builtin = n.builtin;
                *n = theme::NamedStyle { builtin, ..def };
            }
            None => after.push(def),
        }
        self.set_named(after);
        Ok(Effect { named: true, ..Effect::default() })
    }

    pub fn delete_style(&mut self, name: &str) -> Result<Effect, EngineError> {
        if name.eq_ignore_ascii_case("Normal") || !self.named.iter().any(|n| n.name == name) {
            return Err(EngineError::BadStyle(name.to_string()));
        }
        let mark = self.undo.len();
        let mut changes = Vec::new();
        for (k, st) in &self.styles {
            if st.1.named.as_deref() == Some(name) {
                let mut s = st.1.clone();
                s.named = None;
                s.normalize();
                changes.push((*k, Some(st.0.clone()), (!s.is_plain()).then(|| s.text())));
            }
        }
        let mut out = self.apply_styles(&changes, true);
        if !changes.is_empty() {
            self.record(Tx::Styles(changes));
        }
        let after: Vec<theme::NamedStyle> = self.named.iter().filter(|n| n.name != name).cloned().collect();
        self.set_named(after);
        out.named = true;
        self.group_since(mark);
        Ok(out)
    }

    pub fn apply_style(&mut self, sheet: usize, top: Addr, bottom: Addr, name: &str) -> Result<Effect, EngineError> {
        let def = self.named.iter().find(|n| n.name == name).cloned().ok_or_else(|| EngineError::BadStyle(name.to_string()))?;
        let normal = def.name == "Normal";
        let (r0, r1, c0, c1) = self.clip(sheet, top, bottom);
        let mut items = Vec::new();
        for r in r0..=r1 {
            for c in c0..=c1 {
                let k = (sheet, Addr { row: r, col: c });
                let mut st = self.styles.get(&k).map(|s| s.1.clone()).unwrap_or_default();
                st.clear(if normal { style::Cats::ALL } else { def.cats });
                st.named = (!normal).then(|| def.name.clone());
                st.normalize();
                let code = if def.cats.number || normal { None } else { self.codes.get(&k).map(|c| c.0.clone()) };
                items.push((k.1, Some(st.text()), Some(code.unwrap_or_default())));
            }
        }
        self.put_formats(sheet, &items)
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
        let mark = self.undo.len();
        let edited: Vec<Addr> = tx.iter().map(|c| c.addr).collect();
        if !tx.is_empty() {
            self.record(Tx::Cells(tx));
        }
        let changed = self.recalc(&seeds);
        self.auto_links(sheet, &edited);
        self.group_since(mark);
        Ok(self.present(changed))
    }

    pub fn fmt(&self, sheet: usize, a: Addr) -> Option<Fmt> {
        self.fmts.get(&(sheet, a)).copied()
    }

    fn code_of(&self, k: &Key) -> Option<&std::sync::Arc<(String, fmtcode::Code)>> {
        self.codes.get(k).or_else(|| {
            if self.named_codes.is_empty() {
                return None;
            }
            self.styles.get(k).and_then(|s| s.1.named.as_ref()).and_then(|n| self.named_codes.get(n))
        })
    }

    fn shown(&self, sheet: usize, a: Addr, v: Value) -> Value {
        if let Some(c) = self.code_of(&(sheet, a)) {
            if matches!(v, Value::Number(_) | Value::Text(_)) {
                if let Some((s, _)) = c.1.render(&v) {
                    return Value::Text(s);
                }
            }
            return v;
        }
        match (&v, self.fmts.get(&(sheet, a))) {
            (Value::Number(n), Some(f)) => numfmt::show(*n, *f).map_or(v, Value::Text),
            _ => v,
        }
    }

    fn const_text(&self, sheet: usize, a: Addr, v: &Value) -> String {
        let Some(c) = self.code_of(&(sheet, a)) else {
            if let Value::Text(s) = v {
                if s.starts_with('\'') || !matches!(Value::parse_input(s), Value::Text(_)) {
                    return format!("'{s}");
                }
            }
            return self.shown(sheet, a, v.clone()).to_string();
        };
        let Value::Number(n) = v else { return v.to_string() };
        let n = *n;
        let as_fmt = match c.1.class() {
            fmtcode::Class::Date if n.fract() == 0.0 => Some(Fmt::Date),
            fmtcode::Class::Date | fmtcode::Class::DateTime => Some(if n.fract() == 0.0 { Fmt::Date } else { Fmt::DateTime { secs: true, ampm: true } }),
            fmtcode::Class::Time => Some(Fmt::Time { secs: true, ampm: true }),
            fmtcode::Class::Percent => return format!("{}%", Value::Number(eval::sig15(n * 100.0))),
            _ => None,
        };
        as_fmt.and_then(|f| numfmt::show(n, f)).unwrap_or_else(|| v.to_string())
    }

    pub fn meta(&self, sheet: usize, a: Addr) -> wire::Meta {
        let v = self.sheets.get(sheet).and_then(|s| s.cells.get(a));
        let num = matches!(v, Some(Value::Number(_)));
        let code = self.code_of(&(sheet, a));
        let quoted = matches!(v, Some(Value::Text(s)) if s.starts_with('\'') || !matches!(Value::parse_input(s), Value::Text(_)));
        let raw = self.formula_text(sheet, a).or_else(|| ((code.is_some() || quoted) && !self.spilled.contains_key(&(sheet, a))).then(|| self.input(sheet, a)).filter(|s| !s.is_empty()));
        let color = code.zip(v).and_then(|(c, v)| c.1.render(v)).and_then(|(_, col)| col).map(fmtcode::Color::rgb);
        (raw, num, color, self.has_link(sheet, a))
    }

    pub fn format_code(&self, sheet: usize, a: Addr) -> Option<String> {
        self.codes.get(&(sheet, a)).map(|c| c.0.clone())
    }

    pub fn formats(&self, sheet: usize) -> Vec<(Addr, String)> {
        let mut out: Vec<(Addr, String)> = self.codes.iter().filter(|((s, _), _)| *s == sheet).map(|((_, a), c)| (*a, c.0.clone())).collect();
        out.sort_by_key(|(a, _)| (a.row, a.col));
        out
    }

    pub fn load_formats(&mut self, sheet: usize, cells: &[(Addr, String)]) -> Result<usize, EngineError> {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        let mut n = 0;
        for (a, code) in cells {
            let k = (sheet, *a);
            if code.is_empty() {
                self.codes.remove(&k);
            } else if let Some(c) = fmtcode::parse(code) {
                self.codes.insert(k, std::sync::Arc::new((code.clone(), c)));
                n += 1;
            }
        }
        Ok(n)
    }

    pub fn set_format(&mut self, sheet: usize, top: Addr, bottom: Addr, code: &str) -> Result<Effect, EngineError> {
        self.check(sheet, top)?;
        self.check(sheet, bottom)?;
        let code = code.trim();
        let new = if code.is_empty() || code.eq_ignore_ascii_case("General") { None } else { Some(code.to_string()) };
        if let Some(c) = &new {
            fmtcode::parse(c).ok_or_else(|| EngineError::BadFormat(c.clone()))?;
        }
        let (r0, r1, c0, mut c1) = (top.row.min(bottom.row), top.row.max(bottom.row), top.col.min(bottom.col), top.col.max(bottom.col));
        let mut r1 = r1;
        if u64::from(r1 - r0 + 1) * u64::from(c1 - c0 + 1) > FORMAT_LIMIT {
            let e = self.sheets[sheet].cells.extent().unwrap_or(Addr { row: 0, col: 0 });
            r1 = r1.min(e.row.max(r0 + 999));
            c1 = c1.min(e.col.max(c0 + 25));
            let width = u64::from(c1 - c0 + 1);
            if u64::from(r1 - r0 + 1) * width > FORMAT_LIMIT {
                r1 = r0 + (FORMAT_LIMIT / width) as u32 - 1;
            }
        }
        let mut changes = Vec::new();
        for r in r0..=r1 {
            for c in c0..=c1 {
                let k = (sheet, Addr { row: r, col: c });
                let before = self.codes.get(&k).map(|x| x.0.clone());
                if before != new {
                    changes.push((k, before, new.clone()));
                }
            }
        }
        let eff = self.apply_formats(&changes, true);
        if !changes.is_empty() {
            self.record(Tx::Formats(changes));
        }
        Ok(Effect { cells: self.present(eff.cells), ..eff })
    }

    fn apply_formats(&mut self, changes: &[FormatChange], forward: bool) -> Effect {
        let mut cells = Vec::new();
        let mut formats = Vec::with_capacity(changes.len());
        let mut parsed: Vec<std::sync::Arc<(String, fmtcode::Code)>> = Vec::new();
        for (k, before, after) in changes {
            let to = if forward { after } else { before };
            let entry = to.as_ref().and_then(|c| match parsed.iter().find(|p| &p.0 == c) {
                Some(p) => Some(p.clone()),
                None => fmtcode::parse(c).map(|p| {
                    let arc = std::sync::Arc::new((c.clone(), p));
                    parsed.push(arc.clone());
                    arc
                }),
            });
            match entry {
                Some(arc) => {
                    self.codes.insert(*k, arc);
                }
                None => {
                    self.codes.remove(k);
                }
            }
            formats.push((k.0, k.1, to.clone().unwrap_or_default()));
            if let Some(v) = self.sheets[k.0].cells.get(k.1) {
                cells.push((k.0, k.1, v.clone()));
            }
        }
        Effect { cells, formats, ..Effect::default() }
    }

    pub fn style_text(&self, sheet: usize, a: Addr) -> Option<String> {
        self.styles.get(&(sheet, a)).map(|s| s.0.clone())
    }

    pub fn styles(&self, sheet: usize) -> Vec<(Addr, String)> {
        let mut out: Vec<(Addr, String)> = self.styles.iter().filter(|((s, _), _)| *s == sheet).map(|((_, a), st)| (*a, st.0.clone())).collect();
        out.sort_by_key(|(a, _)| (a.row, a.col));
        out
    }

    pub fn styles_in(&self, sheet: usize, top: Addr, bottom: Addr) -> Vec<(Addr, String)> {
        let mut out: Vec<(Addr, String)> = self
            .styles
            .iter()
            .filter(|((s, a), _)| *s == sheet && a.row >= top.row && a.row <= bottom.row && a.col >= top.col && a.col <= bottom.col)
            .map(|((_, a), st)| (*a, st.0.clone()))
            .collect();
        out.sort_by_key(|(a, _)| (a.row, a.col));
        out
    }

    pub fn load_styles(&mut self, sheet: usize, cells: &[(Addr, String)]) -> Result<usize, EngineError> {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        let mut n = 0;
        for (a, text) in cells {
            match style::Style::parse(text).filter(|s| !s.is_plain()) {
                Some(st) => {
                    self.styles.insert((sheet, *a), std::sync::Arc::new((st.text(), st)));
                    n += 1;
                }
                None => {
                    self.styles.remove(&(sheet, *a));
                }
            }
        }
        Ok(n)
    }

    fn clip(&self, sheet: usize, top: Addr, bottom: Addr) -> (u32, u32, u32, u32) {
        let (r0, mut r1, c0, mut c1) = (top.row.min(bottom.row), top.row.max(bottom.row), top.col.min(bottom.col), top.col.max(bottom.col));
        if u64::from(r1 - r0 + 1) * u64::from(c1 - c0 + 1) > FORMAT_LIMIT {
            let e = self.sheets[sheet].cells.extent().unwrap_or(Addr { row: 0, col: 0 });
            r1 = r1.min(e.row.max(r0 + 999));
            c1 = c1.min(e.col.max(c0 + 25));
            let width = u64::from(c1 - c0 + 1);
            if u64::from(r1 - r0 + 1) * width > FORMAT_LIMIT {
                r1 = r0 + (FORMAT_LIMIT / width) as u32 - 1;
            }
        }
        (r0, r1, c0, c1)
    }

    pub fn set_styles(&mut self, sheet: usize, ops: &[(Addr, Addr, String)]) -> Result<Effect, EngineError> {
        let mut work: FastMap<Key, style::Style> = FastMap::default();
        let mut order: Vec<Key> = Vec::new();
        for (top, bottom, patch) in ops {
            self.check(sheet, *top)?;
            self.check(sheet, *bottom)?;
            style::Style::parse(patch).ok_or_else(|| EngineError::BadStyle(patch.clone()))?;
            let (r0, r1, c0, c1) = self.clip(sheet, *top, *bottom);
            for r in r0..=r1 {
                for c in c0..=c1 {
                    let k = (sheet, Addr { row: r, col: c });
                    let st = work.entry(k).or_insert_with(|| {
                        order.push(k);
                        self.styles.get(&k).map(|s| s.1.clone()).unwrap_or_default()
                    });
                    st.apply(patch);
                }
            }
        }
        let mut changes = Vec::new();
        for k in order {
            let before = self.styles.get(&k).map(|s| s.0.clone());
            let mut st = work[&k].clone();
            st.normalize();
            let after = (!st.is_plain()).then(|| st.text());
            if before != after {
                changes.push((k, before, after));
            }
        }
        let eff = self.apply_styles(&changes, true);
        if !changes.is_empty() {
            self.record(Tx::Styles(changes));
        }
        Ok(eff)
    }

    fn apply_styles(&mut self, changes: &[FormatChange], forward: bool) -> Effect {
        let mut styles = Vec::with_capacity(changes.len());
        let mut parsed: Vec<StyleRef> = Vec::new();
        for (k, before, after) in changes {
            let to = if forward { after } else { before };
            let entry = to.as_ref().and_then(|t| match parsed.iter().find(|p| &p.0 == t) {
                Some(p) => Some(p.clone()),
                None => style::Style::parse(t).map(|st| {
                    let arc = std::sync::Arc::new((t.clone(), st));
                    parsed.push(arc.clone());
                    arc
                }),
            });
            match entry {
                Some(arc) => {
                    self.styles.insert(*k, arc);
                }
                None => {
                    self.styles.remove(k);
                }
            }
            styles.push((k.0, k.1, to.clone().unwrap_or_default()));
        }
        Effect { styles, ..Effect::default() }
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
            Some(v) => self.const_text(sheet, a, v),
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
                let text = self.formulas.get(&(sheet, a)).map_or_else(|| self.const_text(sheet, a, v), Formula::text);
                out.push((a, text));
            });
        }
        Ok(out)
    }

    fn set_raw(&mut self, sheet: usize, a: Addr, raw: &str) {
        let k = (sheet, a);
        self.spilled.remove(&k);
        let as_text = self.code_of(&k).is_some_and(|c| c.1.class() == fmtcode::Class::Text);
        if as_text {
            if self.formulas.remove(&k).is_some() {
                self.graph.remove(&k);
            }
            self.fmts.remove(&k);
            self.sheets[sheet].cells.set(a, if raw.is_empty() { Value::Empty } else { Value::Text(raw.to_string()) });
        } else if is_formula(raw) {
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

    fn do_shift(&mut self, s: Shift) -> (Dropped, Rewritten, Lost) {
        let mut lost_fmt = Lost { merges: self.sheets[s.sheet].merges.clone(), rules: self.sheets[s.sheet].rules.clone(), ..Lost::default() };
        let merges = std::mem::take(&mut self.sheets[s.sheet].merges);
        self.sheets[s.sheet].merges = merges.into_iter().filter_map(|m| shift_area(m, s)).collect();
        let rules = std::mem::take(&mut self.sheets[s.sheet].rules);
        self.sheets[s.sheet].rules = rules.into_iter().filter_map(|r| shift_span(r.area, s).map(|area| cf::Rule { area, ..r })).collect();
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
        let dropped = values.into_iter().map(|(a, v)| (a, lost.get(&a).cloned().unwrap_or_else(|| self.const_text(s.sheet, a, &v)))).collect();
        let fmts: Vec<(Key, Fmt)> = self.fmts.iter().filter(|((sh, _), _)| *sh == s.sheet).map(|(k, f)| (*k, *f)).collect();
        for (k, _) in &fmts {
            self.fmts.remove(k);
        }
        for ((sh, a), f) in fmts {
            if let Some(b) = moved(a) {
                self.fmts.insert((sh, b), f);
            }
        }
        let codes: Vec<(Key, std::sync::Arc<(String, fmtcode::Code)>)> = self.codes.iter().filter(|((sh, _), _)| *sh == s.sheet).map(|(k, c)| (*k, c.clone())).collect();
        for (k, _) in &codes {
            self.codes.remove(k);
        }
        for ((sh, a), c) in codes {
            match moved(a) {
                Some(b) => {
                    self.codes.insert((sh, b), c);
                }
                None => lost_fmt.codes.push(((sh, a), Some(c.0.clone()), None)),
            }
        }
        let styles: Vec<(Key, StyleRef)> = self.styles.iter().filter(|((sh, _), _)| *sh == s.sheet).map(|(k, st)| (*k, st.clone())).collect();
        for (k, _) in &styles {
            self.styles.remove(k);
        }
        for ((sh, a), st) in styles {
            match moved(a) {
                Some(b) => {
                    self.styles.insert((sh, b), st);
                }
                None => lost_fmt.styles.push(((sh, a), Some(st.0.clone()), None)),
            }
        }
        let links: Vec<(Key, String)> = self.links.iter().filter(|((sh, _), _)| *sh == s.sheet).map(|(k, t)| (*k, t.clone())).collect();
        for (k, _) in &links {
            self.links.remove(k);
        }
        for ((sh, a), t) in links {
            match moved(a) {
                Some(b) => {
                    self.links.insert((sh, b), t);
                }
                None => lost_fmt.links.push(((sh, a), Some(t), None)),
            }
        }
        if s.delta > 0 && s.at > 0 {
            self.inherit(s);
        }
        self.recalc_all();
        (dropped, rewritten, lost_fmt)
    }

    fn group_since(&mut self, mark: usize) {
        let mark = mark.min(self.undo.len());
        if self.undo.len() - mark < 2 {
            return;
        }
        let txs: Vec<Tx> = self.undo.drain(mark..).collect();
        self.undo.push(Tx::Group(txs));
    }

    pub fn undo_mark(&self) -> usize {
        self.undo.len()
    }

    pub fn undo_group(&mut self, mark: usize) {
        self.group_since(mark);
    }

    pub fn formats_in(&self, sheet: usize, top: Addr, bottom: Addr) -> Vec<(Addr, String)> {
        let mut out: Vec<(Addr, String)> = self
            .codes
            .iter()
            .filter(|((s, a), _)| *s == sheet && a.row >= top.row && a.row <= bottom.row && a.col >= top.col && a.col <= bottom.col)
            .map(|((_, a), c)| (*a, c.0.clone()))
            .collect();
        out.sort_by_key(|(a, _)| (a.row, a.col));
        out
    }

    pub fn merges(&self, sheet: usize) -> Vec<Area> {
        self.sheets.get(sheet).map(|s| s.merges.clone()).unwrap_or_default()
    }

    pub fn load_merges(&mut self, sheet: usize, list: &[Area]) -> Result<usize, EngineError> {
        let s = self.sheets.get_mut(sheet).ok_or(EngineError::NoSheet(sheet))?;
        s.merges = list.iter().filter(|m| m.r1 < MAX_ROWS && m.c1 < MAX_COLS && (m.r0 < m.r1 || m.c0 < m.c1)).copied().collect();
        Ok(s.merges.len())
    }

    pub fn merge(&mut self, sheet: usize, top: Addr, bottom: Addr, mode: MergeMode) -> Result<Effect, EngineError> {
        self.check(sheet, top)?;
        self.check(sheet, bottom)?;
        let all = Area { r0: top.row.min(bottom.row), r1: top.row.max(bottom.row), c0: top.col.min(bottom.col), c1: top.col.max(bottom.col) };
        let overlaps = |m: &Area| m.r0 <= all.r1 && m.r1 >= all.r0 && m.c0 <= all.c1 && m.c1 >= all.c0;
        let before = self.sheets[sheet].merges.clone();
        let mut after: Vec<Area> = before.iter().filter(|m| !overlaps(m)).copied().collect();
        let new: Vec<Area> = match mode {
            MergeMode::Unmerge => Vec::new(),
            MergeMode::Across => (all.r0..=all.r1).map(|r| Area { r0: r, r1: r, ..all }).filter(|m| m.c0 < m.c1).collect(),
            MergeMode::Cells | MergeMode::Center => vec![all].into_iter().filter(|m| m.r0 < m.r1 || m.c0 < m.c1).collect(),
        };
        if u64::from(all.r1 - all.r0 + 1) * u64::from(all.c1 - all.c0 + 1) > FORMAT_LIMIT && !new.is_empty() {
            return Err(EngineError::OutOfRange { row: all.r1, col: all.c1 });
        }
        let mut clear = Vec::new();
        for m in &new {
            self.sheets[sheet].cells.for_each_in(Addr { row: m.r0, col: m.c0 }, Addr { row: m.r1, col: m.c1 }, |a, _| {
                if a.row != m.r0 || a.col != m.c0 {
                    clear.push((a, String::new()));
                }
            });
        }
        after.extend(new.iter().copied());
        let mark = self.undo.len();
        let mut out = Effect { cells: if clear.is_empty() { Vec::new() } else { self.apply(sheet, &clear)? }, ..Effect::default() };
        if after != before {
            self.sheets[sheet].merges = after.clone();
            self.record(Tx::Merges { sheet, before, after });
            out.merges = Some(sheet);
        }
        if mode == MergeMode::Center {
            let ops: Vec<(Addr, Addr, String)> = new.iter().map(|m| (Addr { row: m.r0, col: m.c0 }, Addr { row: m.r0, col: m.c0 }, "ha:center".to_string())).collect();
            out = out.join(self.set_styles(sheet, &ops)?);
        }
        self.group_since(mark);
        Ok(out)
    }

    pub fn put_formats(&mut self, sheet: usize, items: &[(Addr, Option<String>, Option<String>)]) -> Result<Effect, EngineError> {
        let mut codes = Vec::new();
        let mut styles = Vec::new();
        for (a, st, code) in items {
            self.check(sheet, *a)?;
            let k = (sheet, *a);
            if let Some(code) = code {
                let code = Some(code).filter(|c| !c.is_empty() && fmtcode::parse(c).is_some()).cloned();
                let bc = self.codes.get(&k).map(|c| c.0.clone());
                if bc != code {
                    codes.push((k, bc, code));
                }
            }
            if let Some(st) = st {
                let st = style::Style::parse(st).filter(|s| !s.is_plain()).map(|s| s.text());
                let bs = self.styles.get(&k).map(|s| s.0.clone());
                if bs != st {
                    styles.push((k, bs, st));
                }
            }
        }
        let mark = self.undo.len();
        let mut out = self.apply_formats(&codes, true);
        out.cells = self.present(out.cells);
        if !codes.is_empty() {
            self.record(Tx::Formats(codes));
        }
        out = out.join(self.apply_styles(&styles, true));
        if !styles.is_empty() {
            self.record(Tx::Styles(styles));
        }
        self.group_since(mark);
        Ok(out)
    }

    fn inherit(&mut self, s: Shift) {
        let src = s.at - 1;
        let line = |a: &Addr| if s.rows { a.row } else { a.col };
        let at = |a: Addr, i: u32| if s.rows { Addr { row: s.at + i, ..a } } else { Addr { col: s.at + i, ..a } };
        let n = s.delta as u32;
        let codes: Vec<(Addr, std::sync::Arc<(String, fmtcode::Code)>)> = self.codes.iter().filter(|((sh, a), _)| *sh == s.sheet && line(a) == src).map(|((_, a), c)| (*a, c.clone())).collect();
        let styles: Vec<(Addr, StyleRef)> = self.styles.iter().filter(|((sh, a), _)| *sh == s.sheet && line(a) == src).map(|((_, a), st)| (*a, st.clone())).collect();
        if u64::from(n) * (codes.len() + styles.len()) as u64 > FORMAT_LIMIT {
            return;
        }
        for i in 0..n {
            for (a, c) in &codes {
                self.codes.insert((s.sheet, at(*a, i)), c.clone());
            }
            for (a, st) in &styles {
                self.styles.insert((s.sheet, at(*a, i)), st.clone());
            }
        }
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
        let old = std::mem::take(&mut self.codes);
        for ((s, a), c) in old {
            if let Some(n) = map(s) {
                self.codes.insert((n, a), c);
            }
        }
        let old = std::mem::take(&mut self.styles);
        for ((s, a), st) in old {
            if let Some(n) = map(s) {
                self.styles.insert((n, a), st);
            }
        }
        let old = std::mem::take(&mut self.links);
        for ((s, a), t) in old {
            if let Some(n) = map(s) {
                self.links.insert((n, a), t);
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
        let (dropped, rewritten, lost) = self.do_shift(shift);
        self.record(Tx::Shift { shift, dropped, rewritten, lost: Box::new(lost) });
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
        let (dropped, rewritten, lost) = self.do_shift(shift);
        self.record(Tx::Shift { shift, dropped, rewritten, lost: Box::new(lost) });
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
                Effect { cells: self.recalc(&seeds), ..Effect::default() }
            }
            Tx::Formats(changes) => self.apply_formats(changes, forward),
            Tx::Styles(changes) => self.apply_styles(changes, forward),
            Tx::Merges { sheet, before, after } => {
                self.sheets[*sheet].merges = if forward { after.clone() } else { before.clone() };
                Effect { merges: Some(*sheet), ..Effect::default() }
            }
            Tx::Links(changes) => self.apply_links(changes, forward),
            Tx::Rules { sheet, before, after } => {
                self.sheets[*sheet].rules = if forward { after.clone() } else { before.clone() };
                Effect { rules: Some(*sheet), ..Effect::default() }
            }
            Tx::Theme { before, after } => {
                self.theme = if forward { (**after).clone() } else { (**before).clone() };
                Effect { theme: true, ..Effect::default() }
            }
            Tx::Named { before, after } => {
                self.named = if forward { after.clone() } else { before.clone() };
                self.rebuild_named_codes();
                Effect { named: true, ..Effect::default() }
            }
            Tx::Group(txs) => {
                let mut out = Effect::default();
                if forward {
                    for t in txs {
                        let e = self.replay(t, true);
                        out = out.join(e);
                    }
                } else {
                    for t in txs.iter().rev() {
                        let e = self.replay(t, false);
                        out = out.join(e);
                    }
                }
                out
            }
            Tx::Shift { shift, dropped, rewritten, lost } => {
                if forward {
                    self.do_shift(*shift);
                    return Effect { shift: Some(*shift), merges: Some(shift.sheet), ..Effect::default() };
                }
                let back = Shift { delta: -shift.delta, ..*shift };
                self.do_shift(back);
                self.sheets[shift.sheet].merges = lost.merges.clone();
                self.sheets[shift.sheet].rules = lost.rules.clone();
                self.apply_links(&lost.links, false);
                let restored = self.apply_formats(&lost.codes, false).join(self.apply_styles(&lost.styles, false));
                for (s, a, raw) in rewritten {
                    self.set_raw(*s, *a, raw);
                }
                for (a, raw) in dropped {
                    self.set_raw(shift.sheet, *a, raw);
                }
                self.recalc_all();
                let cells = dropped.iter().map(|(a, _)| (shift.sheet, *a, self.sheets[shift.sheet].cells.get(*a).cloned().unwrap_or(Value::Empty))).collect();
                Effect { cells, shift: Some(back), merges: Some(shift.sheet), rules: Some(shift.sheet), formats: restored.formats, styles: restored.styles, ..Effect::default() }
            }
        }
    }

    pub fn undo(&mut self) -> Option<Effect> {
        let tx = self.undo.pop()?;
        let out = self.replay(&tx, false);
        self.redo.push(tx);
        Some(Effect { cells: self.present(out.cells), ..out })
    }

    pub fn redo(&mut self) -> Option<Effect> {
        let tx = self.redo.pop()?;
        let out = self.replay(&tx, true);
        self.undo.push(tx);
        Some(Effect { cells: self.present(out.cells), ..out })
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
