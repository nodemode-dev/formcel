use crate::dax::{self, Flt, D};
use crate::datamodel::{key_of, Model, CONN_NAME};
use crate::formula::{ErrKind, Expr};
use crate::Value;
use std::cmp::Ordering;
use std::collections::HashSet;

pub const CUBE_FNS: [&str; 7] = ["CUBEKPIMEMBER", "CUBEMEMBER", "CUBEMEMBERPROPERTY", "CUBERANKEDMEMBER", "CUBESET", "CUBESETCOUNT", "CUBEVALUE"];

pub fn uses_cube(e: &Expr) -> bool {
    match e {
        Expr::Call(n, _) if CUBE_FNS.contains(&n.as_str()) => true,
        o => crate::formula::children(o).into_iter().any(uses_cube),
    }
}

type R<T> = Result<T, ErrKind>;

#[derive(Clone, Debug, PartialEq)]
enum Seg {
    Name(String),
    Key(Vec<String>),
    Word(String),
}

#[derive(Clone, Debug)]
enum X {
    Path(Vec<Seg>),
    Tuple(Vec<X>),
    Set(Vec<X>),
    Cross(Box<X>, Box<X>),
    Call(String, Vec<X>),
    Num(f64),
    Str(String),
}

struct Lx<'a> {
    c: Vec<char>,
    i: usize,
    _s: &'a str,
}

impl Lx<'_> {
    fn ws(&mut self) {
        while self.i < self.c.len() && self.c[self.i].is_whitespace() {
            self.i += 1;
        }
    }

    fn peek(&mut self) -> Option<char> {
        self.ws();
        self.c.get(self.i).copied()
    }

    fn bracket(&mut self) -> R<String> {
        self.i += 1;
        let mut s = String::new();
        loop {
            match self.c.get(self.i) {
                None => return Err(ErrKind::Na),
                Some(']') if self.c.get(self.i + 1) == Some(&']') => {
                    s.push(']');
                    self.i += 2;
                }
                Some(']') => {
                    self.i += 1;
                    return Ok(s);
                }
                Some(c) => {
                    s.push(*c);
                    self.i += 1;
                }
            }
        }
    }

    fn word(&mut self) -> String {
        let st = self.i;
        while self.i < self.c.len() && (self.c[self.i].is_alphanumeric() || self.c[self.i] == '_' || self.c[self.i] == '$') {
            self.i += 1;
        }
        self.c[st..self.i].iter().collect()
    }

    fn expr(&mut self) -> R<X> {
        let mut l = self.term()?;
        while self.peek() == Some('*') {
            self.i += 1;
            l = X::Cross(Box::new(l), Box::new(self.term()?));
        }
        Ok(l)
    }

    fn list(&mut self, close: char) -> R<Vec<X>> {
        let mut items = Vec::new();
        if self.peek() == Some(close) {
            self.i += 1;
            return Ok(items);
        }
        loop {
            items.push(self.expr()?);
            match self.peek() {
                Some(',') => self.i += 1,
                Some(c) if c == close => {
                    self.i += 1;
                    return Ok(items);
                }
                _ => return Err(ErrKind::Na),
            }
        }
    }

    fn term(&mut self) -> R<X> {
        match self.peek() {
            Some('{') => {
                self.i += 1;
                Ok(X::Set(self.list('}')?))
            }
            Some('(') => {
                self.i += 1;
                let mut items = self.list(')')?;
                if items.len() == 1 {
                    Ok(items.remove(0))
                } else {
                    Ok(X::Tuple(items))
                }
            }
            Some('"') => {
                self.i += 1;
                let mut s = String::new();
                loop {
                    match self.c.get(self.i) {
                        None => return Err(ErrKind::Na),
                        Some('"') if self.c.get(self.i + 1) == Some(&'"') => {
                            s.push('"');
                            self.i += 2;
                        }
                        Some('"') => {
                            self.i += 1;
                            return Ok(X::Str(s));
                        }
                        Some(c) => {
                            s.push(*c);
                            self.i += 1;
                        }
                    }
                }
            }
            Some(c) if c.is_ascii_digit() || c == '-' => {
                let st = self.i;
                self.i += 1;
                while self.i < self.c.len() && (self.c[self.i].is_ascii_digit() || self.c[self.i] == '.') {
                    self.i += 1;
                }
                let t: String = self.c[st..self.i].iter().collect();
                t.parse().map(X::Num).map_err(|_| ErrKind::Na)
            }
            Some('[' | '&') => self.path(Vec::new()),
            Some(c) if c.is_alphabetic() || c == '$' || c == '_' => {
                let w = self.word();
                if self.peek() == Some('(') {
                    self.i += 1;
                    return Ok(X::Call(w.to_ascii_uppercase(), self.list(')')?));
                }
                self.path(vec![Seg::Word(w)])
            }
            _ => Err(ErrKind::Na),
        }
    }

    fn path(&mut self, mut segs: Vec<Seg>) -> R<X> {
        loop {
            match self.peek() {
                Some('[') if segs.is_empty() => segs.push(Seg::Name(self.bracket()?)),
                Some('&') => {
                    let mut keys = Vec::new();
                    while self.peek() == Some('&') {
                        self.i += 1;
                        if self.peek() != Some('[') {
                            return Err(ErrKind::Na);
                        }
                        keys.push(self.bracket()?);
                    }
                    segs.push(Seg::Key(keys));
                }
                Some('.') => {
                    self.i += 1;
                    match self.peek() {
                        Some('[') => segs.push(Seg::Name(self.bracket()?)),
                        Some('&') => continue,
                        Some(c) if c.is_alphabetic() => segs.push(Seg::Word(self.word().to_ascii_uppercase())),
                        _ => return Err(ErrKind::Na),
                    }
                }
                _ => break,
            }
        }
        if segs.is_empty() {
            return Err(ErrKind::Na);
        }
        Ok(X::Path(segs))
    }
}

