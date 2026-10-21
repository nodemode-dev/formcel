use crate::eval::Array;
use crate::formula::{self, Expr};
use crate::{Addr, Changed, Value, Workbook};
use std::sync::Mutex;
use std::collections::HashMap;

pub const HOST_FNS: [&str; 8] = ["AI", "FILTERXML", "IMPORTDATA", "IMPORTFEED", "IMPORTHTML", "IMPORTRANGE", "IMPORTXML", "WEBSERVICE"];

#[derive(Default, Debug)]
pub struct Host {
    pub results: HashMap<String, Array>,
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
        _ => Value::Text(body),
    }
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
        match data {
            Some(d) => {
                self.host.results.insert(key.to_string(), decode(d));
            }
            None => {
                self.host.results.remove(key);
            }
        }
        self.host_recalc()
    }

    pub fn host_clear(&mut self) -> Changed {
        self.host.results.clear();
        self.host_recalc()
    }

    fn host_recalc(&mut self) -> Changed {
        let seeds: Vec<(usize, Addr)> = self.formulas.iter().filter(|(_, f)| f.ast.as_ref().is_some_and(|e| uses(e, &self.host))).map(|(k, _)| *k).collect();
        if seeds.is_empty() {
            return Vec::new();
        }
        self.recalc(&seeds)
    }
}
