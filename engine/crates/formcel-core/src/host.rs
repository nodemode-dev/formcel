use crate::eval::Array;
use crate::formula::{self, Expr};
use crate::{Addr, Changed, Value, Workbook};
use std::sync::Mutex;
use std::collections::HashMap;

pub const HOST_FNS: [&str; 10] = ["AI", "FILTERXML", "GOOGLEFINANCE", "IMPORTDATA", "IMPORTFEED", "IMPORTHTML", "IMPORTRANGE", "IMPORTXML", "STOCKHISTORY", "WEBSERVICE"];

#[derive(Default, Debug)]
pub struct Host {
    pub results: HashMap<String, Array>,
    pub dates: HashMap<String, Vec<(usize, bool)>>,
    pub dated: HashMap<(usize, Addr), Vec<(usize, Addr)>>,
    pub want: Mutex<Vec<String>>,
    pub custom: Vec<String>,
}

impl Host {
    pub fn is_fn(&self, name: &str) -> bool {
        HOST_FNS.contains(&name) || (!self.custom.is_empty() && self.custom.iter().any(|c| c.eq_ignore_ascii_case(name)))
    }

    pub fn ask(&self, key: &str) {
        let Ok(mut w) = self.want.lock() else { return };
        if !w.iter().any(|k| k == key) && !self.results.contains_key(key) {
            w.push(key.to_string());
        }
    }
}

pub fn token(v: &Value) -> String {
    let clean = |s: &str| s.replace(['\u{1e}', '\u{1f}'], " ");
    match v {
        Value::Empty => "z:".to_string(),
        Value::Number(n) => format!("n:{n}"),
        Value::Bool(b) => format!("b:{}", u8::from(*b)),
        Value::Error(_) => format!("e:{v}"),
        Value::Text(s) => format!("t:{}", clean(s)),
    }
}

fn cell_of(t: &str) -> Value {
    let (kind, body) = t.split_at(t.find(':').map_or(0, |i| i + 1));
    let body = crate::wire::unescape(body);
    match kind {
        "n:" => body.parse().map_or(Value::Error(formula::ErrKind::Value), Value::Number),
        "b:" => Value::Bool(body == "1"),
        "e:" => formula::ErrKind::parse(&body).map_or(Value::Error(formula::ErrKind::Value), Value::Error),
        "z:" => Value::Empty,
        "d:" | "m:" => body.parse().map_or(Value::Error(formula::ErrKind::Value), Value::Number),
        _ => Value::Text(body),
    }
}

fn date_cells(data: &str) -> Vec<(usize, bool)> {
    let mut out = Vec::new();
    let mut i = 0;
    let mut cols = 1;
    for l in data.split('\n') {
        cols = cols.max(l.split('\t').count());
    }
    for l in data.split('\n') {
        let mut c = 0;
        for t in l.split('\t') {
            if t.starts_with("d:") || t.starts_with("m:") {
                out.push((i * cols + c, t.starts_with("m:")));
            }
            c += 1;
        }
        i += 1;
    }
    out
}

pub fn decode(data: &str) -> Array {
    let rows: Vec<Vec<Value>> = data.split('\n').map(|l| l.split('\t').map(cell_of).collect()).collect();
    let cols = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let n = rows.len().max(1);
    let mut out = Vec::with_capacity(n * cols);
    for r in &rows {
        for c in 0..cols {
            out.push(r.get(c).cloned().unwrap_or(Value::Empty));
        }
    }
    Array { rows: n, cols, data: out }
}

fn uses(e: &Expr, h: &Host) -> bool {
    match e {
        Expr::Call(n, _) if h.is_fn(n) => true,
        Expr::Ref(Some(s), _) if crate::xref::is_ext(s) => true,
        o => formula::children(o).into_iter().any(|c| uses(c, h)),
    }
}

impl Workbook {
    pub fn host_pending(&self) -> Vec<String> {
        self.host.want.lock().map(|mut w| std::mem::take(&mut *w)).unwrap_or_default()
    }

    pub fn host_keys(&self) -> Vec<String> {
        self.host.results.keys().cloned().collect()
    }

    pub fn host_custom(&mut self, names: &[String]) -> Changed {
        self.host.custom = names.iter().map(|n| n.trim().to_ascii_uppercase()).filter(|n| !n.is_empty()).collect();
        self.host_recalc()
    }

    pub fn host_set(&mut self, key: &str, data: Option<&str>) -> Changed {
        if key.starts_with(crate::xref::KEY_HEAD) {
            self.ext_store(key, data);
            return self.host_recalc();
        }
        match data {
            Some(d) => {
                self.host.results.insert(key.to_string(), decode(d));
                let dates = date_cells(d);
                if dates.is_empty() {
                    self.host.dates.remove(key);
                } else {
                    self.host.dates.insert(key.to_string(), dates);
                }
            }
            None => {
                self.host.results.remove(key);
                self.host.dates.remove(key);
            }
        }
        self.host_recalc()
    }

    pub fn host_clear(&mut self) -> Changed {
        self.host.results.clear();
        self.host_recalc()
    }

    pub(crate) fn host_formats(&mut self, k: (usize, Addr)) -> Option<crate::Fmt> {
        for p in self.host.dated.remove(&k).unwrap_or_default() {
            self.fmts.remove(&p);
        }
        if self.host.dates.is_empty() {
            return None;
        }
        let Some(Expr::Call(name, args)) = self.formulas.get(&k).and_then(|f| f.ast.clone()) else { return None };
        if !self.host.is_fn(&name) {
            return None;
        }
        let key = crate::eval::Eval::new(self, k.0).placed(k.1).host_key(&name, &args).ok()?;
        let cells = self.host.dates.get(&key)?.clone();
        let w = self.spills.get(&k).map_or(1, |s| s.1 as usize).max(1);
        let mut anchor = None;
        let mut set = Vec::new();
        for (i, moment) in cells {
            let f = if moment { crate::Fmt::DateTime { secs: true, ampm: false } } else { crate::Fmt::Date };
            let p = (k.0, Addr { row: k.1.row + (i / w) as u32, col: k.1.col + (i % w) as u32 });
            if p == k {
                anchor = Some(f);
            } else {
                self.fmts.insert(p, f);
                set.push(p);
            }
        }
        self.host.dated.insert(k, set);
        anchor
    }

    fn host_recalc(&mut self) -> Changed {
        let seeds: Vec<(usize, Addr)> = self.formulas.iter().filter(|(_, f)| f.ast.as_ref().is_some_and(|e| uses(e, &self.host))).map(|(k, _)| *k).collect();
        if seeds.is_empty() {
            return Vec::new();
        }
        self.recalc(&seeds)
    }
}
