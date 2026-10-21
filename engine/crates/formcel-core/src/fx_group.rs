use super::{err, num, number_of, sort_key, Arg, Array, Eval, Lambda};
use crate::formula::{ErrKind, Expr};
use crate::Value;
use std::collections::HashMap;
use std::rc::Rc;

enum Agg {
    Lam(Rc<Lambda>),
    Named(String),
}

struct Dim {
    k: usize,
    ids: Vec<Vec<usize>>,
    items: Vec<Vec<Value>>,
    names: Vec<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Leaf,
    Sub,
    Grand,
}

struct Line {
    path: Vec<usize>,
    kind: Kind,
}

struct Totals {
    grand: bool,
    subs: usize,
    top: bool,
}

fn key_of(v: &Value) -> String {
    match v {
        Value::Number(n) => format!("n{n}"),
        Value::Text(s) => format!("t{}", s.to_lowercase()),
        Value::Bool(b) => format!("b{b}"),
        Value::Empty => "e".into(),
        Value::Error(k) => format!("x{k:?}"),
    }
}

fn sum_of(vals: &[Value]) -> Result<f64, ErrKind> {
    let mut s = 0.0;
    for v in vals {
        match v {
            Value::Number(n) => s += n,
            Value::Error(k) => return Err(*k),
            _ => {}
        }
    }
    Ok(s)
}

fn expr_of(v: &Value) -> Option<Expr> {
    match v {
        Value::Number(n) => Some(Expr::Num(*n)),
        Value::Text(s) => Some(Expr::Str(s.clone())),
        Value::Bool(b) => Some(Expr::Bool(*b)),
        Value::Error(k) => Some(Expr::Err(*k)),
        Value::Empty => None,
    }
}