fn parse(s: &str) -> R<X> {
    let mut lx = Lx { c: s.chars().collect(), i: 0, _s: s };
    let x = lx.expr()?;
    if lx.peek().is_some() {
        return Err(ErrKind::Na);
    }
    Ok(x)
}

#[derive(Clone, Debug, PartialEq)]
enum Meas {
    Defined(usize),
    Implicit(String, usize, usize),
    Kpi(usize, u8),
}

#[derive(Clone, Debug)]
struct Mem {
    dim: String,
    caption: String,
    uname: String,
    all: bool,
    filt: Vec<(usize, usize, String)>,
    meas: Option<Meas>,
    level: usize,
    hier: Option<usize>,
    prop_key: String,
}

type Tup = Vec<Mem>;

fn lc(s: &str) -> String {
    s.to_lowercase()
}

fn natural(a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (Value::Number(_), _) => Ordering::Less,
        (_, Value::Number(_)) => Ordering::Greater,
        _ => lc(&a.to_string()).cmp(&lc(&b.to_string())),
    }
}

const IMPLICIT: [(&str, &str); 6] = [("Sum of ", "SUM"), ("Count of ", "COUNT"), ("Average of ", "AVERAGE"), ("Min of ", "MIN"), ("Max of ", "MAX"), ("Distinct Count of ", "DISTINCTCOUNT")];

impl Model {
    fn members_of(&self, t: usize, c: usize, within: &[(usize, usize, String)]) -> Vec<Value> {
        let col = &self.tables[t].cols[c].data;
        let mut seen = HashSet::new();
        let mut out: Vec<Value> = Vec::new();
        for r in 0..self.tables[t].rows {
            if within.iter().any(|(_, wc, k)| lc(&self.tables[t].cols[*wc].data[r].to_string()) != lc(k)) {
                continue;
            }
            let v = &col[r];
            if *v != Value::Empty && seen.insert(key_of(v)) {
                out.push(v.clone());
            }
        }
        out.sort_by(natural);
        out
    }

    fn col_mem(&self, t: usize, c: usize, key: Option<&str>) -> R<Mem> {
        let dim = format!("{}.{}", self.tables[t].name, self.tables[t].cols[c].name);
        let base = format!("[{}].[{}]", self.tables[t].name, self.tables[t].cols[c].name);
        match key {
            None => Ok(Mem { dim, caption: "All".into(), uname: format!("{base}.[All]"), all: true, filt: Vec::new(), meas: None, level: 0, hier: None, prop_key: String::new() }),
            Some(k) => {
                let v = self.members_of(t, c, &[]).into_iter().find(|v| lc(&v.to_string()) == lc(k)).ok_or(ErrKind::Na)?;
                Ok(Mem { dim, caption: v.to_string(), uname: format!("{base}.&[{v}]"), all: false, filt: vec![(t, c, v.to_string())], meas: None, level: 1, hier: None, prop_key: v.to_string() })
            }
        }
    }

