use crate::formula::{self, Area, Expr};
use crate::wire::{escape, unescape};
use crate::{eval, fmtcode, Addr, Effect, EngineError, Tx, Value, Workbook};

pub const KINDS: [&str; 9] = ["any", "whole", "decimal", "list", "date", "time", "length", "custom", "checkbox"];
pub const OPS: [&str; 8] = ["between", "notbetween", "eq", "ne", "gt", "lt", "ge", "le"];
pub const ALERTS: [&str; 3] = ["stop", "warning", "info"];
pub const MESSAGE_LIMIT: usize = 225;
const LIST_LIMIT: usize = 10_000;

#[derive(Clone, Debug, PartialEq)]
pub struct Validation {
    pub area: Area,
    pub kind: String,
    pub op: String,
    pub a: String,
    pub b: String,
    pub blank_ok: bool,
    pub dropdown: bool,
    pub prompt: bool,
    pub alert: bool,
    pub style: String,
    pub prompt_title: String,
    pub prompt_text: String,
    pub error_title: String,
    pub error_text: String,
    pub chips: bool,
    pub multi: bool,
    pub colors: String,
}

pub fn item_colors(spec: &str) -> Vec<(String, String)> {
    spec.split(';').filter_map(|p| p.rsplit_once('=')).map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).filter(|(k, v)| !k.is_empty() && !v.is_empty()).collect()
}

fn clip(s: String) -> String {
    s.chars().take(MESSAGE_LIMIT).collect()
}

impl Validation {
    pub fn parse(line: &str) -> Option<Validation> {
        let p: Vec<String> = line.split('\t').map(unescape).collect();
        let n: Vec<u32> = p.first()?.split(',').filter_map(|x| x.parse().ok()).collect();
        if n.len() != 4 || n[0] > n[2] || n[1] > n[3] || n[2] >= crate::MAX_ROWS || n[3] >= crate::MAX_COLS {
            return None;
        }
        let arg = |i: usize| p.get(i).cloned().unwrap_or_default();
        let kind = arg(1);
        let mut op = arg(2);
        if !KINDS.contains(&kind.as_str()) {
            return None;
        }
        if matches!(kind.as_str(), "any" | "list" | "custom" | "checkbox") {
            op = String::new();
        } else if !OPS.contains(&op.as_str()) {
            return None;
        }
        let (a, b) = (arg(3), arg(4));
        for f in [&a, &b] {
            if let Some(body) = f.trim_start().strip_prefix('=') {
                formula::parse(body)?;
            }
        }
        if kind == "custom" && !a.trim_start().starts_with('=') {
            return None;
        }
        let flags = arg(5);
        let is_list = kind == "list";
        let style = Some(arg(6)).filter(|s| ALERTS.contains(&s.as_str())).unwrap_or_else(|| "stop".into());
        Some(Validation {
            area: Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] },
            kind,
            op,
            a,
            b,
            blank_ok: flags.contains('b'),
            dropdown: flags.contains('d'),
            prompt: flags.contains('p'),
            alert: flags.contains('e'),
            style,
            prompt_title: clip(arg(7)),
            prompt_text: clip(arg(8)),
            error_title: clip(arg(9)),
            error_text: clip(arg(10)),
            chips: flags.contains('c'),
            multi: flags.contains('m') && is_list,
            colors: arg(11),
        })
    }

    pub fn line(&self) -> String {
        let a = self.area;
        let mut flags = String::new();
        for (on, ch) in [(self.blank_ok, 'b'), (self.dropdown, 'd'), (self.prompt, 'p'), (self.alert, 'e'), (self.chips, 'c'), (self.multi, 'm')] {
            if on {
                flags.push(ch);
            }
        }
        let mut out = format!("{},{},{},{}", a.r0, a.c0, a.r1, a.c1);
        for f in [&self.kind, &self.op, &self.a, &self.b, &flags, &self.style, &self.prompt_title, &self.prompt_text, &self.error_title, &self.error_text, &self.colors] {
            out.push('\t');
            escape(f, &mut out);
        }
        out
    }
}

struct With<'a> {
    wb: &'a Workbook,
    sheet: usize,
    at: Addr,
    v: Value,
}

impl eval::Ctx for With<'_> {
    fn sheet_index(&self, name: &str) -> Option<usize> {
        eval::Ctx::sheet_index(self.wb, name)
    }

    fn cell(&self, sheet: usize, a: Addr) -> Value {
        if sheet == self.sheet && a == self.at {
            self.v.clone()
        } else {
            eval::Ctx::cell(self.wb, sheet, a)
        }
    }

    fn each(&self, sheet: usize, area: Area, f: &mut dyn FnMut(Addr, &Value)) {
        let hit = sheet == self.sheet && (area.r0..=area.r1).contains(&self.at.row) && (area.c0..=area.c1).contains(&self.at.col);
        let at = self.at;
        eval::Ctx::each(self.wb, sheet, area, &mut |a, v| {
            if !(hit && a == at) {
                f(a, v)
            }
        });
        if hit && self.v != Value::Empty {
            f(at, &self.v);
        }
    }

    fn name(&self, name: &str) -> Option<&Expr> {
        eval::Ctx::name(self.wb, name)
    }

    fn spill(&self, sheet: usize, a: Addr) -> Option<(u32, u32)> {
        eval::Ctx::spill(self.wb, sheet, a)
    }
}

