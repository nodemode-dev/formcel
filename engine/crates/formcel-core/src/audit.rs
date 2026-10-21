use crate::eval::{Array, Eval, Out};
use crate::formula::{self, Area, Expr};
use crate::{Addr, Value, Workbook};

pub const MAX_ARROWS: usize = 4000;
const MAX_STEPS: usize = 300;
const INLINE_CELLS: u64 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Arrow {
    pub from_sheet: usize,
    pub from: Area,
    pub to_sheet: usize,
    pub to: Addr,
    pub level: u32,
}

pub fn encode_arrows(list: &[Arrow]) -> String {
    let mut out = String::new();
    for a in list {
        out.push_str(&format!("{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n", a.from_sheet, a.from.r0, a.from.c0, a.from.r1, a.from.c1, a.to_sheet, a.to.row, a.to.col, a.level));
    }
    out
}

fn kids(e: &mut Expr) -> Vec<&mut Expr> {
    match e {
        Expr::Neg(x) | Expr::Pos(x) | Expr::Pct(x) | Expr::Paren(x) | Expr::Spill(x) | Expr::Single(x) => vec![&mut **x],
        Expr::Bin(_, a, b) => vec![&mut **a, &mut **b],
        Expr::Call(_, args) => args.iter_mut().collect(),
        Expr::Array(rows) => rows.iter_mut().flatten().collect(),
        _ => Vec::new(),
    }
}

fn atom(e: &Expr) -> bool {
    match e {
        Expr::Num(_) | Expr::Str(_) | Expr::Bool(_) | Expr::Err(_) | Expr::Missing | Expr::Union(_) => true,
        Expr::Array(rows) => rows.iter().flatten().all(atom),
        Expr::Ref(_, k) => {
            let a = k.area();
            u64::from(a.r1 - a.r0 + 1) * u64::from(a.c1 - a.c0 + 1) > INLINE_CELLS
        }
        _ => false,
    }
}

fn literal(v: &Value) -> Expr {
    match v {
        Value::Number(n) => Expr::Num(*n),
        Value::Text(s) => Expr::Str(s.clone()),
        Value::Bool(b) => Expr::Bool(*b),
        Value::Error(k) => Expr::Err(*k),
        Value::Empty => Expr::Num(0.0),
    }
}

fn lifted(o: Out) -> Expr {
    match o {
        Out::V(v) => literal(&v),
        Out::A(Array { rows, cols, data }) => Expr::Array((0..rows).map(|r| (0..cols).map(|c| literal(&data[r * cols + c])).collect()).collect()),
    }
}