    fn hier_mem(&self, h: usize, level: usize, keys: &[String]) -> R<Mem> {
        let hr = &self.hiers[h];
        let t = self.tidx(&hr.table).ok_or(ErrKind::Na)?;
        let dim = format!("{}.{}", hr.table, hr.name);
        let base = format!("[{}].[{}]", hr.table, hr.name);
        if keys.is_empty() {
            return Ok(Mem { dim, caption: "All".into(), uname: format!("{base}.[All]"), all: true, filt: Vec::new(), meas: None, level: 0, hier: Some(h), prop_key: String::new() });
        }
        let last = keys.last().cloned().unwrap_or_default();
        let c = self.cidx(t, &hr.levels[level]).ok_or(ErrKind::Na)?;
        let mut filt = Vec::new();
        for (i, k) in keys.iter().rev().enumerate() {
            if i > level {
                break;
            }
            let lv = level - i;
            let lc_ = self.cidx(t, &hr.levels[lv]).ok_or(ErrKind::Na)?;
            filt.push((t, lc_, k.clone()));
        }
        let exists = self.members_of(t, c, &filt[1..]).into_iter().any(|v| lc(&v.to_string()) == lc(&last));
        if !exists {
            return Err(ErrKind::Na);
        }
        let shown = self.members_of(t, c, &filt[1..]).into_iter().find(|v| lc(&v.to_string()) == lc(&last)).map(|v| v.to_string()).unwrap_or(last.clone());
        filt[0].2 = shown.clone();
        let path: String = keys.iter().map(|k| format!("&[{k}]")).collect();
        Ok(Mem { dim, caption: shown.clone(), uname: format!("{base}.[{}].{}", hr.levels[level], path), all: false, filt, meas: None, level: level + 1, hier: Some(h), prop_key: shown })
    }

    fn measure_mem(&self, name: &str) -> R<Mem> {
        let mk = |caption: String, m: Meas| Mem { dim: "Measures".into(), uname: format!("[Measures].[{caption}]"), caption, all: false, filt: Vec::new(), meas: Some(m), level: 1, hier: None, prop_key: String::new() };
        if let Some(i) = self.midx(name) {
            return Ok(mk(self.measures[i].name.clone(), Meas::Defined(i)));
        }
        for (prefix, f) in IMPLICIT {
            if let Some(col) = name.strip_prefix(prefix).or_else(|| name.get(..prefix.len()).filter(|p| p.eq_ignore_ascii_case(prefix)).map(|_| &name[prefix.len()..])) {
                for (ti, t) in self.tables.iter().enumerate() {
                    if let Some(ci) = self.cidx(ti, col) {
                        return Ok(mk(format!("{prefix}{}", t.cols[ci].name), Meas::Implicit(f.to_string(), ti, ci)));
                    }
                }
            }
        }
        Err(ErrKind::Na)
    }

    fn resolve(&self, segs: &[Seg]) -> R<Vec<Mem>> {
        let mut it = segs.iter().peekable();
        let first = match it.next() {
            Some(Seg::Name(n)) => n.clone(),
            _ => return Err(ErrKind::Na),
        };
        let rest: Vec<&Seg> = it.collect();
        if first.eq_ignore_ascii_case("Measures") {
            return match rest.as_slice() {
                [Seg::Name(n)] => Ok(vec![self.measure_mem(n)?]),
                [Seg::Word(w)] if w == "MEMBERS" || w == "CHILDREN" || w == "ALLMEMBERS" => self.measures.iter().map(|m| self.measure_mem(&m.name)).collect(),
                _ => Err(ErrKind::Na),
            };
        }
        let t = self.tidx(&first).ok_or(ErrKind::Na)?;
        let second = match rest.first() {
            Some(Seg::Name(n)) => n.clone(),
            _ => return Err(ErrKind::Na),
        };
        let tail = &rest[1..];
        if let Some(h) = self.hiers.iter().position(|h| h.table.eq_ignore_ascii_case(&self.tables[t].name) && h.name.eq_ignore_ascii_case(&second)) {
            return self.resolve_hier(h, tail);
        }
        let c = self.cidx(t, &second).ok_or(ErrKind::Na)?;
        let cname = &self.tables[t].cols[c].name;
        let mut tail: Vec<&Seg> = tail.to_vec();
        let mut level_given = false;
        if let Some(Seg::Name(n)) = tail.first() {
            if n.eq_ignore_ascii_case(cname) && tail.len() >= 2 {
                tail.remove(0);
                level_given = true;
            }
        }
        let all_members = |with_all: bool| -> R<Vec<Mem>> {
            let mut out = Vec::new();
            if with_all {
                out.push(self.col_mem(t, c, None)?);
            }
            for v in self.members_of(t, c, &[]) {
                out.push(self.col_mem(t, c, Some(&v.to_string()))?);
            }
            Ok(out)
        };
        match tail.as_slice() {
            [] => Ok(vec![self.col_mem(t, c, None)?]),
            [Seg::Name(n)] if n.eq_ignore_ascii_case("All") => Ok(vec![self.col_mem(t, c, None)?]),
            [Seg::Name(n), Seg::Word(w)] if n.eq_ignore_ascii_case("All") && (w == "CHILDREN" || w == "MEMBERS" || w == "ALLMEMBERS") => all_members(w != "CHILDREN"),
            [Seg::Key(k)] => Ok(vec![self.col_mem(t, c, k.last().map(String::as_str))?]),
            [Seg::Name(n)] => Ok(vec![self.col_mem(t, c, Some(n))?]),
            [Seg::Word(w)] if w == "MEMBERS" || w == "ALLMEMBERS" => all_members(!level_given),
            [Seg::Word(w)] if w == "CHILDREN" => all_members(false),
            _ => Err(ErrKind::Na),
        }
    }