fn hit(area: Area, a: Addr) -> bool {
    a.row >= area.r0 && a.row <= area.r1 && a.col >= area.c0 && a.col <= area.c1
}

pub(crate) fn carve(m: Area, cut: Area) -> Vec<Area> {
    if cut.r0 > m.r1 || cut.r1 < m.r0 || cut.c0 > m.c1 || cut.c1 < m.c0 {
        return vec![m];
    }
    let mut out = Vec::new();
    if m.r0 < cut.r0 {
        out.push(Area { r1: cut.r0 - 1, ..m });
    }
    if m.r1 > cut.r1 {
        out.push(Area { r0: cut.r1 + 1, ..m });
    }
    let (r0, r1) = (m.r0.max(cut.r0), m.r1.min(cut.r1));
    if m.c0 < cut.c0 {
        out.push(Area { r0, r1, c0: m.c0, c1: cut.c0 - 1 });
    }
    if m.c1 > cut.c1 {
        out.push(Area { r0, r1, c0: cut.c1 + 1, c1: m.c1 });
    }
    out
}

pub(crate) fn moved_to(v: &Validation, area: Area, dr: i64, dc: i64) -> Validation {
    let shift = |s: &String| if (dr != 0 || dc != 0) && s.trim_start().starts_with('=') { formula::offset_text(s, dr, dc) } else { s.clone() };
    Validation { area, a: shift(&v.a), b: shift(&v.b), ..v.clone() }
}

fn same(x: &Value, y: &Value) -> bool {
    match (x, y) {
        (Value::Number(a), Value::Number(b)) => (a - b).abs() <= 1e-9 * b.abs().max(1.0),
        (Value::Text(a), Value::Text(b)) => a.to_lowercase() == b.to_lowercase(),
        (Value::Bool(a), Value::Bool(b)) => a == b,
        _ => false,
    }
}

pub fn checkbox_values(v: &Validation) -> (Value, Value) {
    let pick = |s: &str, default: bool| if s.trim().is_empty() { Value::Bool(default) } else { Value::parse_input(s.trim()) };
    (pick(&v.a, true), pick(&v.b, false))
}

fn compare(op: &str, x: f64, a: Option<f64>, b: Option<f64>) -> bool {
    let Some(a) = a else { return false };
    match op {
        "between" => b.is_some_and(|b| x >= a && x <= b),
        "notbetween" => b.is_some_and(|b| x < a || x > b),
        "eq" => x == a,
        "ne" => x != a,
        "gt" => x > a,
        "lt" => x < a,
        "ge" => x >= a,
        "le" => x <= a,
        _ => false,
    }
}

impl Workbook {
    pub fn validations(&self, sheet: usize) -> Vec<String> {
        self.sheets.get(sheet).map(|s| s.valid.iter().map(Validation::line).collect()).unwrap_or_default()
    }

    pub fn load_validations(&mut self, sheet: usize, lines: &[String]) -> Result<usize, EngineError> {
        let s = self.sheets.get_mut(sheet).ok_or(EngineError::NoSheet(sheet))?;
        s.valid = lines.iter().filter_map(|l| Validation::parse(l)).collect();
        Ok(s.valid.len())
    }

    pub fn set_validation(&mut self, sheet: usize, area: Area, line: &str) -> Result<Effect, EngineError> {
        self.check(sheet, Addr { row: area.r1, col: area.c1 })?;
        let new = if line.trim().is_empty() {
            None
        } else {
            let mut v = Validation::parse(&format!("{},{},{},{}\t{line}", area.r0, area.c0, area.r1, area.c1)).ok_or_else(|| EngineError::BadStyle(line.to_string()))?;
            v.area = area;
            Some(v)
        };
        let before = self.sheets[sheet].valid.clone();
        let mut after: Vec<Validation> = Vec::new();
        for v in &before {
            for piece in carve(v.area, area) {
                after.push(moved_to(v, piece, i64::from(piece.r0) - i64::from(v.area.r0), i64::from(piece.c0) - i64::from(v.area.c0)));
            }
        }
        after.extend(new);
        if before != after {
            self.sheets[sheet].valid = after.clone();
            self.record(Tx::Valid { sheet, before, after });
        }
        Ok(Effect { valid: Some(sheet), ..Effect::default() })
    }

    pub fn validation_at(&self, sheet: usize, a: Addr) -> Option<Validation> {
        self.sheets.get(sheet)?.valid.iter().rev().find(|v| hit(v.area, a)).cloned()
    }

    fn rule_value(&self, sheet: usize, v: &Validation, src: &str, a: Addr, ctx: &dyn eval::Ctx) -> Value {
        match src.trim_start().strip_prefix('=') {
            Some(body) => {
                let Some(mut e) = formula::parse(body) else { return Value::Empty };
                formula::offset(&mut e, i64::from(a.row) - i64::from(v.area.r0), i64::from(a.col) - i64::from(v.area.c0));
                eval::Eval::new(ctx, sheet).placed(a).scalar(&e)
            }
            None => Value::parse_input(src.trim()),
        }
    }