const WHOLE: [&str; 11] = ["LET", "LAMBDA", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL", "MAKEARRAY", "ARRAYFORMULA", "OFFSET", "INDIRECT"];

fn marker() -> Expr {
    Expr::Name("\u{1}".to_string())
}

fn reduce(e: &mut Expr, ev: &Eval, hit: &mut Option<Expr>) {
    if hit.is_some() || atom(e) {
        return;
    }
    if let Expr::Call(name, args) = e {
        if (name == "IF" || name == "IFERROR" || name == "IFNA") && !args.is_empty() {
            let name = name.clone();
            reduce(&mut args[0], ev, hit);
            if hit.is_some() {
                return;
            }
            if name == "IF" && atom(&args[0]) {
                if let Out::V(v) = ev.formula(&args[0]) {
                    let pick = match v {
                        Value::Bool(true) => Some(1),
                        Value::Bool(false) | Value::Empty => Some(2),
                        Value::Number(n) => Some(if n != 0.0 { 1 } else { 2 }),
                        _ => None,
                    };
                    if let Some(i) = pick {
                        let chosen = args.get(i).cloned().unwrap_or(Expr::Bool(false));
                        *e = chosen;
                        reduce(e, ev, hit);
                        return;
                    }
                }
            }
            if name != "IF" && atom(&args[0]) {
                *hit = Some(std::mem::replace(e, marker()));
                return;
            }
        }
    }
    let whole = matches!(e, Expr::Call(n, _) if WHOLE.contains(&n.as_str())) || matches!(e, Expr::Name(_) | Expr::Invoke(..) | Expr::Table(..) | Expr::Range(..) | Expr::Intersect(..));
    if !whole {
        for k in kids(e) {
            reduce(k, ev, hit);
            if hit.is_some() {
                return;
            }
        }
    }
    let ready = whole || kids(e).iter().all(|k| atom(k));
    if ready {
        *hit = Some(std::mem::replace(e, marker()));
    }
}

fn split(e: &Expr) -> (String, String) {
    let text = formula::to_text(e);
    match text.split_once('\u{1}') {
        Some((a, b)) => (a.to_string(), b.to_string()),
        None => (text, String::new()),
    }
}

impl Workbook {
    fn read_areas(&self, k: &(usize, Addr)) -> Vec<(usize, Area)> {
        self.formulas.get(k).map(|f| self.areas_of(k, f)).unwrap_or_default()
    }

    fn readers_of(&self, sheet: usize, area: Area) -> Vec<(usize, Addr)> {
        let mut out: Vec<(usize, Addr)> = Vec::new();
        for (k, f) in &self.formulas {
            if self.areas_of(k, f).iter().any(|(s, ar)| *s == sheet && ar.r0 <= area.r1 && ar.r1 >= area.r0 && ar.c0 <= area.c1 && ar.c1 >= area.c0) {
                out.push(*k);
            }
        }
        out.sort_by_key(|k| (k.0, k.1.row, k.1.col));
        out
    }

    pub fn precedent_arrows(&self, sheet: usize, a: Addr, levels: u32) -> Vec<Arrow> {
        let mut out: Vec<Arrow> = Vec::new();
        let mut frontier = vec![(sheet, a)];
        let mut seen = vec![(sheet, a)];
        for level in 1..=levels.max(1) {
            let mut next = Vec::new();
            for k in &frontier {
                for (s, ar) in self.read_areas(k) {
                    if out.len() >= MAX_ARROWS {
                        return out;
                    }
                    let arrow = Arrow { from_sheet: s, from: ar, to_sheet: k.0, to: k.1, level };
                    if !out.contains(&arrow) {
                        out.push(arrow);
                    }
                    for (fk, _) in self.formulas.iter().filter(|(fk, _)| fk.0 == s && ar.contains(fk.1.row, fk.1.col)) {
                        if !seen.contains(fk) && seen.len() < MAX_ARROWS {
                            seen.push(*fk);
                            next.push(*fk);
                        }
                    }
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
        out
    }

    pub fn dependent_arrows(&self, sheet: usize, a: Addr, levels: u32) -> Vec<Arrow> {
        let mut out: Vec<Arrow> = Vec::new();
        let mut frontier = vec![(sheet, a)];
        let mut seen = vec![(sheet, a)];
        for level in 1..=levels.max(1) {
            let mut next = Vec::new();
            for k in &frontier {
                let cell = Area { r0: k.1.row, c0: k.1.col, r1: k.1.row, c1: k.1.col };
                for d in self.readers_of(k.0, cell) {
                    if out.len() >= MAX_ARROWS {
                        return out;
                    }
                    out.push(Arrow { from_sheet: k.0, from: cell, to_sheet: d.0, to: d.1, level });
                    if !seen.contains(&d) {
                        seen.push(d);
                        next.push(d);
                    }
                }
            }
            if next.is_empty() {
                break;
            }
            frontier = next;
        }
        out
    }

    pub fn evaluate_steps(&self, sheet: usize, a: Addr) -> Vec<[String; 3]> {
        let Some(mut e) = self.formulas.get(&(sheet, a)).and_then(|f| f.ast.clone()) else { return Vec::new() };
        let ev = Eval::new(self, sheet).placed(a);
        let mut states = Vec::new();
        for _ in 0..MAX_STEPS {
            let mut hit = None;
            reduce(&mut e, &ev, &mut hit);
            let Some(target) = hit else {
                states.push([formula::to_text(&e), String::new(), String::new()]);
                break;
            };
            let (before, after) = split(&e);
            states.push([before, formula::to_text(&target), after]);
            let value = lifted(ev.formula(&target));
            let mut done = false;
            formula::walk_mut(&mut e, &mut |x| {
                if !done && *x == marker() {
                    *x = value.clone();
                    done = true;
                }
            });
            if atom(&e) || matches!(e, Expr::Array(_)) {
                states.push([formula::to_text(&e), String::new(), String::new()]);
                break;
            }
        }
        states
    }
}