    fn resolve_hier(&self, h: usize, tail: &[&Seg]) -> R<Vec<Mem>> {
        let levels = self.hiers[h].levels.clone();
        let t = self.tidx(&self.hiers[h].table).ok_or(ErrKind::Na)?;
        let children = |of: &Mem| -> R<Vec<Mem>> {
            let next = if of.all { 0 } else { of.level };
            if next >= levels.len() {
                return Ok(Vec::new());
            }
            let c = self.cidx(t, &levels[next]).ok_or(ErrKind::Na)?;
            let mut out = Vec::new();
            for v in self.members_of(t, c, &of.filt) {
                let mut keys: Vec<String> = of.filt.iter().rev().map(|f| f.2.clone()).collect();
                keys.push(v.to_string());
                out.push(self.hier_mem(h, next, &keys)?);
            }
            Ok(out)
        };
        let level_of = |n: &str| levels.iter().position(|l| l.eq_ignore_ascii_case(n));
        match tail {
            [] => Ok(vec![self.hier_mem(h, 0, &[])?]),
            [Seg::Name(n)] if n.eq_ignore_ascii_case("All") => Ok(vec![self.hier_mem(h, 0, &[])?]),
            [Seg::Name(n), Seg::Word(w)] if n.eq_ignore_ascii_case("All") && (w == "CHILDREN" || w == "MEMBERS" || w == "ALLMEMBERS") => {
                let top = self.hier_mem(h, 0, &[])?;
                let mut out = if w == "CHILDREN" { Vec::new() } else { vec![top.clone()] };
                if w == "CHILDREN" {
                    out.extend(children(&top)?);
                } else {
                    let mut frontier = children(&top)?;
                    while !frontier.is_empty() {
                        out.extend(frontier.clone());
                        frontier = frontier.iter().map(&children).collect::<R<Vec<_>>>()?.into_iter().flatten().collect();
                    }
                }
                Ok(out)
            }
            [Seg::Name(n), Seg::Word(w)] if level_of(n).is_some() && (w == "MEMBERS" || w == "ALLMEMBERS") => {
                let lv = level_of(n).ok_or(ErrKind::Na)?;
                let c = self.cidx(t, &levels[lv]).ok_or(ErrKind::Na)?;
                let mut out = Vec::new();
                let mut seen = HashSet::new();
                for r in 0..self.tables[t].rows {
                    let keys: Vec<String> = (0..=lv).map(|i| self.cidx(t, &levels[i]).map(|ci| self.tables[t].cols[ci].data[r].to_string()).unwrap_or_default()).collect();
                    if self.tables[t].cols[c].data[r] != Value::Empty && seen.insert(keys.join("\u{1f}")) {
                        out.push(keys);
                    }
                }
                out.sort_by(|a, b| a.iter().zip(b).map(|(x, y)| natural(&Value::Text(x.clone()), &Value::Text(y.clone()))).find(|o| *o != Ordering::Equal).unwrap_or(Ordering::Equal));
                out.iter().map(|k| self.hier_mem(h, lv, k)).collect()
            }
            [Seg::Name(n), Seg::Key(k)] if level_of(n).is_some() => Ok(vec![self.hier_mem(h, level_of(n).unwrap_or(0), k)?]),
            [Seg::Name(n), Seg::Key(k), Seg::Word(w)] if level_of(n).is_some() && w == "CHILDREN" => {
                let m = self.hier_mem(h, level_of(n).unwrap_or(0), k)?;
                children(&m)
            }
            [Seg::Name(n), Seg::Name(m)] if level_of(n).is_some() => Ok(vec![self.hier_mem(h, level_of(n).unwrap_or(0), &[m.clone()])?]),
            _ => Err(ErrKind::Na),
        }
    }