    fn incoming(&self, sheet: usize, a: Addr, raw: &str) -> Value {
        if raw.is_empty() {
            return Value::Empty;
        }
        if self.code_of(&(sheet, a)).is_some_and(|c| c.1.class() == fmtcode::Class::Text) {
            return Value::Text(raw.to_string());
        }
        if let Some(t) = raw.strip_prefix('\'') {
            return Value::Text(t.to_string());
        }
        if crate::is_formula(raw) {
            return match formula::parse(&raw[1..]) {
                Some(e) => eval::Eval::new(self, sheet).placed(a).scalar(&e),
                None => Value::Error(formula::ErrKind::Name),
            };
        }
        Value::parse_input(raw)
    }

    fn list_values(&self, sheet: usize, v: &Validation, a: Addr) -> Vec<Value> {
        match v.a.trim_start().strip_prefix('=') {
            Some(body) => {
                let Some(mut e) = formula::parse(body) else { return Vec::new() };
                formula::offset(&mut e, i64::from(a.row) - i64::from(v.area.r0), i64::from(a.col) - i64::from(v.area.c0));
                let mut out = eval::Eval::new(self, sheet).placed(a).listed(&e);
                out.retain(|x| !matches!(x, Value::Empty));
                out.truncate(LIST_LIMIT);
                out
            }
            None => v.a.split(',').map(str::trim).filter(|s| !s.is_empty()).map(Value::parse_input).take(LIST_LIMIT).collect(),
        }
    }

    pub fn list_items(&self, sheet: usize, a: Addr) -> Vec<String> {
        let Some(v) = self.validation_at(sheet, a).filter(|v| v.kind == "list") else { return Vec::new() };
        let mut seen = std::collections::HashSet::new();
        self.list_values(sheet, &v, a).into_iter().map(|x| x.to_string()).filter(|s| seen.insert(s.clone())).collect()
    }

    pub fn allowed(&self, sheet: usize, v: &Validation, a: Addr, x: &Value) -> bool {
        if matches!(x, Value::Empty) || matches!(x, Value::Text(s) if s.is_empty()) {
            return v.blank_ok || v.kind == "any";
        }
        let num = |val: Value| match val {
            Value::Number(n) => Some(n),
            Value::Empty => Some(0.0),
            _ => None,
        };
        let operands = || (num(self.rule_value(sheet, v, &v.a, a, self)), num(self.rule_value(sheet, v, &v.b, a, self)));
        match v.kind.as_str() {
            "any" => true,
            "checkbox" => {
                let (on, off) = checkbox_values(v);
                same(x, &on) || same(x, &off)
            }
            "whole" | "decimal" | "date" | "time" => {
                let Value::Number(n) = x else { return false };
                if v.kind == "whole" && n.fract() != 0.0 {
                    return false;
                }
                let (lo, hi) = operands();
                compare(&v.op, *n, lo, hi)
            }
            "length" => {
                let (lo, hi) = operands();
                compare(&v.op, x.to_string().chars().count() as f64, lo, hi)
            }
            "list" => {
                let items = self.list_values(sheet, v, a);
                let known = |y: &Value| items.iter().any(|item| same(y, item) || same(&Value::Text(y.to_string()), &Value::Text(item.to_string())));
                if v.multi {
                    let parts: Vec<Value> = x.to_string().split(',').map(str::trim).filter(|s| !s.is_empty()).map(Value::parse_input).collect();
                    !parts.is_empty() && parts.iter().all(known)
                } else {
                    known(x)
                }
            }
            "custom" => {
                let ctx = With { wb: self, sheet, at: a, v: x.clone() };
                match self.rule_value(sheet, v, &v.a, a, &ctx) {
                    Value::Bool(b) => b,
                    Value::Number(n) => n != 0.0,
                    _ => false,
                }
            }
            _ => true,
        }
    }

    pub fn check_input(&self, sheet: usize, a: Addr, raw: &str) -> Option<Validation> {
        let v = self.validation_at(sheet, a)?;
        if raw.is_empty() {
            return None;
        }
        let x = self.incoming(sheet, a, raw);
        (!self.allowed(sheet, &v, a, &x)).then_some(v)
    }

    pub fn invalid_in(&self, sheet: usize, top: Addr, bottom: Addr) -> Vec<Addr> {
        let Some(sh) = self.sheets.get(sheet) else { return Vec::new() };
        let mut out = Vec::new();
        for v in &sh.valid {
            let (r0, r1) = (v.area.r0.max(top.row), v.area.r1.min(bottom.row));
            let (c0, c1) = (v.area.c0.max(top.col), v.area.c1.min(bottom.col));
            if r0 > r1 || c0 > c1 {
                continue;
            }
            sh.cells.for_each_in(Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 }, |a, x| {
                if !self.allowed(sheet, v, a, x) {
                    out.push(a);
                }
            });
        }
        out
    }
}