impl Eval<'_> {
    pub(super) fn percentof(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.is_empty() || a.len() > 2 {
            return Err(ErrKind::Na);
        }
        let part = self.numbers(&a[..1])?.iter().sum::<f64>();
        let all = if a.len() == 2 { self.numbers(&a[1..])?.iter().sum::<f64>() } else { part };
        if all == 0.0 {
            return Err(ErrKind::Div0);
        }
        Ok(num(part / all))
    }

    fn agg_of(&self, e: &Expr, out: &mut Vec<(Agg, String)>) -> Result<(), ErrKind> {
        match e {
            Expr::Paren(x) => self.agg_of(x, out),
            Expr::Call(n, items) if matches!(n.as_str(), "HSTACK" | "VSTACK") => {
                for i in items {
                    self.agg_of(i, out)?;
                }
                Ok(())
            }
            Expr::Name(n) if self.local(n).is_none() => {
                out.push((Agg::Named(n.to_ascii_uppercase()), n.to_ascii_uppercase()));
                Ok(())
            }
            _ => match self.arg(e) {
                Arg::F(f) if f.params.len() == 1 || f.params.len() == 2 => {
                    let label = format!("f{}", out.len() + 1);
                    out.push((Agg::Lam(f), label));
                    Ok(())
                }
                Arg::V(Value::Error(k)) => Err(k),
                _ => Err(ErrKind::Calc),
            },
        }
    }

    fn reduce(&self, f: &Agg, vals: Vec<Value>, rel: &[Value]) -> Value {
        let vals: Vec<Value> = vals.into_iter().filter(|v| *v != Value::Empty).collect();
        if vals.is_empty() {
            return Value::Empty;
        }
        let nums = || vals.iter().filter_map(|v| if let Value::Number(n) = v { Some(*n) } else { None }).collect::<Vec<f64>>();
        match f {
            Agg::Lam(l) => {
                let col = |v: &[Value]| Arg::A(Array { rows: v.len().max(1), cols: 1, data: if v.is_empty() { vec![Value::Empty] } else { v.to_vec() } });
                let mut args = vec![col(&vals)];
                if l.params.len() == 2 {
                    args.push(col(rel));
                }
                match self.apply(l, args) {
                    Ok(a) => self.deref(a),
                    Err(k) => err(k),
                }
            }
            Agg::Named(n) => {
                if let Some(Value::Error(k)) = vals.iter().find(|v| matches!(v, Value::Error(_))) {
                    if !matches!(n.as_str(), "COUNT" | "COUNTA") {
                        return err(*k);
                    }
                }
                match n.as_str() {
                    "SUM" => num(nums().iter().sum()),
                    "COUNT" => num(nums().len() as f64),
                    "COUNTA" => num(vals.len() as f64),
                    "PRODUCT" => num(nums().iter().product()),
                    "MIN" => num(nums().into_iter().reduce(f64::min).unwrap_or(0.0)),
                    "MAX" => num(nums().into_iter().reduce(f64::max).unwrap_or(0.0)),
                    "AVERAGE" => {
                        let v = nums();
                        if v.is_empty() {
                            err(ErrKind::Div0)
                        } else {
                            num(v.iter().sum::<f64>() / v.len() as f64)
                        }
                    }
                    "PERCENTOF" => match (sum_of(&vals), sum_of(rel)) {
                        (Ok(_), Ok(d)) if d == 0.0 => err(ErrKind::Div0),
                        (Ok(p), Ok(d)) => num(p / d),
                        (Err(k), _) | (_, Err(k)) => err(k),
                    },
                    other => {
                        let items: Vec<Expr> = vals.iter().filter_map(expr_of).collect();
                        self.scalar(&Expr::Call(other.to_string(), vec![Expr::Array(vec![items])]))
                    }
                }
            }
        }
    }

    fn dim(&self, g: &Array, keep: &[usize], names: Vec<String>) -> Dim {
        let k = g.cols;
        let mut maps: Vec<HashMap<String, usize>> = vec![HashMap::new(); k];
        let mut items: Vec<Vec<Value>> = vec![Vec::new(); k];
        let mut ids = vec![Vec::new(); g.rows];
        for &r in keep {
            let mut row = Vec::with_capacity(k);
            for c in 0..k {
                let v = &g.data[r * k + c];
                let n = maps[c].len();
                let id = *maps[c].entry(key_of(v)).or_insert_with(|| {
                    items[c].push(v.clone());
                    n
                });
                row.push(id);
            }
            ids[r] = row;
        }
        Dim { k, ids, items, names }
    }

    fn plan(&self, d: &Dim, recs: &[usize], level: usize, prefix: &mut Vec<usize>, sort: &[i64], t: &Totals, agg: &dyn Fn(&[usize], usize) -> Value, out: &mut Vec<Line>) {
        let mut groups: Vec<(usize, Vec<usize>)> = Vec::new();
        let mut at: HashMap<usize, usize> = HashMap::new();
        for &r in recs {
            let id = d.ids[r][level];
            let i = *at.entry(id).or_insert_with(|| {
                groups.push((id, Vec::new()));
                groups.len() - 1
            });
            groups[i].1.push(r);
        }
        let used: Vec<i64> = sort.iter().copied().filter(|&j| j != 0 && ((j.unsigned_abs() as usize) > d.k || (j.unsigned_abs() as usize) - 1 == level)).collect();
        let keys: Vec<Vec<Value>> = groups
            .iter()
            .map(|(id, rs)| {
                used.iter()
                    .map(|&j| {
                        let j = j.unsigned_abs() as usize;
                        if j <= d.k {
                            d.items[level][*id].clone()
                        } else {
                            agg(rs, j - d.k - 1)
                        }
                    })
                    .collect()
            })
            .collect();
        let mut order: Vec<usize> = (0..groups.len()).collect();
        order.sort_by(|&x, &y| {
            for (i, &j) in used.iter().enumerate() {
                let o = sort_key(&keys[x][i], &keys[y][i]);
                let o = if j < 0 { o.reverse() } else { o };
                if o != std::cmp::Ordering::Equal {
                    return o;
                }
            }
            sort_key(&d.items[level][groups[x].0], &d.items[level][groups[y].0])
        });
        for i in order {
            let (id, rs) = &groups[i];
            prefix.push(*id);
            if level + 1 == d.k {
                out.push(Line { path: prefix.clone(), kind: Kind::Leaf });
            } else {
                let sub = level < t.subs;
                if sub && t.top {
                    out.push(Line { path: prefix.clone(), kind: Kind::Sub });
                }
                self.plan(d, rs, level + 1, prefix, sort, t, agg, out);
                if sub && !t.top {
                    out.push(Line { path: prefix.clone(), kind: Kind::Sub });
                }
            }
            prefix.pop();
        }
    }

    fn lines(&self, d: &Dim, recs: &[usize], sort: &[i64], t: &Totals, agg: &dyn Fn(&[usize], usize) -> Value) -> Vec<Line> {
        let mut out = Vec::new();
        if d.k > 0 {
            self.plan(d, recs, 0, &mut Vec::new(), sort, t, agg, &mut out);
        }
        if t.grand && d.k > 0 {
            let g = Line { path: Vec::new(), kind: Kind::Grand };
            if t.top {
                out.insert(0, g);
            } else {
                out.push(g);
            }
        }
        if d.k == 0 {
            out.push(Line { path: Vec::new(), kind: Kind::Grand });
        }
        out
    }

    fn totals(&self, e: Option<&Expr>, k: usize) -> Result<Totals, ErrKind> {
        let d = match e {
            Some(x) if !matches!(x, Expr::Missing) => Some(number_of(&self.scalar(x))?.trunc() as i64),
            _ => None,
        };
        Ok(match d {
            None => Totals { grand: true, subs: k.saturating_sub(1), top: false },
            Some(0) => Totals { grand: false, subs: 0, top: false },
            Some(d) if d.abs() > 99 => return Err(ErrKind::Value),
            Some(d) => Totals { grand: true, subs: ((d.unsigned_abs() as usize).saturating_sub(1)).min(k.saturating_sub(1)), top: d < 0 },
        })
    }

    fn order_of(&self, e: Option<&Expr>) -> Result<Vec<i64>, ErrKind> {
        match e {
            Some(x) if !matches!(x, Expr::Missing) => {
                let g = self.grid(self.arg(x))?;
                g.data.iter().map(|v| number_of(v).map(|n| n.trunc() as i64)).collect()
            }
            _ => Ok(Vec::new()),
        }
    }

    fn opt_num(&self, a: &[Expr], i: usize) -> Result<Option<i64>, ErrKind> {
        match a.get(i) {
            Some(x) if !matches!(x, Expr::Missing) => Ok(Some(number_of(&self.scalar(x))?.trunc() as i64)),
            _ => Ok(None),
        }
    }

    pub(super) fn call_group(&self, name: &str, a: &[Expr]) -> Result<Arg, ErrKind> {
        let pivot = name == "PIVOTBY";
        let (min, max) = if pivot { (4, 11) } else { (3, 8) };
        if a.len() < min || a.len() > max {
            return Err(ErrKind::Na);
        }
        let mut rg = self.grid(self.arg(&a[0]))?;
        let mut cg = if pivot { Some(self.grid(self.arg(&a[1]))?) } else { None };
        let mut vg = self.grid(self.arg(&a[if pivot { 2 } else { 1 }]))?;
        let fi = if pivot { 3 } else { 2 };
        let mut aggs: Vec<(Agg, String)> = Vec::new();
        self.agg_of(&a[fi], &mut aggs)?;
        let base = fi + 1;
        let mode = self.opt_num(a, base)?;
        let (r_depth, r_sort, c_depth, c_sort, filter, extra) = if pivot { (base + 1, base + 2, base + 3, base + 4, base + 5, base + 6) } else { (base + 1, base + 2, usize::MAX, usize::MAX, base + 3, base + 4) };
        let n = rg.rows;
        if vg.rows != n || cg.as_ref().is_some_and(|c| c.rows != n) {
            return Err(ErrKind::Value);
        }
        let has_head = match mode {
            Some(1) | Some(3) => true,
            Some(0) | Some(2) => false,
            None => matches!(vg.data.first(), Some(Value::Text(_))) && matches!(vg.data.get(vg.cols), Some(Value::Number(_))),
            _ => return Err(ErrKind::Value),
        };
        let show = match mode {
            Some(2) | Some(3) => true,
            Some(_) => false,
            None => has_head,
        };
        let text = |v: &Value| v.to_string();
        let (rn, cn, vn): (Vec<String>, Vec<String>, Vec<String>);
        let strip = |g: &mut Array, tag: &str| -> Vec<String> {
            if has_head && g.rows > 0 {
                let names = g.data[..g.cols].iter().map(text).collect();
                g.data.drain(..g.cols);
                g.rows -= 1;
                names
            } else {
                (1..=g.cols).map(|i| format!("{tag}{i}")).collect()
            }
        };
        rn = strip(&mut rg, "Group");
        cn = match cg.as_mut() {
            Some(c) => strip(c, "Column"),
            None => Vec::new(),
        };
        vn = strip(&mut vg, "Value");
        let n = rg.rows;
        let keep: Vec<usize> = match a.get(filter) {
            Some(x) if !matches!(x, Expr::Missing) => {
                let f = self.grid(self.arg(x))?;
                if f.data.len() != n {
                    return Err(ErrKind::Value);
                }
                let mut k = Vec::new();
                for (i, v) in f.data.iter().enumerate() {
                    if super::bool_of(v)? {
                        k.push(i);
                    }
                }
                k
            }
            _ => (0..n).collect(),
        };
        if keep.is_empty() {
            return Err(ErrKind::Calc);
        }
        let rd = self.dim(&rg, &keep, rn);
        let cd = cg.as_ref().map(|c| self.dim(c, &keep, cn));
        let relative = if pivot { self.opt_num(a, extra)?.unwrap_or(0) } else { 2 };
        let multi = aggs.len() > 1;
        let (m, nf) = (vg.cols, aggs.len());

        let cell = |recs: &[usize], vc: usize, f: usize, rel: &[usize]| -> Value {
            let vals: Vec<Value> = recs.iter().map(|&r| vg.data[r * m + vc].clone()).collect();
            let refs: Vec<Value> = rel.iter().map(|&r| vg.data[r * m + vc].clone()).collect();
            self.reduce(&aggs[f].0, vals, &refs)
        };
        let first = |recs: &[usize], vc: usize| cell(recs, vc.min(m.saturating_sub(1)), 0, recs);

        let rt = self.totals(a.get(r_depth), rd.k)?;
        let rs = self.order_of(a.get(r_sort))?;
        let rl = self.lines(&rd, &keep, &rs, &rt, &first);
        let (ct, cl) = match &cd {
            Some(c) => {
                let ct = self.totals(a.get(c_depth), c.k)?;
                let cs = self.order_of(a.get(c_sort))?;
                let l = self.lines(c, &keep, &cs, &ct, &first);
                (Some(ct), l)
            }
            None => (None, vec![Line { path: Vec::new(), kind: Kind::Grand }]),
        };
        let _ = ct;

        let hit = |d: &Dim, l: &Line, r: usize| l.path.iter().enumerate().all(|(i, id)| d.ids[r][i] == *id);
        let empty = Dim { k: 0, ids: vec![Vec::new(); n], items: Vec::new(), names: Vec::new() };
        let cdim = cd.as_ref().unwrap_or(&empty);

        let kr = rd.k;
        let kc = cdim.k;
        let nv = m * nf;
        let head_rows = if pivot { kc + usize::from(nv > 1) } else { usize::from(show) };
        let width = kr + cl.len() * nv;
        let mut data: Vec<Value> = Vec::new();
        let blank = || Value::Text(String::new());
        let vname = |vc: usize, f: usize| -> Value {
            let base = vn.get(vc).cloned().unwrap_or_default();
            Value::Text(if multi { format!("{base} ({})", aggs[f].1) } else { base })
        };
        let item_text = |d: &Dim, level: usize, id: usize| d.items[level][id].clone();
        let label = |d: &Dim, l: &Line, level: usize| -> Value {
            let id = l.path[level];
            let it = item_text(d, level, id);
            match l.kind {
                Kind::Sub => Value::Text(format!("{} Total", it)),
                _ => it,
            }
        };

        if pivot {
            let mut head = vec![vec![blank(); width]; head_rows];
            if show && head_rows > 0 {
                for (i, nm) in rd.names.iter().enumerate() {
                    head[head_rows - 1][i] = Value::Text(nm.clone());
                }
            }
            let mut prev: Vec<Option<Vec<usize>>> = vec![None; kc];
            for (ci, l) in cl.iter().enumerate() {
                let x0 = kr + ci * nv;
                for lv in 0..kc {
                    let put = match l.kind {
                        Kind::Grand => (lv == 0).then(|| Value::Text("Total".into())),
                        Kind::Sub => (lv + 1 == l.path.len()).then(|| label(cdim, l, lv)),
                        Kind::Leaf => (prev[lv].as_deref() != Some(&l.path[..=lv])).then(|| label(cdim, l, lv)),
                    };
                    if let Some(v) = put {
                        head[lv][x0] = v;
                    }
                    prev[lv] = Some(l.path.iter().take(lv + 1).copied().collect());
                }
                if nv > 1 {
                    for vc in 0..m {
                        for f in 0..nf {
                            head[kc][x0 + vc * nf + f] = vname(vc, f);
                        }
                    }
                }
            }
            for r in head {
                data.extend(r);
            }
        } else if show {
            for nm in &rd.names {
                data.push(Value::Text(nm.clone()));
            }
            for vc in 0..m {
                for f in 0..nf {
                    data.push(vname(vc, f));
                }
            }
        }

        let mut prev: Option<Vec<usize>> = None;
        let mut body_rows = 0;
        for l in &rl {
            let mut row = vec![blank(); kr];
            match l.kind {
                Kind::Grand => {
                    if kr > 0 {
                        row[0] = Value::Text("Total".into());
                    }
                }
                Kind::Sub => {
                    let lv = l.path.len() - 1;
                    row[lv] = label(&rd, l, lv);
                    prev = Some(l.path.clone());
                }
                Kind::Leaf => {
                    let same = prev.as_ref().map_or(0, |p| p.iter().zip(&l.path).take_while(|(x, y)| x == y).count());
                    for lv in same..kr {
                        row[lv] = label(&rd, l, lv);
                    }
                    prev = Some(l.path.clone());
                }
            }
            let rrecs: Vec<usize> = keep.iter().copied().filter(|&r| hit(&rd, l, r)).collect();
            for c in &cl {
                let cur: Vec<usize> = rrecs.iter().copied().filter(|&r| hit(cdim, c, r)).collect();
                let rel: Vec<usize> = match relative {
                    1 => rrecs.clone(),
                    2 => keep.clone(),
                    3 => {
                        let pl = Line { path: c.path[..c.path.len().saturating_sub(1)].to_vec(), kind: Kind::Grand };
                        rrecs.iter().copied().filter(|&r| hit(cdim, &pl, r)).collect()
                    }
                    4 => {
                        let pl = Line { path: l.path[..l.path.len().saturating_sub(1)].to_vec(), kind: Kind::Grand };
                        keep.iter().copied().filter(|&r| hit(&rd, &pl, r) && hit(cdim, c, r)).collect()
                    }
                    _ => keep.iter().copied().filter(|&r| hit(cdim, c, r)).collect(),
                };
                for vc in 0..m {
                    for f in 0..nf {
                        row.push(if cur.is_empty() { blank() } else { cell(&cur, vc, f, &rel) });
                    }
                }
            }
            data.extend(row);
            body_rows += 1;
        }
        let rows = head_rows + body_rows;
        if rows == 0 || width == 0 {
            return Err(ErrKind::Calc);
        }
        Ok(Arg::A(Array { rows, cols: width, data }))
    }
}