    fn tuple_of(&self, x: &X) -> R<Tup> {
        match x {
            X::Path(p) => {
                let m = self.resolve(p)?;
                if m.len() == 1 {
                    Ok(m)
                } else {
                    Err(ErrKind::Na)
                }
            }
            X::Tuple(items) => {
                let mut out = Vec::new();
                for i in items {
                    out.extend(self.tuple_of(i)?);
                }
                self.check_tuple(&out)?;
                Ok(out)
            }
            X::Set(items) if items.len() == 1 => self.tuple_of(&items[0]),
            X::Call(n, a) if n == "$RANK" => {
                let set = self.set_of(a.first().ok_or(ErrKind::Na)?)?;
                let X::Num(r) = a.get(1).ok_or(ErrKind::Na)? else { return Err(ErrKind::Na) };
                set.get((*r as usize).wrapping_sub(1)).cloned().ok_or(ErrKind::Na)
            }
            X::Call(n, a) if n == "$KPI" => {
                let (X::Str(name), Some(X::Num(p))) = (a.first().ok_or(ErrKind::Na)?, a.get(1)) else { return Err(ErrKind::Na) };
                Ok(vec![self.kpi_mem(name, *p as u8)?])
            }
            _ => Err(ErrKind::Na),
        }
    }

    fn check_tuple(&self, t: &Tup) -> R<()> {
        for (i, a) in t.iter().enumerate() {
            if t[..i].iter().any(|b| b.dim == a.dim) {
                return Err(ErrKind::Na);
            }
        }
        Ok(())
    }

    fn kpi_mem(&self, name: &str, prop: u8) -> R<Mem> {
        let ki = self.kpis.iter().position(|k| k.name.eq_ignore_ascii_case(name)).ok_or(ErrKind::Na)?;
        if !(1..=3).contains(&prop) {
            return Err(ErrKind::Na);
        }
        let k = &self.kpis[ki];
        let tag = ["", "", "Goal", "Status"][prop as usize];
        let caption = if prop == 1 { k.name.clone() } else { format!("{} {tag}", k.name) };
        Ok(Mem { dim: "Measures".into(), uname: format!("[Measures].[{caption}]"), caption, all: false, filt: Vec::new(), meas: Some(Meas::Kpi(ki, prop)), level: 1, hier: None, prop_key: String::new() })
    }

