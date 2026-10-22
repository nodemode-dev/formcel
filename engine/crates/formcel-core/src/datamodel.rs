use crate::dax::{self, D};
use crate::formula::Area;
use crate::table::unique_names;
use crate::wire::{escape, unescape};
use crate::{Addr, Changed, Effect, Value, Workbook};
use std::collections::HashMap;

pub const CONN_NAME: &str = "ThisWorkbookDataModel";
const LIST: char = '\u{1f}';

pub fn key_of(v: &Value) -> String {
    match v {
        Value::Empty => "z".to_string(),
        Value::Number(n) => format!("n{}", if *n == 0.0 { 0.0 } else { *n }),
        Value::Text(t) => format!("t{}", t.to_lowercase()),
        Value::Bool(b) => format!("b{}", u8::from(*b)),
        Value::Error(_) => format!("e{v}"),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    Manual,
    Table(String),
    Range(String),
    Query(String),
}

impl Source {
    fn parts(&self) -> (&'static str, &str) {
        match self {
            Source::Manual => ("manual", ""),
            Source::Table(s) => ("table", s),
            Source::Range(s) => ("range", s),
            Source::Query(s) => ("query", s),
        }
    }

    fn make(kind: &str, r: &str) -> Source {
        match kind {
            "table" => Source::Table(r.to_string()),
            "range" => Source::Range(r.to_string()),
            "query" => Source::Query(r.to_string()),
            _ => Source::Manual,
        }
    }
}

#[derive(Clone, Debug)]
pub struct MCol {
    pub name: String,
    pub calc: String,
    pub data: Vec<Value>,
    pub fmt: String,
    pub ast: Option<D>,
    pub err: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MTable {
    pub name: String,
    pub source: Source,
    pub cols: Vec<MCol>,
    pub rows: usize,
}

#[derive(Clone, Debug)]
pub struct Rel {
    pub from_t: String,
    pub from_c: String,
    pub to_t: String,
    pub to_c: String,
    pub active: bool,
    pub fi: usize,
    pub fci: usize,
    pub ti: usize,
    pub tci: usize,
    pub err: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Measure {
    pub table: String,
    pub name: String,
    pub expr: String,
    pub fmt: String,
    pub ast: Option<D>,
    pub err: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Hier {
    pub table: String,
    pub name: String,
    pub levels: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Kpi {
    pub name: String,
    pub value: String,
    pub goal: String,
    pub lo: f64,
    pub hi: f64,
}

#[derive(Clone, Debug)]
pub struct Conn {
    pub name: String,
    pub text: String,
}

#[derive(Clone, Debug, Default)]
pub struct Model {
    pub tables: Vec<MTable>,
    pub rels: Vec<Rel>,
    pub measures: Vec<Measure>,
    pub hiers: Vec<Hier>,
    pub kpis: Vec<Kpi>,
    pub conns: Vec<Conn>,
    pub links: Vec<Vec<Option<u32>>>,
}

impl Model {
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty() && self.measures.is_empty() && self.conns.is_empty()
    }

    pub fn tidx(&self, name: &str) -> Option<usize> {
        self.tables.iter().position(|t| t.name.eq_ignore_ascii_case(name.trim()))
    }

    pub fn cidx(&self, t: usize, name: &str) -> Option<usize> {
        self.tables.get(t)?.cols.iter().position(|c| c.name.eq_ignore_ascii_case(name.trim()))
    }

    pub fn midx(&self, name: &str) -> Option<usize> {
        self.measures.iter().position(|m| m.name.eq_ignore_ascii_case(name.trim()))
    }

    pub fn reaches(&self, from: usize, to: usize, act: &[bool], depth: u32) -> bool {
        if from == to {
            return true;
        }
        if depth > 8 {
            return false;
        }
        self.rels.iter().enumerate().any(|(i, r)| act[i] && r.fi == from && r.err.is_none() && self.reaches(r.ti, to, act, depth + 1))
    }

    fn connected(&self, a: usize, b: usize, skip: Option<usize>) -> bool {
        let mut seen = vec![false; self.tables.len()];
        let mut stack = vec![a];
        while let Some(x) = stack.pop() {
            if x == b {
                return true;
            }
            if std::mem::replace(&mut seen[x], true) {
                continue;
            }
            for (i, r) in self.rels.iter().enumerate() {
                if !r.active || Some(i) == skip {
                    continue;
                }
                if r.fi == x {
                    stack.push(r.ti);
                } else if r.ti == x {
                    stack.push(r.fi);
                }
            }
        }
        false
    }

    pub fn rebuild(&mut self) {
        for t in self.tables.iter_mut() {
            let n = t.cols.iter().filter(|c| c.calc.is_empty()).map(|c| c.data.len()).max().unwrap_or(0);
            t.rows = n;
            for c in t.cols.iter_mut() {
                if c.calc.is_empty() {
                    c.data.resize(n, Value::Empty);
                }
            }
        }
        let tables = self.tables.clone();
        for r in self.rels.iter_mut() {
            r.err = None;
            let f = tables.iter().position(|t| t.name.eq_ignore_ascii_case(&r.from_t));
            let t = tables.iter().position(|t| t.name.eq_ignore_ascii_case(&r.to_t));
            let (Some(fi), Some(ti)) = (f, t) else {
                r.err = Some("a table of the relationship no longer exists".into());
                continue;
            };
            let fc = tables[fi].cols.iter().position(|c| c.name.eq_ignore_ascii_case(&r.from_c));
            let tc = tables[ti].cols.iter().position(|c| c.name.eq_ignore_ascii_case(&r.to_c));
            let (Some(fci), Some(tci)) = (fc, tc) else {
                r.err = Some("a column of the relationship no longer exists".into());
                continue;
            };
            (r.fi, r.fci, r.ti, r.tci) = (fi, fci, ti, tci);
        }
        self.links = vec![Vec::new(); self.rels.len()];
        for pass in 0..2 {
            for ti in 0..self.tables.len() {
                for ci in 0..self.tables[ti].cols.len() {
                    let c = &self.tables[ti].cols[ci];
                    if c.calc.is_empty() {
                        continue;
                    }
                    let ast = dax::parse(&c.calc);
                    let outcome = match &ast {
                        Ok(d) => dax::column(self, ti, d),
                        Err(e) => Err(e.clone()),
                    };
                    let rows = self.tables[ti].rows;
                    let col = &mut self.tables[ti].cols[ci];
                    match outcome {
                        Ok(v) => {
                            col.data = v;
                            col.err = None;
                        }
                        Err(e) => {
                            col.data = vec![Value::Error(crate::ErrKind::Value); rows];
                            col.err = Some(e);
                        }
                    }
                    col.ast = ast.ok();
                }
                if pass == 0 {
                    self.link_all();
                }
            }
            self.link_all();
        }
        for i in 0..self.measures.len() {
            let parsed = dax::parse(&self.measures[i].expr).and_then(|d| dax::check_names(self, &d, Some(&self.measures[i].table.clone())).map(|()| d));
            match parsed {
                Ok(d) => {
                    self.measures[i].ast = Some(d);
                    self.measures[i].err = None;
                }
                Err(e) => {
                    self.measures[i].ast = None;
                    self.measures[i].err = Some(e);
                }
            }
        }
    }

    fn link_all(&mut self) {
        for i in 0..self.rels.len() {
            if self.rels[i].err.as_deref().is_some_and(|e| e.contains("no longer")) {
                continue;
            }
            self.rels[i].err = None;
            let r = self.rels[i].clone();
            let one = &self.tables[r.ti].cols[r.tci].data;
            let mut map: HashMap<String, u32> = HashMap::new();
            let mut dup = false;
            for (k, v) in one.iter().enumerate() {
                if *v == Value::Empty {
                    continue;
                }
                if map.insert(key_of(v), k as u32).is_some() {
                    dup = true;
                }
            }
            if dup {
                self.rels[i].err = Some(format!("the column {}[{}] has duplicate values, so it cannot be the one side", r.to_t, r.to_c));
            }
            let many = &self.tables[r.fi].cols[r.fci].data;
            self.links[i] = many.iter().map(|v| if *v == Value::Empty { None } else { map.get(&key_of(v)).copied() }).collect();
        }
    }

    pub fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        let put = |parts: &[&str]| -> String {
            let mut s = String::new();
            for (i, p) in parts.iter().enumerate() {
                if i > 0 {
                    s.push('\t');
                }
                escape(p, &mut s);
            }
            s
        };
        for t in &self.tables {
            let (k, r) = t.source.parts();
            out.push(put(&["T", &t.name, k, r]));
            for c in &t.cols {
                let mut s = put(&["C", &t.name, &c.name, &c.calc, &c.fmt]);
                if c.calc.is_empty() {
                    for v in &c.data {
                        s.push('\t');
                        let (kind, text) = match v {
                            Value::Empty => ('z', String::new()),
                            Value::Number(n) => ('n', format!("{n}")),
                            Value::Text(x) => ('t', x.clone()),
                            Value::Bool(b) => ('b', u8::from(*b).to_string()),
                            Value::Error(_) => ('e', v.to_string()),
                        };
                        s.push(kind);
                        escape(&text, &mut s);
                    }
                }
                out.push(s);
            }
        }
        for r in &self.rels {
            out.push(put(&["R", &r.from_t, &r.from_c, &r.to_t, &r.to_c, if r.active { "1" } else { "0" }]));
        }
        for m in &self.measures {
            out.push(put(&["M", &m.table, &m.name, &m.expr, &m.fmt]));
        }
        for h in &self.hiers {
            out.push(put(&["H", &h.table, &h.name, &h.levels.join(&LIST.to_string())]));
        }
        for k in &self.kpis {
            out.push(put(&["K", &k.name, &k.value, &k.goal, &k.lo.to_string(), &k.hi.to_string()]));
        }
        for c in &self.conns {
            out.push(put(&["X", &c.name, &c.text]));
        }
        out
    }

    pub fn load(lines: &[String]) -> Model {
        let mut m = Model::default();
        for l in lines {
            let p: Vec<String> = l.split('\t').map(unescape).collect();
            let a = |i: usize| p.get(i).cloned().unwrap_or_default();
            match a(0).as_str() {
                "T" => m.tables.push(MTable { name: a(1), source: Source::make(&a(2), &a(3)), cols: Vec::new(), rows: 0 }),
                "C" => {
                    let Some(ti) = m.tidx(&a(1)) else { continue };
                    let calc = a(3);
                    let data = if calc.is_empty() { p.iter().skip(5).map(|t| cell_of(t)).collect() } else { Vec::new() };
                    m.tables[ti].cols.push(MCol { name: a(2), calc, data, fmt: a(4), ast: None, err: None });
                }
                "R" => m.rels.push(Rel { from_t: a(1), from_c: a(2), to_t: a(3), to_c: a(4), active: a(5) == "1", fi: 0, fci: 0, ti: 0, tci: 0, err: None }),
                "M" => m.measures.push(Measure { table: a(1), name: a(2), expr: a(3), fmt: a(4), ast: None, err: None }),
                "H" => m.hiers.push(Hier { table: a(1), name: a(2), levels: a(3).split(LIST).filter(|x| !x.is_empty()).map(String::from).collect() }),
                "K" => m.kpis.push(Kpi { name: a(1), value: a(2), goal: a(3), lo: a(4).parse().unwrap_or(0.4), hi: a(5).parse().unwrap_or(0.8) }),
                "X" => m.conns.push(Conn { name: a(1), text: a(2) }),
                _ => {}
            }
        }
        m.rebuild();
        m
    }
}

fn cell_of(t: &str) -> Value {
    let mut ch = t.chars();
    let kind = ch.next().unwrap_or('z');
    let body = ch.as_str();
    match kind {
        'n' => body.parse().map_or(Value::Empty, Value::Number),
        't' => Value::Text(body.to_string()),
        'b' => Value::Bool(body == "1"),
        'e' => crate::ErrKind::parse(body).map_or(Value::Empty, Value::Error),
        _ => Value::Empty,
    }
}

pub fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn opt(e: &Option<String>) -> String {
    e.as_deref().map_or("\"\"".into(), js)
}

impl Model {
    pub fn info(&self) -> String {
        let mut o = String::from("{\"tables\":[");
        for (i, t) in self.tables.iter().enumerate() {
            if i > 0 {
                o.push(',');
            }
            let (k, r) = t.source.parts();
            o.push_str(&format!("{{\"name\":{},\"source\":{},\"ref\":{},\"rows\":{},\"cols\":[", js(&t.name), js(k), js(r), t.rows));
            for (j, c) in t.cols.iter().enumerate() {
                if j > 0 {
                    o.push(',');
                }
                let nums = c.data.iter().filter(|v| matches!(v, Value::Number(_))).count();
                let filled = c.data.iter().filter(|v| **v != Value::Empty).count();
                let kind = if filled > 0 && nums * 5 >= filled * 4 { "n" } else { "t" };
                o.push_str(&format!("{{\"name\":{},\"calc\":{},\"fmt\":{},\"kind\":\"{kind}\",\"err\":{}}}", js(&c.name), js(&c.calc), js(&c.fmt), opt(&c.err)));
            }
            o.push_str("]}");
        }
        o.push_str("],\"rels\":[");
        for (i, r) in self.rels.iter().enumerate() {
            if i > 0 {
                o.push(',');
            }
            o.push_str(&format!("{{\"from\":[{},{}],\"to\":[{},{}],\"active\":{},\"err\":{}}}", js(&r.from_t), js(&r.from_c), js(&r.to_t), js(&r.to_c), r.active, opt(&r.err)));
        }
        o.push_str("],\"measures\":[");
        for (i, m) in self.measures.iter().enumerate() {
            if i > 0 {
                o.push(',');
            }
            o.push_str(&format!("{{\"table\":{},\"name\":{},\"expr\":{},\"fmt\":{},\"err\":{}}}", js(&m.table), js(&m.name), js(&m.expr), js(&m.fmt), opt(&m.err)));
        }
        o.push_str("],\"hiers\":[");
        for (i, h) in self.hiers.iter().enumerate() {
            if i > 0 {
                o.push(',');
            }
            let lv: Vec<String> = h.levels.iter().map(|l| js(l)).collect();
            o.push_str(&format!("{{\"table\":{},\"name\":{},\"levels\":[{}]}}", js(&h.table), js(&h.name), lv.join(",")));
        }
        o.push_str("],\"kpis\":[");
        for (i, k) in self.kpis.iter().enumerate() {
            if i > 0 {
                o.push(',');
            }
            o.push_str(&format!("{{\"name\":{},\"value\":{},\"goal\":{},\"lo\":{},\"hi\":{}}}", js(&k.name), js(&k.value), js(&k.goal), k.lo, k.hi));
        }
        o.push_str("],\"conns\":[");
        for (i, c) in self.conns.iter().enumerate() {
            if i > 0 {
                o.push(',');
            }
            o.push_str(&format!("{{\"name\":{},\"text\":{}}}", js(&c.name), js(&c.text)));
        }
        o.push_str("]}");
        o
    }

    pub fn fields(&self) -> Vec<(String, bool)> {
        let mut out = Vec::new();
        for t in &self.tables {
            for c in &t.cols {
                let nums = c.data.iter().filter(|v| matches!(v, Value::Number(_))).count();
                let filled = c.data.iter().filter(|v| **v != Value::Empty).count();
                out.push((format!("{}.{}", t.name, c.name), filled > 0 && nums * 5 >= filled * 4));
            }
        }
        for m in &self.measures {
            out.push((format!("[{}]", m.name), true));
        }
        out
    }

    pub fn display(&self, t: usize, c: usize, r: usize) -> String {
        match &self.tables[t].cols[c].data[r] {
            Value::Empty => String::new(),
            v => v.to_string(),
        }
    }
}

impl Workbook {
    fn read_source(&self, src: &Source) -> Result<Option<(Vec<String>, Vec<Vec<Value>>)>, String> {
        let (sheet, area): (usize, Area) = match src {
            Source::Table(n) => {
                let t = self.tables.iter().find(|t| t.name.eq_ignore_ascii_case(n)).ok_or_else(|| format!("the table {n} no longer exists"))?;
                let (_, d1) = t.data();
                (t.sheet, Area { r1: d1, ..t.area })
            }
            Source::Range(text) => {
                let (s, a, _) = self.resolve_source(0, text).map_err(|e| e.to_string())?;
                (s, a)
            }
            _ => return Ok(None),
        };
        if area.r1 <= area.r0 {
            return Err("the source needs a header row and at least one row of data".into());
        }
        let hv: Vec<String> = (area.c0..=area.c1).map(|c| self.shown_text(sheet, Addr { row: area.r0, col: c })).collect();
        let names = unique_names(&hv);
        let mut cols: Vec<Vec<Value>> = vec![Vec::new(); names.len()];
        for r in area.r0 + 1..=area.r1 {
            let row: Vec<Value> = (area.c0..=area.c1).map(|c| self.sheets[sheet].cells.get(Addr { row: r, col: c }).cloned().unwrap_or(Value::Empty)).collect();
            if row.iter().all(|v| *v == Value::Empty) {
                continue;
            }
            for (i, v) in row.into_iter().enumerate() {
                cols[i].push(v);
            }
        }
        Ok(Some((names, cols)))
    }

    fn model_put(&mut self, name: &str, source: Source, names: Vec<String>, cols: Vec<Vec<Value>>) {
        let new_cols: Vec<MCol> = names.into_iter().zip(cols).map(|(n, d)| MCol { name: n, calc: String::new(), data: d, fmt: String::new(), ast: None, err: None }).collect();
        match self.model.tidx(name) {
            Some(i) => {
                let old = std::mem::take(&mut self.model.tables[i].cols);
                let mut merged = new_cols;
                for c in old.into_iter().filter(|c| !c.calc.is_empty()) {
                    merged.push(c);
                }
                self.model.tables[i].cols = merged;
                self.model.tables[i].source = source;
            }
            None => self.model.tables.push(MTable { name: name.to_string(), source, cols: new_cols, rows: 0 }),
        }
    }

    pub fn model_lines(&self) -> Vec<String> {
        self.model.lines()
    }

    pub fn load_model(&mut self, lines: &[String]) -> usize {
        self.model = Model::load(lines);
        let _ = self.cube_recalc();
        self.model.tables.len() + self.model.measures.len()
    }

    pub fn cube_recalc(&mut self) -> Changed {
        let seeds: Vec<(usize, Addr)> = self.formulas.iter().filter(|(_, f)| f.ast.as_ref().is_some_and(crate::cube::uses_cube)).map(|(k, _)| *k).collect();
        if seeds.is_empty() {
            return Vec::new();
        }
        self.recalc(&seeds)
    }

    pub fn model_refresh(&mut self, only: Option<&str>) -> Result<usize, String> {
        let mut n = 0;
        let mut first: Option<String> = None;
        let list: Vec<(String, Source)> = self.model.tables.iter().filter(|t| only.is_none_or(|o| t.name.eq_ignore_ascii_case(o))).map(|t| (t.name.clone(), t.source.clone())).collect();
        for (name, src) in list {
            match self.read_source(&src) {
                Ok(Some((names, cols))) => {
                    self.model_put(&name, src, names, cols);
                    n += 1;
                }
                Ok(None) => {}
                Err(e) => {
                    first.get_or_insert(format!("{name}: {e}"));
                }
            }
        }
        self.model.rebuild();
        match first {
            Some(e) if n == 0 => Err(e),
            _ => Ok(n),
        }
    }

    pub fn model_run(&mut self, cmd: &str) -> (String, Effect) {
        let p: Vec<String> = cmd.split('\t').map(unescape).collect();
        let arg = |i: usize| p.get(i).map_or("", String::as_str);
        let mut fx = Effect::default();
        let fail = |e: String| format!("error\t{e}");
        let mut changed = false;
        let reply = match arg(0) {
            "info" => self.model.info(),
            "fields" => self.model.fields().iter().map(|(n, num)| format!("{}{}", if *num { 'n' } else { 't' }, n)).collect::<Vec<_>>().join("\n"),
            "data" => {
                let Some(t) = self.model.tidx(arg(1)) else { return (fail("no such table".into()), fx) };
                let (from, count) = (arg(2).parse::<usize>().unwrap_or(0), arg(3).parse::<usize>().unwrap_or(200));
                let tb = &self.model.tables[t];
                let end = (from + count).min(tb.rows);
                let mut o = String::from("[");
                for r in from..end {
                    if r > from {
                        o.push(',');
                    }
                    o.push('[');
                    for c in 0..tb.cols.len() {
                        if c > 0 {
                            o.push(',');
                        }
                        o.push_str(&js(&self.model.display(t, c, r)));
                    }
                    o.push(']');
                }
                o.push(']');
                o
            }
            "addtable" | "putdata" => {
                let name = arg(1).trim().to_string();
                if !crate::formula::valid_name(&name) {
                    return (fail(format!("'{name}' is not a usable table name: no spaces, starts with a letter")), fx);
                }
                let src = Source::make(arg(2), arg(3));
                let loaded = if arg(0) == "addtable" {
                    self.read_source(&src).and_then(|x| x.ok_or_else(|| "that source cannot be read from the workbook".to_string()))
                } else {
                    Ok(decode_payload(arg(4)))
                };
                match loaded {
                    Ok((names, cols)) => {
                        self.model_put(&name, src, names, cols);
                        changed = true;
                        "ok".into()
                    }
                    Err(e) => fail(e),
                }
            }
            "removetable" => match self.model.tidx(arg(1)) {
                Some(i) => {
                    let n = self.model.tables.remove(i).name;
                    self.model.rels.retain(|r| !r.from_t.eq_ignore_ascii_case(&n) && !r.to_t.eq_ignore_ascii_case(&n));
                    self.model.hiers.retain(|h| !h.table.eq_ignore_ascii_case(&n));
                    self.model.measures.retain(|m| !m.table.eq_ignore_ascii_case(&n));
                    changed = true;
                    "ok".into()
                }
                None => fail("no such table".into()),
            },
            "renametable" => match (self.model.tidx(arg(1)), crate::formula::valid_name(arg(2))) {
                (Some(i), true) if self.model.tidx(arg(2)).is_none_or(|j| j == i) => {
                    let old = self.model.tables[i].name.clone();
                    let new = arg(2).to_string();
                    self.model.tables[i].name = new.clone();
                    for r in self.model.rels.iter_mut() {
                        if r.from_t.eq_ignore_ascii_case(&old) {
                            r.from_t = new.clone();
                        }
                        if r.to_t.eq_ignore_ascii_case(&old) {
                            r.to_t = new.clone();
                        }
                    }
                    for h in self.model.hiers.iter_mut().filter(|h| h.table.eq_ignore_ascii_case(&old)) {
                        h.table = new.clone();
                    }
                    for m in self.model.measures.iter_mut() {
                        if m.table.eq_ignore_ascii_case(&old) {
                            m.table = new.clone();
                        }
                        m.expr = rename_in(&m.expr, &old, &new);
                    }
                    for t in self.model.tables.iter_mut() {
                        for c in t.cols.iter_mut().filter(|c| !c.calc.is_empty()) {
                            c.calc = rename_in(&c.calc, &old, &new);
                        }
                    }
                    changed = true;
                    "ok".into()
                }
                _ => fail("that table name is not allowed or is taken".into()),
            },
            "refresh" => match self.model_refresh(if arg(1).is_empty() { None } else { Some(arg(1)) }) {
                Ok(n) => {
                    changed = true;
                    format!("ok\t{n}")
                }
                Err(e) => fail(e),
            },
            "setcol" => {
                let (Some(t), name, calc) = (self.model.tidx(arg(1)), arg(2).trim().to_string(), arg(3).trim().to_string()) else { return (fail("no such table".into()), fx) };
                if name.is_empty() || calc.is_empty() {
                    return (fail("a calculated column needs a name and a formula".into()), fx);
                }
                if let Err(e) = dax::parse(&calc) {
                    return (fail(e), fx);
                }
                match self.model.cidx(t, &name) {
                    Some(c) if self.model.tables[t].cols[c].calc.is_empty() => return (fail("that name is a data column".into()), fx),
                    Some(c) => self.model.tables[t].cols[c].calc = calc,
                    None => self.model.tables[t].cols.push(MCol { name, calc, data: Vec::new(), fmt: String::new(), ast: None, err: None }),
                }
                changed = true;
                "ok".into()
            }
            "delcol" => match self.model.tidx(arg(1)).and_then(|t| self.model.cidx(t, arg(2)).map(|c| (t, c))) {
                Some((t, c)) => {
                    let n = self.model.tables[t].cols.remove(c).name;
                    let tn = self.model.tables[t].name.clone();
                    self.model.rels.retain(|r| !((r.from_t.eq_ignore_ascii_case(&tn) && r.from_c.eq_ignore_ascii_case(&n)) || (r.to_t.eq_ignore_ascii_case(&tn) && r.to_c.eq_ignore_ascii_case(&n))));
                    for h in self.model.hiers.iter_mut().filter(|h| h.table.eq_ignore_ascii_case(&tn)) {
                        h.levels.retain(|l| !l.eq_ignore_ascii_case(&n));
                    }
                    changed = true;
                    "ok".into()
                }
                None => fail("no such column".into()),
            },
            "addrel" => {
                self.model.rebuild();
                let (ft, fc, tt, tc) = (arg(1), arg(2), arg(3), arg(4));
                let (Some(fi), Some(ti)) = (self.model.tidx(ft), self.model.tidx(tt)) else { return (fail("a table does not exist".into()), fx) };
                let (Some(fci), Some(tci)) = (self.model.cidx(fi, fc), self.model.cidx(ti, tc)) else { return (fail("a column does not exist".into()), fx) };
                if fi == ti {
                    return (fail("a relationship joins two different tables".into()), fx);
                }
                if self.model.rels.iter().any(|r| (r.fi, r.fci, r.ti, r.tci) == (fi, fci, ti, tci)) {
                    return (fail("that relationship already exists".into()), fx);
                }
                let one = &self.model.tables[ti].cols[tci].data;
                let mut seen = std::collections::HashSet::new();
                if one.iter().filter(|v| **v != Value::Empty).any(|v| !seen.insert(key_of(v))) {
                    return (fail(format!("{tt}[{tc}] has duplicate values, so it cannot be the one side of a one-to-many relationship")), fx);
                }
                let wants = arg(5) != "0";
                let tname = self.model.tables[ti].name.clone();
                let fname = self.model.tables[fi].name.clone();
                let ambiguous = wants && self.model.connected(fi, ti, None);
                self.model.rels.push(Rel { from_t: fname, from_c: self.model.tables[fi].cols[fci].name.clone(), to_t: tname, to_c: self.model.tables[ti].cols[tci].name.clone(), active: wants && !ambiguous, fi, fci, ti, tci, err: None });
                changed = true;
                if ambiguous { "ok\tinactive".into() } else { "ok".into() }
            }
            "delrel" => match arg(1).parse::<usize>() {
                Ok(i) if i < self.model.rels.len() => {
                    self.model.rels.remove(i);
                    changed = true;
                    "ok".into()
                }
                _ => fail("no such relationship".into()),
            },
            "setrel" => match arg(1).parse::<usize>() {
                Ok(i) if i < self.model.rels.len() => {
                    let on = arg(2) != "0";
                    if on && self.model.rels[i].err.is_none() {
                        let (a, b) = (self.model.rels[i].fi, self.model.rels[i].ti);
                        if self.model.connected(a, b, Some(i)) {
                            return (fail("another active path already joins those tables; make that relationship inactive first".into()), fx);
                        }
                    }
                    self.model.rels[i].active = on;
                    changed = true;
                    "ok".into()
                }
                _ => fail("no such relationship".into()),
            },
            "setmeasure" => {
                let (table, name, expr) = (arg(1).trim(), arg(2).trim(), arg(3).trim());
                if name.is_empty() || name.contains(['[', ']']) {
                    return (fail("a measure name cannot be empty or contain brackets".into()), fx);
                }
                if self.model.tidx(table).is_none() {
                    return (fail("choose the table that holds the measure".into()), fx);
                }
                self.model.rebuild();
                if let Err(e) = dax::parse(expr).and_then(|d| dax::check_names(&self.model, &d, Some(table))) {
                    return (fail(e), fx);
                }
                let old = arg(5);
                let existing = self.model.midx(if old.is_empty() { name } else { old });
                let m = Measure { table: table.to_string(), name: name.to_string(), expr: expr.to_string(), fmt: arg(4).to_string(), ast: None, err: None };
                match existing {
                    Some(i) => self.model.measures[i] = m,
                    None => self.model.measures.push(m),
                }
                changed = true;
                "ok".into()
            }
            "delmeasure" => match self.model.midx(arg(1)) {
                Some(i) => {
                    self.model.measures.remove(i);
                    changed = true;
                    "ok".into()
                }
                None => fail("no such measure".into()),
            },
            "check" => {
                self.model.rebuild();
                match dax::parse(arg(1)).and_then(|d| dax::check_names(&self.model, &d, Some(arg(2))).map(|()| d)) {
                    Ok(d) => match dax::expr(&self.model, &d, &[]) {
                        Ok(v) => format!("ok\t{v}"),
                        Err(e) => format!("ok\t#{e}"),
                    },
                    Err(e) => fail(e),
                }
            }
            "sethier" => {
                let (table, name) = (arg(1), arg(2).trim());
                let Some(t) = self.model.tidx(table) else { return (fail("no such table".into()), fx) };
                let levels: Vec<String> = arg(3).split(LIST).filter(|x| !x.is_empty()).map(String::from).collect();
                if name.is_empty() || levels.len() < 2 || levels.iter().any(|l| self.model.cidx(t, l).is_none()) {
                    return (fail("a hierarchy needs a name and at least two columns of the table".into()), fx);
                }
                let h = Hier { table: self.model.tables[t].name.clone(), name: name.to_string(), levels };
                match self.model.hiers.iter().position(|x| x.table.eq_ignore_ascii_case(&h.table) && x.name.eq_ignore_ascii_case(&h.name)) {
                    Some(i) => self.model.hiers[i] = h,
                    None => self.model.hiers.push(h),
                }
                changed = true;
                "ok".into()
            }
            "delhier" => {
                self.model.hiers.retain(|h| !(h.table.eq_ignore_ascii_case(arg(1)) && h.name.eq_ignore_ascii_case(arg(2))));
                changed = true;
                "ok".into()
            }
            "setkpi" => {
                let name = arg(1).trim();
                if name.is_empty() || self.model.midx(arg(2)).is_none() {
                    return (fail("a KPI needs a name and a base measure".into()), fx);
                }
                let k = Kpi { name: name.to_string(), value: arg(2).to_string(), goal: arg(3).to_string(), lo: arg(4).parse().unwrap_or(0.4), hi: arg(5).parse().unwrap_or(0.8) };
                match self.model.kpis.iter().position(|x| x.name.eq_ignore_ascii_case(name)) {
                    Some(i) => self.model.kpis[i] = k,
                    None => self.model.kpis.push(k),
                }
                changed = true;
                "ok".into()
            }
            "delkpi" => {
                self.model.kpis.retain(|k| !k.name.eq_ignore_ascii_case(arg(1)));
                changed = true;
                "ok".into()
            }
            "setconn" => {
                let name = arg(1).trim();
                if name.is_empty() || name.eq_ignore_ascii_case(CONN_NAME) {
                    return (fail("choose a name other than the Data Model's own".into()), fx);
                }
                let c = Conn { name: name.to_string(), text: arg(2).to_string() };
                match self.model.conns.iter().position(|x| x.name.eq_ignore_ascii_case(name)) {
                    Some(i) => self.model.conns[i] = c,
                    None => self.model.conns.push(c),
                }
                changed = true;
                "ok".into()
            }
            "delconn" => {
                self.model.conns.retain(|c| !c.name.eq_ignore_ascii_case(arg(1)));
                changed = true;
                "ok".into()
            }
            "evalm" => {
                self.model.rebuild();
                match self.model.midx(arg(1)) {
                    Some(i) => match dax::measure(&self.model, i, &[]) {
                        Ok(v) => v.to_string(),
                        Err(e) => format!("#{e}"),
                    },
                    None => String::new(),
                }
            }
            "tofx" => match self.model_pivot_to_formulas(arg(1)) {
                Ok(e) => {
                    fx = e;
                    "ok".into()
                }
                Err(e) => fail(e.to_string()),
            },
            _ => fail("unknown data model command".into()),
        };
        if changed {
            self.model.rebuild();
            fx.cells.extend(self.cube_recalc());
        }
        (reply, fx)
    }
}

fn rename_in(expr: &str, old: &str, new: &str) -> String {
    let mut out = String::new();
    let ch: Vec<char> = expr.chars().collect();
    let o: Vec<char> = old.chars().collect();
    let mut i = 0;
    while i < ch.len() {
        let start_ok = i == 0 || !(ch[i - 1].is_alphanumeric() || ch[i - 1] == '_');
        let end = i + o.len();
        let hit = start_ok && end < ch.len() && ch[i..end].iter().zip(&o).all(|(a, b)| a.eq_ignore_ascii_case(b)) && ch[end] == '[';
        if hit {
            out.push_str(new);
            i = end;
        } else {
            out.push(ch[i]);
            i += 1;
        }
    }
    out
}

fn decode_payload(s: &str) -> (Vec<String>, Vec<Vec<Value>>) {
    let mut rows = s.split('\n').filter(|l| !l.is_empty());
    let names: Vec<String> = rows.next().map(|h| h.split('\t').map(|c| unescape(c.get(1..).unwrap_or(""))).collect()).unwrap_or_default();
    let names = unique_names(&names);
    let mut cols: Vec<Vec<Value>> = vec![Vec::new(); names.len()];
    for r in rows {
        for (i, c) in r.split('\t').enumerate().take(names.len()) {
            let mut ch = c.chars();
            let kind = ch.next().unwrap_or('z');
            let body = unescape(ch.as_str());
            cols[i].push(match kind {
                'n' => body.parse().map_or(Value::Empty, Value::Number),
                't' => Value::Text(body),
                'b' => Value::Bool(body == "1"),
                _ => Value::Empty,
            });
        }
    }
    (names, cols)
}