    fn set_of(&self, x: &X) -> R<Vec<Tup>> {
        match x {
            X::Path(p) => Ok(self.resolve(p)?.into_iter().map(|m| vec![m]).collect()),
            X::Tuple(_) => Ok(vec![self.tuple_of(x)?]),
            X::Set(items) => {
                let mut out: Vec<Tup> = Vec::new();
                let mut seen = HashSet::new();
                for i in items {
                    for t in self.set_of(i)? {
                        if seen.insert(t.iter().map(|m| m.uname.clone()).collect::<Vec<_>>().join("|")) {
                            out.push(t);
                        }
                    }
                }
                Ok(out)
            }
            X::Cross(a, b) => {
                let (l, r) = (self.set_of(a)?, self.set_of(b)?);
                let mut out = Vec::new();
                for x in &l {
                    for y in &r {
                        let mut t = x.clone();
                        t.extend(y.clone());
                        self.check_tuple(&t)?;
                        out.push(t);
                    }
                }
                Ok(out)
            }
            X::Call(n, a) => match n.as_str() {
                "$RANK" | "$KPI" => Ok(vec![self.tuple_of(x)?]),
                "$SORT" => {
                    let set = self.set_of(a.first().ok_or(ErrKind::Na)?)?;
                    let order = match a.get(1) {
                        Some(X::Num(n)) => *n as i32,
                        _ => 0,
                    };
                    let by = match a.get(2) {
                        Some(X::Str(s)) if !s.is_empty() => Some(parse(s)?),
                        _ => None,
                    };
                    self.sorted(set, order, by.as_ref())
                }
                "ORDER" => {
                    let set = self.set_of(a.first().ok_or(ErrKind::Na)?)?;
                    let dir = match a.get(2) {
                        Some(X::Path(p)) => match p.first() {
                            Some(Seg::Word(w)) => w.to_ascii_uppercase(),
                            _ => "ASC".into(),
                        },
                        _ => "ASC".into(),
                    };
                    let order = if dir.contains("DESC") { 2 } else { 1 };
                    self.sorted(set, order, a.get(1))
                }
                "TOPCOUNT" | "BOTTOMCOUNT" => {
                    let set = self.set_of(a.first().ok_or(ErrKind::Na)?)?;
                    let X::Num(k) = a.get(1).ok_or(ErrKind::Na)? else { return Err(ErrKind::Na) };
                    let mut s = self.sorted(set, if n == "TOPCOUNT" { 2 } else { 1 }, a.get(2))?;
                    s.truncate(*k as usize);
                    Ok(s)
                }
                "HEAD" | "TAIL" => {
                    let mut set = self.set_of(a.first().ok_or(ErrKind::Na)?)?;
                    let k = match a.get(1) {
                        Some(X::Num(k)) => *k as usize,
                        _ => 1,
                    };
                    if n == "HEAD" {
                        set.truncate(k);
                    } else {
                        let at = set.len().saturating_sub(k);
                        set = set.split_off(at);
                    }
                    Ok(set)
                }
                "CROSSJOIN" => {
                    let l = a.first().ok_or(ErrKind::Na)?;
                    let r = a.get(1).ok_or(ErrKind::Na)?;
                    self.set_of(&X::Cross(Box::new(l.clone()), Box::new(r.clone())))
                }
                "DISTINCT" => self.set_of(a.first().ok_or(ErrKind::Na)?),
                _ => Err(ErrKind::Na),
            },
            _ => Err(ErrKind::Na),
        }
    }

    fn sorted(&self, mut set: Vec<Tup>, order: i32, by: Option<&X>) -> R<Vec<Tup>> {
        match order {
            0 => {}
            1 | 2 => {
                let by = by.ok_or(ErrKind::Value)?;
                let m = self.tuple_of(by)?;
                let mut keyed: Vec<(f64, Tup)> = Vec::with_capacity(set.len());
                for t in set {
                    let mut all = t.clone();
                    all.extend(m.clone());
                    let v = match self.value_of(&all, &[]) {
                        Ok(Value::Number(n)) => n,
                        _ => f64::NEG_INFINITY,
                    };
                    keyed.push((v, t));
                }
                keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
                if order == 2 {
                    keyed.reverse();
                }
                set = keyed.into_iter().map(|k| k.1).collect();
            }
            3..=6 => {
                let last = |t: &Tup| t.last().map(|m| lc(&m.caption)).unwrap_or_default();
                if order <= 4 {
                    set.sort_by_key(last);
                } else {
                    set.sort_by(|a, b| {
                        let (x, y) = (a.last(), b.last());
                        match (x, y) {
                            (Some(x), Some(y)) => natural(&Value::Text(x.prop_key.clone()).as_num(), &Value::Text(y.prop_key.clone()).as_num()),
                            _ => Ordering::Equal,
                        }
                    });
                }
                if order == 4 || order == 6 {
                    set.reverse();
                }
            }
            _ => return Err(ErrKind::Value),
        }
        Ok(set)
    }

    fn flts(&self, tuples: &[&Tup]) -> R<Vec<Flt>> {
        let mut out: Vec<Flt> = Vec::new();
        let mut cols: Vec<(usize, usize)> = Vec::new();
        for t in tuples {
            for m in t.iter() {
                for (ti, ci, _) in &m.filt {
                    if !cols.contains(&(*ti, *ci)) {
                        cols.push((*ti, *ci));
                    }
                }
            }
        }
        for (ti, ci) in cols {
            let mut union: HashSet<String> = HashSet::new();
            let mut any_unconstrained = false;
            for t in tuples {
                let mut here: Option<HashSet<String>> = None;
                for m in t.iter() {
                    for (a, b, k) in m.filt.iter().filter(|f| f.0 == ti && f.1 == ci) {
                        let keys: HashSet<String> = self.tables[*a].cols[*b].data.iter().filter(|v| lc(&v.to_string()) == lc(k) && **v != Value::Empty).map(key_of).collect();
                        here = Some(match here {
                            None => keys,
                            Some(h) => h.intersection(&keys).cloned().collect(),
                        });
                    }
                }
                match here {
                    Some(h) => union.extend(h),
                    None => any_unconstrained = true,
                }
            }
            if any_unconstrained {
                continue;
            }
            if union.is_empty() {
                return Err(ErrKind::Na);
            }
            out.push(Flt { t: ti, c: ci, keys: union.into_iter().collect() });
        }
        Ok(out)
    }

    fn value_of(&self, tuple: &Tup, slicers: &[Vec<Tup>]) -> R<Value> {
        let mut groups: Vec<&Tup> = vec![tuple];
        let mut by_col: Vec<Vec<&Tup>> = Vec::new();
        for s in slicers {
            by_col.push(s.iter().collect());
        }
        let mut filters = self.flts(&groups)?;
        for g in &by_col {
            for f in self.flts(g)? {
                match filters.iter_mut().find(|x| x.t == f.t && x.c == f.c) {
                    Some(x) => {
                        let keep: HashSet<&String> = f.keys.iter().collect();
                        x.keys.retain(|k| keep.contains(k));
                        if x.keys.is_empty() {
                            return Err(ErrKind::Na);
                        }
                    }
                    None => filters.push(f),
                }
            }
        }
        groups.clear();
        let meas = tuple.iter().find_map(|m| m.meas.clone()).or_else(|| slicers.iter().flatten().flatten().find_map(|m| m.meas.clone()));
        let meas = match meas {
            Some(m) => m,
            None => Meas::Defined(0),
        };
        if matches!(meas, Meas::Defined(i) if i >= self.measures.len()) {
            return Err(ErrKind::Na);
        }
        let v = self.meas_value(&meas, &filters)?;
        Ok(if v == Value::Empty { Value::Text(String::new()) } else { v })
    }

    fn meas_value(&self, m: &Meas, f: &[Flt]) -> R<Value> {
        let run = |r: Result<Value, String>| r.map_err(|_| ErrKind::Value);
        match m {
            Meas::Defined(i) => run(dax::measure(self, *i, f)),
            Meas::Implicit(func, t, c) => {
                let d = D::Call(func.clone(), vec![D::Col(Some(self.tables[*t].name.clone()), self.tables[*t].cols[*c].name.clone())]);
                run(dax::expr(self, &d, f))
            }
            Meas::Kpi(k, p) => {
                let kp = &self.kpis[*k];
                let mi = self.midx(&kp.value).ok_or(ErrKind::Na)?;
                let goal = || -> R<Value> {
                    match self.midx(&kp.goal) {
                        Some(g) => run(dax::measure(self, g, f)),
                        None => kp.goal.trim().parse().map(Value::Number).map_err(|_| ErrKind::Na),
                    }
                };
                match p {
                    1 => run(dax::measure(self, mi, f)),
                    2 => goal(),
                    _ => {
                        let (Value::Number(v), Value::Number(g)) = (run(dax::measure(self, mi, f))?, goal()?) else { return Ok(Value::Empty) };
                        if g == 0.0 {
                            return Ok(Value::Empty);
                        }
                        let ratio = v / g;
                        Ok(Value::Number(if ratio < kp.lo { -1.0 } else if ratio < kp.hi { 0.0 } else { 1.0 }))
                    }
                }
            }
        }
    }

    fn arg<'a>(&self, a: &'a [String], i: usize) -> Option<&'a str> {
        a.get(i).map(String::as_str).filter(|s| !s.is_empty())
    }

    pub fn cube(&self, op: &str, a: &[String]) -> R<Value> {
        let conn = a.first().map(String::as_str).unwrap_or("");
        if op == "CUBESETCOUNT" {
            return Ok(Value::Number(self.set_of(&parse(conn)?)?.len() as f64));
        }
        if !conn.eq_ignore_ascii_case(CONN_NAME) {
            return Err(if self.conns.iter().any(|c| c.name.eq_ignore_ascii_case(conn)) { ErrKind::Na } else { ErrKind::Name });
        }
        let text = |s: &str| Ok(Value::Text(s.to_string()));
        match op {
            "CUBEMEMBER" => {
                let t = self.tuple_of(&parse(a.get(1).ok_or(ErrKind::Na)?)?)?;
                match self.arg(a, 2) {
                    Some(c) => text(c),
                    None => text(&t.last().map(|m| m.caption.clone()).unwrap_or_default()),
                }
            }
            "CUBEVALUE" => {
                let mut tuple: Tup = Vec::new();
                let mut slicers: Vec<Vec<Tup>> = Vec::new();
                for s in a.iter().skip(1) {
                    if s.is_empty() {
                        continue;
                    }
                    let x = parse(s)?;
                    let multi = matches!(&x, X::Set(i) if i.len() != 1) || matches!(&x, X::Call(n, _) if n == "$SORT" || n == "ORDER") || matches!(&x, X::Cross(..));
                    match if multi { Err(ErrKind::Na) } else { self.tuple_of(&x) } {
                        Ok(t) => {
                            tuple.extend(t);
                            self.check_tuple(&tuple)?;
                        }
                        Err(_) => {
                            let set = self.set_of(&x)?;
                            if set.is_empty() {
                                return Err(ErrKind::Na);
                            }
                            slicers.push(set);
                        }
                    }
                }
                self.value_of(&tuple, &slicers)
            }
            "CUBESET" => {
                let order = self.arg(a, 3).map_or(Ok(0), |s| s.trim().parse::<i32>().map_err(|_| ErrKind::Value))?;
                if !(0..=6).contains(&order) {
                    return Err(ErrKind::Value);
                }
                if (order == 1 || order == 2) && self.arg(a, 4).is_none() {
                    return Err(ErrKind::Value);
                }
                let by = self.arg(a, 4).map(parse).transpose()?;
                let set = self.sorted(self.set_of(&parse(a.get(1).ok_or(ErrKind::Na)?)?)?, order, by.as_ref())?;
                match self.arg(a, 2) {
                    Some(c) => text(c),
                    None => text(&set.iter().map(|t| t.last().map(|m| m.caption.clone()).unwrap_or_default()).collect::<Vec<_>>().join(", ")),
                }
            }
            "CUBERANKEDMEMBER" => {
                let set = self.set_of(&parse(a.get(1).ok_or(ErrKind::Na)?)?)?;
                let rank: f64 = a.get(2).and_then(|s| s.trim().parse().ok()).ok_or(ErrKind::Value)?;
                if rank < 1.0 {
                    return Err(ErrKind::Value);
                }
                let t = set.get(rank as usize - 1).ok_or(ErrKind::Na)?;
                match self.arg(a, 3) {
                    Some(c) => text(c),
                    None => text(&t.last().map(|m| m.caption.clone()).unwrap_or_default()),
                }
            }
            "CUBEMEMBERPROPERTY" => {
                let t = self.tuple_of(&parse(a.get(1).ok_or(ErrKind::Na)?)?)?;
                let m = t.last().ok_or(ErrKind::Na)?;
                let prop = a.get(2).map(|s| s.to_ascii_uppercase()).unwrap_or_default();
                let kids = |m: &Mem| -> f64 {
                    let Some(h) = m.hier else { return if m.all && m.meas.is_none() { m.filt.len() as f64 } else { 0.0 } };
                    let hr = &self.hiers[h];
                    let next = if m.all { 0 } else { m.level };
                    let Some(t) = self.tidx(&hr.table) else { return 0.0 };
                    match hr.levels.get(next).and_then(|l| self.cidx(t, l)) {
                        Some(c) => self.members_of(t, c, &m.filt).len() as f64,
                        None => 0.0,
                    }
                };
                match prop.as_str() {
                    "MEMBER_CAPTION" | "CAPTION" => text(&m.caption),
                    "MEMBER_UNIQUE_NAME" | "UNIQUENAME" | "UNIQUE_NAME" => text(&m.uname),
                    "MEMBER_NAME" | "NAME" => text(&m.caption),
                    "MEMBER_KEY" | "KEY" | "KEY0" => text(&m.prop_key),
                    "LEVEL_NUMBER" => Ok(Value::Number(m.level as f64)),
                    "CHILDREN_CARDINALITY" => Ok(Value::Number(kids(m))),
                    _ => Err(ErrKind::Na),
                }
            }
            "CUBEKPIMEMBER" => {
                let name = a.get(1).ok_or(ErrKind::Na)?;
                let p: u8 = match a.get(2).map(|s| s.trim()) {
                    Some(s) => s.parse::<f64>().map(|x| x as u8).map_err(|_| ErrKind::Na)?,
                    None => return Err(ErrKind::Na),
                };
                let m = self.kpi_mem(name, p)?;
                match self.arg(a, 3) {
                    Some(c) => text(c),
                    None => text(&m.caption),
                }
            }
            _ => Err(ErrKind::Name),
        }
    }
}

trait AsNum {
    fn as_num(self) -> Value;
}

impl AsNum for Value {
    fn as_num(self) -> Value {
        match &self {
            Value::Text(t) => t.trim().parse().map_or(self.clone(), Value::Number),
            _ => self,
        }
    }
}
