use crate::eval::compare;
use crate::formula::{self, Area, Expr, RefKind};
use crate::table::unique_names;
use crate::wire::{escape, unescape};
use crate::{Addr, Effect, EngineError, Tx, Value, Workbook};
use std::collections::HashMap;

const LIST: char = '\u{1f}';
const PART: char = '\u{1e}';
const CELL_LIMIT: usize = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Func {
    Sum,
    Count,
    Average,
    Max,
    Min,
    Product,
    CountNums,
    StDev,
    StDevP,
    Var,
    VarP,
}

const FUNCS: [(Func, &str, &str); 11] = [
    (Func::Sum, "sum", "Sum"),
    (Func::Count, "count", "Count"),
    (Func::Average, "average", "Average"),
    (Func::Max, "max", "Max"),
    (Func::Min, "min", "Min"),
    (Func::Product, "product", "Product"),
    (Func::CountNums, "countnums", "Count Numbers"),
    (Func::StDev, "stdev", "StdDev"),
    (Func::StDevP, "stdevp", "StdDevp"),
    (Func::Var, "var", "Var"),
    (Func::VarP, "varp", "Varp"),
];

impl Func {
    fn code(self) -> &'static str {
        FUNCS.iter().find(|f| f.0 == self).map_or("sum", |f| f.1)
    }

    fn label(self) -> &'static str {
        FUNCS.iter().find(|f| f.0 == self).map_or("Sum", |f| f.2)
    }

    fn parse(s: &str) -> Func {
        FUNCS.iter().find(|f| f.1 == s).map_or(Func::Sum, |f| f.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Show {
    Normal,
    Grand,
    Col,
    Row,
    Of,
    ParentRow,
    ParentCol,
    Parent,
    Diff,
    PctDiff,
    Running,
    PctRunning,
    RankAsc,
    RankDesc,
    Index,
}

const SHOWS: [(Show, &str); 15] = [
    (Show::Normal, "none"),
    (Show::Grand, "grand"),
    (Show::Col, "col"),
    (Show::Row, "row"),
    (Show::Of, "of"),
    (Show::ParentRow, "prow"),
    (Show::ParentCol, "pcol"),
    (Show::Parent, "parent"),
    (Show::Diff, "diff"),
    (Show::PctDiff, "pdiff"),
    (Show::Running, "run"),
    (Show::PctRunning, "prun"),
    (Show::RankAsc, "rankasc"),
    (Show::RankDesc, "rankdesc"),
    (Show::Index, "index"),
];

impl Show {
    fn code(self) -> &'static str {
        SHOWS.iter().find(|s| s.0 == self).map_or("none", |s| s.1)
    }

    fn parse(s: &str) -> Show {
        SHOWS.iter().find(|x| x.1 == s).map_or(Show::Normal, |x| x.0)
    }

    fn needs_base(self) -> bool {
        !matches!(self, Show::Normal | Show::Grand | Show::Col | Show::Row | Show::Index)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ValueField {
    pub field: String,
    pub func: Func,
    pub show: Show,
    pub name: String,
    pub base_field: String,
    pub base_item: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pivot {
    pub name: String,
    pub sheet: usize,
    pub row: u32,
    pub col: u32,
    pub src_sheet: usize,
    pub src: Area,
    pub table: String,
    pub grand_rows: bool,
    pub grand_cols: bool,
    pub subtotals: bool,
    pub auto: bool,
    pub out: Option<(usize, Area)>,
    pub rows: Vec<String>,
    pub cols: Vec<String>,
    pub values: Vec<ValueField>,
    pub filters: Vec<(String, Vec<String>)>,
    pub calc: Vec<(String, String)>,
    pub groups: Vec<Group>,
}

fn area_text(a: Area) -> String {
    format!("{},{},{},{}", a.r0, a.c0, a.r1, a.c1)
}

fn area_of(s: &str) -> Option<Area> {
    let n: Vec<u32> = s.split(',').filter_map(|x| x.parse().ok()).collect();
    (n.len() == 4 && n[0] <= n[2] && n[1] <= n[3] && n[2] < crate::MAX_ROWS && n[3] < crate::MAX_COLS).then(|| Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] })
}

fn join_list(items: &[String]) -> String {
    items.join(&LIST.to_string())
}

fn split_list(s: &str) -> Vec<String> {
    s.split(LIST).filter(|x| !x.is_empty()).map(str::to_string).collect()
}

impl Pivot {
    pub fn line(&self) -> String {
        let mut flags = String::new();
        for (on, ch) in [(self.grand_rows, 'r'), (self.grand_cols, 'c'), (self.subtotals, 's'), (self.auto, 'a')] {
            if on {
                flags.push(ch);
            }
        }
        let mut out = String::new();
        let put = |s: &str, out: &mut String| {
            escape(s, out);
            out.push('\t');
        };
        put(&self.name, &mut out);
        put(&self.sheet.to_string(), &mut out);
        put(&format!("{},{}", self.row, self.col), &mut out);
        put(&self.src_sheet.to_string(), &mut out);
        put(&area_text(self.src), &mut out);
        put(&self.table, &mut out);
        put(&flags, &mut out);
        put(&self.out.map_or(String::new(), |(s, a)| format!("{s}:{}", area_text(a))), &mut out);
        put(&join_list(&self.rows), &mut out);
        put(&join_list(&self.cols), &mut out);
        let vals: Vec<String> = self.values.iter().map(|v| [v.field.as_str(), v.func.code(), v.show.code(), v.name.as_str(), v.base_field.as_str(), v.base_item.as_str()].join(&PART.to_string())).collect();
        put(&join_list(&vals), &mut out);
        let filters: Vec<String> = self.filters.iter().map(|(f, items)| std::iter::once(f.as_str()).chain(items.iter().map(String::as_str)).collect::<Vec<_>>().join(&PART.to_string())).collect();
        put(&join_list(&filters), &mut out);
        let calc: Vec<String> = self.calc.iter().map(|(n, f)| [n.as_str(), f.as_str()].join(&PART.to_string())).collect();
        put(&join_list(&calc), &mut out);
        let groups: Vec<String> = self.groups.iter().map(Group::line).collect();
        put(&join_list(&groups), &mut out);
        out.pop();
        out
    }

    pub fn parse(line: &str) -> Option<Pivot> {
        let p: Vec<String> = line.split('\t').map(unescape).collect();
        if p.len() < 13 {
            return None;
        }
        let (r, c) = p[2].split_once(',')?;
        let (row, col): (u32, u32) = (r.parse().ok()?, c.parse().ok()?);
        if row >= crate::MAX_ROWS || col >= crate::MAX_COLS {
            return None;
        }
        let out = if p[7].is_empty() {
            None
        } else {
            let (s, a) = p[7].split_once(':')?;
            Some((s.parse().ok()?, area_of(a)?))
        };
        let values = split_list(&p[10])
            .iter()
            .filter_map(|v| {
                let q: Vec<&str> = v.split(PART).collect();
                (q.len() >= 4 && !q[0].is_empty()).then(|| ValueField { field: q[0].to_string(), func: Func::parse(q[1]), show: Show::parse(q[2]), name: q[3].to_string(), base_field: q.get(4).map_or(String::new(), |s| s.to_string()), base_item: q.get(5).map_or(String::new(), |s| s.to_string()) })
            })
            .collect();
        let filters = split_list(&p[11])
            .iter()
            .filter_map(|v| {
                let mut q = v.split(PART);
                let f = q.next()?.to_string();
                (!f.is_empty()).then(|| (f, q.map(str::to_string).collect()))
            })
            .collect();
        let calc = split_list(&p[12])
            .iter()
            .filter_map(|v| {
                let (n, f) = v.split_once(PART)?;
                (!n.is_empty()).then(|| (n.to_string(), f.to_string()))
            })
            .collect();
        let groups = p.get(13).map_or(Vec::new(), |g| split_list(g).iter().filter_map(|x| Group::parse(x)).collect());
        Some(Pivot {
            name: p[0].clone(),
            sheet: p[1].parse().ok()?,
            row,
            col,
            src_sheet: p[3].parse().ok()?,
            src: area_of(&p[4])?,
            table: p[5].clone(),
            grand_rows: p[6].contains('r'),
            grand_cols: p[6].contains('c'),
            subtotals: p[6].contains('s'),
            auto: p[6].contains('a'),
            out,
            rows: split_list(&p[8]),
            cols: split_list(&p[9]),
            values,
            filters,
            calc,
            groups,
        })
    }
}

#[derive(Debug)]
enum Node {
    Num(f64),
    Field(usize),
    Neg(Box<Node>),
    Pct(Box<Node>),
    Bin(char, Box<Node>, Box<Node>),
}

enum Tok {
    Num(f64),
    Field(usize),
    Op(char),
}

fn tokens(src: &str, fields: &[String]) -> Option<Vec<Tok>> {
    let cs: Vec<char> = src.trim().trim_start_matches('=').chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    let mut by_len: Vec<usize> = (0..fields.len()).collect();
    by_len.sort_by_key(|&f| std::cmp::Reverse(fields[f].chars().count()));
    while i < cs.len() {
        let c = cs[i];
        if c.is_whitespace() {
            i += 1;
        } else if c.is_ascii_digit() || c == '.' {
            let s = i;
            while i < cs.len() && (cs[i].is_ascii_digit() || cs[i] == '.') {
                i += 1;
            }
            out.push(Tok::Num(cs[s..i].iter().collect::<String>().parse().ok()?));
        } else if "+-*/^()%".contains(c) {
            out.push(Tok::Op(c));
            i += 1;
        } else if c == '\'' {
            let s = i + 1;
            let mut e = s;
            while e < cs.len() && cs[e] != '\'' {
                e += 1;
            }
            let name: String = cs[s..e.min(cs.len())].iter().collect();
            out.push(Tok::Field(fields.iter().position(|f| f.eq_ignore_ascii_case(&name))?));
            i = e + 1;
        } else {
            let rest: String = cs[i..].iter().collect::<String>().to_lowercase();
            let hit = by_len.iter().copied().find(|&f| {
                let n = fields[f].to_lowercase();
                rest.starts_with(&n) && rest[n.len()..].chars().next().is_none_or(|x| !(x.is_alphanumeric() || x == '_'))
            })?;
            out.push(Tok::Field(hit));
            i += fields[hit].chars().count();
        }
    }
    Some(out)
}

struct Parse {
    t: Vec<Tok>,
    i: usize,
}

impl Parse {
    fn op(&mut self, set: &str) -> Option<char> {
        if let Some(Tok::Op(c)) = self.t.get(self.i) {
            if set.contains(*c) {
                self.i += 1;
                return Some(*c);
            }
        }
        None
    }

    fn expr(&mut self) -> Option<Node> {
        let mut l = self.term()?;
        while let Some(o) = self.op("+-") {
            l = Node::Bin(o, Box::new(l), Box::new(self.term()?));
        }
        Some(l)
    }

    fn term(&mut self) -> Option<Node> {
        let mut l = self.pow()?;
        while let Some(o) = self.op("*/") {
            l = Node::Bin(o, Box::new(l), Box::new(self.pow()?));
        }
        Some(l)
    }

    fn pow(&mut self) -> Option<Node> {
        let l = self.unary()?;
        if let Some(o) = self.op("^") {
            return Some(Node::Bin(o, Box::new(l), Box::new(self.pow()?)));
        }
        Some(l)
    }

    fn unary(&mut self) -> Option<Node> {
        if self.op("-").is_some() {
            return Some(Node::Neg(Box::new(self.unary()?)));
        }
        if self.op("+").is_some() {
            return self.unary();
        }
        let mut n = self.primary()?;
        while self.op("%").is_some() {
            n = Node::Pct(Box::new(n));
        }
        Some(n)
    }

    fn primary(&mut self) -> Option<Node> {
        match self.t.get(self.i)? {
            Tok::Num(n) => {
                self.i += 1;
                Some(Node::Num(*n))
            }
            Tok::Field(f) => {
                self.i += 1;
                Some(Node::Field(*f))
            }
            Tok::Op('(') => {
                self.i += 1;
                let e = self.expr()?;
                self.op(")")?;
                Some(e)
            }
            _ => None,
        }
    }
}

fn compile(src: &str, fields: &[String]) -> Option<Node> {
    let mut p = Parse { t: tokens(src, fields)?, i: 0 };
    let n = p.expr()?;
    (p.i == p.t.len()).then_some(n)
}

fn run(n: &Node, get: &dyn Fn(usize) -> f64) -> Option<f64> {
    Some(match n {
        Node::Num(x) => *x,
        Node::Field(f) => get(*f),
        Node::Neg(x) => -run(x, get)?,
        Node::Pct(x) => run(x, get)? / 100.0,
        Node::Bin(o, a, b) => {
            let (x, y) = (run(a, get)?, run(b, get)?);
            match o {
                '+' => x + y,
                '-' => x - y,
                '*' => x * y,
                '/' => {
                    if y == 0.0 {
                        return None;
                    }
                    x / y
                }
                _ => x.powf(y),
            }
        }
    })
}

struct Data {
    names: Vec<String>,
    vals: Vec<Vec<Value>>,
    txt: Vec<Vec<String>>,
}

struct Cl {
    raw: String,
    st: u8,
    pct: bool,
    dec: bool,
}

fn cl(raw: impl Into<String>, st: u8) -> Cl {
    Cl { raw: raw.into(), st, pct: false, dec: false }
}

fn label(s: &str) -> String {
    if s.is_empty() || (matches!(Value::parse_input(s), Value::Text(_)) && !s.starts_with(['\'', '='])) {
        s.to_string()
    } else {
        format!("'{s}")
    }
}

fn shown_label(s: &str) -> String {
    if s.is_empty() {
        "(blank)".into()
    } else {
        s.to_string()
    }
}

fn overlaps(a: Area, b: Area) -> bool {
    a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0
}

#[derive(Clone, Copy, PartialEq)]
enum K {
    Leaf,
    Sub,
    Grand,
}

struct Dim {
    k: usize,
    ids: Vec<Vec<usize>>,
    items: Vec<Vec<String>>,
}

fn dim(data: &Data, fields: &[usize], keep: &[usize]) -> Dim {
    let k = fields.len();
    let mut maps: Vec<HashMap<String, usize>> = vec![HashMap::new(); k];
    let mut reps: Vec<Vec<(String, Value)>> = vec![Vec::new(); k];
    let mut raw_ids = vec![Vec::new(); data.vals.len()];
    for &r in keep {
        let mut row = Vec::with_capacity(k);
        for (l, &f) in fields.iter().enumerate() {
            let t = &data.txt[r][f];
            let n = maps[l].len();
            let id = *maps[l].entry(t.clone()).or_insert_with(|| {
                reps[l].push((t.clone(), data.vals[r][f].clone()));
                n
            });
            row.push(id);
        }
        raw_ids[r] = row;
    }
    let mut ids = raw_ids;
    let mut items = Vec::with_capacity(k);
    for l in 0..k {
        let mut order: Vec<usize> = (0..reps[l].len()).collect();
        order.sort_by(|&a, &b| {
            let (x, y) = (&reps[l][a].1, &reps[l][b].1);
            match (x == &Value::Empty, y == &Value::Empty) {
                (true, true) => std::cmp::Ordering::Equal,
                (true, false) => std::cmp::Ordering::Greater,
                (false, true) => std::cmp::Ordering::Less,
                _ => compare(x, y).then_with(|| reps[l][a].0.to_lowercase().cmp(&reps[l][b].0.to_lowercase())),
            }
        });
        let mut rank = vec![0; order.len()];
        for (pos, &id) in order.iter().enumerate() {
            rank[id] = pos;
        }
        for &r in keep {
            ids[r][l] = rank[ids[r][l]];
        }
        items.push(order.iter().map(|&id| reps[l][id].0.clone()).collect());
    }
    Dim { k, ids, items }
}

fn plan(d: &Dim, recs: &[usize], level: usize, subs: bool, prefix: &mut Vec<usize>, out: &mut Vec<(Vec<usize>, K)>) {
    let mut ids: Vec<usize> = recs.iter().map(|&r| d.ids[r][level]).collect();
    ids.sort_unstable();
    ids.dedup();
    for id in ids {
        let rs: Vec<usize> = recs.iter().copied().filter(|&r| d.ids[r][level] == id).collect();
        prefix.push(id);
        if level + 1 == d.k {
            out.push((prefix.clone(), K::Leaf));
        } else {
            plan(d, &rs, level + 1, subs, prefix, out);
            if subs {
                out.push((prefix.clone(), K::Sub));
            }
        }
        prefix.pop();
    }
}

fn lines(d: &Dim, keep: &[usize], subs: bool, grand: bool) -> Vec<(Vec<usize>, K)> {
    let mut out = Vec::new();
    if d.k > 0 {
        plan(d, keep, 0, subs && d.k > 1, &mut Vec::new(), &mut out);
    }
    if grand || d.k == 0 {
        out.push((Vec::new(), K::Grand));
    }
    out
}

fn hit(d: &Dim, path: &[usize], r: usize) -> bool {
    path.iter().enumerate().all(|(i, id)| d.ids[r][i] == *id)
}

enum Src {
    Field(usize),
    Calc(Node),
}

struct Vf {
    src: Src,
    func: Func,
    show: Show,
    name: String,
    base: Option<(bool, usize)>,
    base_item: String,
}

#[path = "pivot_group.rs"]
mod group;
#[path = "pivot_show.rs"]
mod showas;
#[path = "pivot_suggest.rs"]
mod suggest;
pub use group::Group;

fn aggregate(data: &Data, vf: &Vf, recs: &[usize]) -> Result<Option<f64>, ()> {
    if recs.is_empty() {
        return Ok(None);
    }
    let sum_of = |f: usize| -> f64 { recs.iter().filter_map(|&r| if let Value::Number(n) = &data.vals[r][f] { Some(*n) } else { None }).sum() };
    match &vf.src {
        Src::Calc(n) => run(n, &|f| sum_of(f)).map(Some).ok_or(()),
        Src::Field(f) => {
            let nums: Vec<f64> = recs.iter().filter_map(|&r| if let Value::Number(n) = &data.vals[r][*f] { Some(*n) } else { None }).collect();
            let n = nums.len() as f64;
            let mean = if nums.is_empty() { 0.0 } else { nums.iter().sum::<f64>() / n };
            let ss: f64 = nums.iter().map(|x| (x - mean).powi(2)).sum();
            match vf.func {
                Func::Sum => Ok(Some(nums.iter().sum())),
                Func::Count => Ok(Some(recs.iter().filter(|&&r| data.vals[r][*f] != Value::Empty).count() as f64)),
                Func::CountNums => Ok(Some(n)),
                Func::Average => {
                    if nums.is_empty() {
                        Err(())
                    } else {
                        Ok(Some(mean))
                    }
                }
                Func::Max => Ok(Some(nums.iter().copied().reduce(f64::max).unwrap_or(0.0))),
                Func::Min => Ok(Some(nums.iter().copied().reduce(f64::min).unwrap_or(0.0))),
                Func::Product => Ok(Some(nums.iter().product())),
                Func::Var | Func::StDev => {
                    if n < 2.0 {
                        return Err(());
                    }
                    let v = ss / (n - 1.0);
                    Ok(Some(if vf.func == Func::Var { v } else { v.sqrt() }))
                }
                Func::VarP | Func::StDevP => {
                    if nums.is_empty() {
                        return Err(());
                    }
                    let v = ss / n;
                    Ok(Some(if vf.func == Func::VarP { v } else { v.sqrt() }))
                }
            }
        }
    }
}

fn num_text(r: Result<Option<f64>, ()>) -> String {
    match r {
        Ok(Some(x)) if x.is_finite() => format!("{x}"),
        Ok(Some(_)) | Err(()) => "#DIV/0!".into(),
        Ok(None) => String::new(),
    }
}

impl Workbook {
    fn pivot_range(&self, p: &Pivot) -> Result<(usize, Area), EngineError> {
        if !p.table.is_empty() {
            if let Some(t) = self.tables.iter().find(|t| t.name.eq_ignore_ascii_case(&p.table)) {
                let (_, d1) = t.data();
                return Ok((t.sheet, Area { r1: d1, ..t.area }));
            }
        }
        if p.src_sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(p.src_sheet));
        }
        Ok((p.src_sheet, p.src))
    }

    fn pivot_data(&self, sheet: usize, a: Area) -> Data {
        let hv: Vec<String> = (a.c0..=a.c1).map(|c| self.shown_text(sheet, Addr { row: a.r0, col: c })).collect();
        let names = unique_names(&hv);
        let mut vals = Vec::new();
        let mut txt = Vec::new();
        for r in a.r0 + 1..=a.r1 {
            let row: Vec<Value> = (a.c0..=a.c1).map(|c| self.sheets[sheet].cells.get(Addr { row: r, col: c }).cloned().unwrap_or(Value::Empty)).collect();
            if row.iter().all(|v| *v == Value::Empty) {
                continue;
            }
            txt.push((a.c0..=a.c1).map(|c| self.shown_text(sheet, Addr { row: r, col: c })).collect());
            vals.push(row);
        }
        Data { names, vals, txt }
    }

    fn shown_text(&self, sheet: usize, at: Addr) -> String {
        match self.sheets[sheet].cells.get(at) {
            Some(v) => self.shown(sheet, at, v.clone()).to_string(),
            None => String::new(),
        }
    }

    fn find_pivot(&self, name: &str) -> Result<usize, EngineError> {
        self.pivots.iter().position(|p| p.name.eq_ignore_ascii_case(name)).ok_or_else(|| EngineError::BadName(name.to_string()))
    }

    fn render_pivot(&self, p: &Pivot) -> Result<Vec<Vec<Cl>>, EngineError> {
        let (sheet, area) = self.pivot_range(p)?;
        if area.r1 <= area.r0 {
            return Err(EngineError::BadStyle("the source needs a header row and at least one row of data".into()));
        }
        let data = group::apply(self.pivot_data(sheet, area), &p.groups);
        let mut all: Vec<String> = data.names.clone();
        let base_names = data.names.clone();
        for (n, f) in &p.calc {
            compile(f, &base_names).ok_or_else(|| EngineError::BadFormula(format!("{n}: {f}")))?;
            all.push(n.clone());
        }
        let find = |name: &str| all.iter().position(|f| f.eq_ignore_ascii_case(name)).ok_or_else(|| EngineError::BadName(format!("{name} is not a field in the source")));
        let rf: Vec<usize> = p.rows.iter().map(|n| find(n)).collect::<Result<_, _>>()?;
        let cf: Vec<usize> = p.cols.iter().map(|n| find(n)).collect::<Result<_, _>>()?;
        if rf.iter().chain(&cf).any(|&f| f >= data.names.len()) {
            return Err(EngineError::BadStyle("a calculated field cannot be a row or column field".into()));
        }
        let mut vfs: Vec<Vf> = Vec::new();
        for v in &p.values {
            let i = find(&v.field)?;
            let (src, func) = if i >= data.names.len() {
                let node = p.calc.iter().find(|(n, _)| n.eq_ignore_ascii_case(&v.field)).and_then(|(_, f)| compile(f, &base_names)).ok_or_else(|| EngineError::BadName(v.field.clone()))?;
                (Src::Calc(node), Func::Sum)
            } else {
                (Src::Field(i), v.func)
            };
            let auto = if matches!(src, Src::Calc(_)) { format!("Sum of {}", v.field) } else { format!("{} of {}", func.label(), v.field) };
            let base = if v.show.needs_base() {
                match find(&v.base_field) {
                    Ok(bi) => rf.iter().position(|&x| x == bi).map(|l| (true, l)).or_else(|| cf.iter().position(|&x| x == bi).map(|l| (false, l))),
                    Err(_) => None,
                }
            } else {
                None
            };
            vfs.push(Vf { src, func, show: v.show, name: if v.name.trim().is_empty() { auto } else { v.name.trim().to_string() }, base, base_item: v.base_item.clone() });
        }
        for i in 0..vfs.len() {
            let mut k = 2;
            let base = vfs[i].name.clone();
            while vfs[..i].iter().any(|o| o.name.eq_ignore_ascii_case(&vfs[i].name)) {
                vfs[i].name = format!("{base} {k}");
                k += 1;
            }
        }
        let mut fidx: Vec<(usize, &Vec<String>)> = Vec::new();
        for (f, items) in &p.filters {
            fidx.push((find(f)?, items));
        }
        let keep: Vec<usize> = (0..data.vals.len())
            .filter(|&r| {
                fidx.iter().all(|(f, items)| {
                    items.is_empty() || *f >= data.names.len() || items.iter().any(|i| *i == shown_label(&data.txt[r][*f]))
                })
            })
            .collect();
        let rd = dim(&data, &rf, &keep);
        let cd = dim(&data, &cf, &keep);
        let rl = lines(&rd, &keep, p.subtotals, p.grand_rows);
        let cl_ = lines(&cd, &keep, p.subtotals, p.grand_cols);
        let (kr, kc, nv) = (rd.k, cd.k, vfs.len());
        let nvc = nv.max(1);
        let width = kr + cl_.len() * nvc;
        let mut out: Vec<Vec<Cl>> = Vec::new();

        for (f, items) in &p.filters {
            let sel = match items.len() {
                0 => "(All)".to_string(),
                1 => items[0].clone(),
                _ => "(Multiple Items)".to_string(),
            };
            out.push(vec![cl(label(f), 3), cl(label(&sel), 0)]);
        }
        if !p.filters.is_empty() {
            out.push(Vec::new());
        }

        let mut head: Vec<Vec<Cl>> = Vec::new();
        let hrows = if kc > 0 { 1 + kc + usize::from(nv > 1) } else { 1 };
        for _ in 0..hrows {
            head.push((0..width).map(|_| cl("", 1)).collect());
        }
        let last = hrows - 1;
        for (i, &f) in rf.iter().enumerate() {
            head[last][i] = cl(label(&all[f]), 1);
        }
        let vname = |v: usize| label(&vfs[v].name);
        if kc == 0 {
            for (ci, _) in cl_.iter().enumerate() {
                for v in 0..nv {
                    head[0][kr + ci * nvc + v] = cl(vname(v), 1);
                }
            }
        } else {
            if nv == 1 && width > 0 {
                head[0][0] = cl(vname(0), 1);
            }
            if width > kr {
                head[0][kr] = cl(label(&cf.iter().map(|&f| all[f].clone()).collect::<Vec<_>>().join(" / ")), 1);
            }
            let mut prev: Vec<Option<Vec<usize>>> = vec![None; kc];
            for (ci, (path, kind)) in cl_.iter().enumerate() {
                let x0 = kr + ci * nvc;
                for lv in 0..kc {
                    let put = match kind {
                        K::Grand => (lv == 0).then(|| "Grand Total".to_string()),
                        K::Sub => (lv + 1 == path.len()).then(|| format!("{} Total", shown_label(&cd.items[lv][path[lv]]))),
                        K::Leaf => (prev[lv].as_deref() != Some(&path[..=lv])).then(|| shown_label(&cd.items[lv][path[lv]])),
                    };
                    if let Some(t) = put {
                        head[1 + lv][x0] = cl(label(&t), 1);
                    }
                    prev[lv] = Some(path.iter().take(lv + 1).copied().collect());
                }
                if nv > 1 {
                    for v in 0..nv {
                        head[1 + kc][x0 + v] = cl(vname(v), 1);
                    }
                }
            }
        }
        out.extend(head);

        let mut prev: Option<Vec<usize>> = None;
        for (rpath, rkind) in &rl {
            let mut row: Vec<Cl> = Vec::with_capacity(width);
            let rtot = *rkind != K::Leaf && rd.k > 0;
            let rst = if rtot { 2 } else { 0 };
            for _ in 0..kr {
                row.push(cl("", rst));
            }
            match rkind {
                K::Grand => {
                    if kr > 0 {
                        row[0] = cl("Grand Total", 2);
                    }
                }
                K::Sub => {
                    let lv = rpath.len() - 1;
                    row[lv] = cl(label(&format!("{} Total", shown_label(&rd.items[lv][rpath[lv]]))), 2);
                    prev = Some(rpath.clone());
                }
                K::Leaf => {
                    let same = prev.as_ref().map_or(0, |q| q.iter().zip(rpath).take_while(|(x, y)| x == y).count());
                    for lv in same..kr {
                        row[lv] = cl(label(&shown_label(&rd.items[lv][rpath[lv]])), 0);
                    }
                    prev = Some(rpath.clone());
                }
            }
            let rrecs: Vec<usize> = keep.iter().copied().filter(|&r| hit(&rd, rpath, r)).collect();
            for (cpath, ckind) in &cl_ {
                let cur: Vec<usize> = rrecs.iter().copied().filter(|&r| hit(&cd, cpath, r)).collect();
                let st = if rtot || (*ckind != K::Leaf && cd.k > 0) { 2 } else { 0 };
                if nv == 0 {
                    row.push(cl("", st));
                }
                for vf in &vfs {
                    let own = aggregate(&data, vf, &cur);
                    let (raw, shape) = match vf.show {
                        Show::Normal => (num_text(own), 0),
                        _ => showas::apply(&showas::Ctx { data: &data, keep: &keep, rd: &rd, cd: &cd }, vf, rpath, cpath, own),
                    };
                    let pct = shape == 1;
                    let dec = shape == 3 || (shape == 0 && (matches!(vf.src, Src::Calc(_)) || matches!(vf.func, Func::Average | Func::StDev | Func::StDevP | Func::Var | Func::VarP)));
                    row.push(Cl { raw, st, pct, dec });
                }
            }
            out.push(row);
        }
        if out.iter().map(Vec::len).sum::<usize>() > CELL_LIMIT {
            return Err(EngineError::BadStyle("that PivotTable would be too large".into()));
        }
        Ok(out)
    }

    pub fn pivots(&self) -> Vec<String> {
        self.pivots.iter().map(Pivot::line).collect()
    }

    pub fn load_pivots(&mut self, lines: &[String]) -> usize {
        self.pivots = lines.iter().filter_map(|l| Pivot::parse(l)).filter(|p| p.sheet < self.sheets.len()).collect();
        self.pivots.len()
    }

    fn resolve_source(&self, sheet: usize, text: &str) -> Result<(usize, Area, String), EngineError> {
        let t = text.trim();
        if let Some(tb) = self.tables.iter().find(|x| x.name.eq_ignore_ascii_case(t)) {
            let (_, d1) = tb.data();
            return Ok((tb.sheet, Area { r1: d1, ..tb.area }, tb.name.clone()));
        }
        let e = formula::parse(t.trim_start_matches('=')).ok_or_else(|| EngineError::BadAddress(t.to_string()))?;
        match e {
            Expr::Ref(sh, kind) => {
                let s = match sh {
                    Some(n) => self.sheet_by_name(&n).ok_or_else(|| EngineError::BadAddress(t.to_string()))?,
                    None => sheet,
                };
                let a = match kind {
                    RefKind::Area(..) => kind.area(),
                    _ => return Err(EngineError::BadAddress(t.to_string())),
                };
                let a = match self.sheets.get(s).and_then(|x| x.cells.extent()) {
                    Some(end) => Area { r1: a.r1.min(end.row.max(a.r0)), c1: a.c1.min(end.col.max(a.c0)), ..a },
                    None => a,
                };
                Ok((s, a, String::new()))
            }
            _ => Err(EngineError::BadAddress(t.to_string())),
        }
    }

    fn fields_line(&self, sheet: usize, area: Area, table: &str, groups: &[Group]) -> String {
        let plain = self.pivot_data(sheet, area);
        let base = plain.names.len();
        let data = group::apply(plain, groups);
        let mut out = format!("{sheet}\t{}\t", area_text(area));
        escape(table, &mut out);
        for (i, n) in data.names.iter().enumerate() {
            let filled: Vec<&Value> = data.vals.iter().map(|r| &r[i]).filter(|v| **v != Value::Empty).collect();
            let nums = filled.iter().filter(|v| matches!(v, Value::Number(_))).count();
            out.push('\t');
            out.push(if i < base && !filled.is_empty() && nums * 5 >= filled.len() * 4 { 'n' } else { 't' });
            escape(n, &mut out);
        }
        out
    }

    pub fn pivot_source(&self, sheet: usize, text: &str) -> Result<String, EngineError> {
        let (s, a, t) = self.resolve_source(sheet, text)?;
        if a.r1 <= a.r0 {
            return Err(EngineError::BadStyle("the source needs a header row and at least one row of data".into()));
        }
        Ok(self.fields_line(s, a, &t, &[]))
    }

    pub fn pivot_fields(&self, name: &str) -> Result<String, EngineError> {
        let p = &self.pivots[self.find_pivot(name)?];
        let (s, a) = self.pivot_range(p)?;
        Ok(self.fields_line(s, a, &p.table, &p.groups))
    }

    pub fn pivot_items(&self, name: &str, field: &str) -> Result<Vec<String>, EngineError> {
        let p = &self.pivots[self.find_pivot(name)?];
        let (s, a) = self.pivot_range(p)?;
        let data = group::apply(self.pivot_data(s, a), &p.groups);
        let f = data.names.iter().position(|n| n.eq_ignore_ascii_case(field)).ok_or_else(|| EngineError::BadName(field.to_string()))?;
        let keep: Vec<usize> = (0..data.vals.len()).collect();
        let d = dim(&data, &[f], &keep);
        Ok(d.items.into_iter().next().unwrap_or_default().iter().map(|t| shown_label(t)).collect())
    }

    pub fn pivot_suggest(&self, sheet: usize, text: &str) -> Result<Vec<String>, EngineError> {
        let (s, a, t) = self.resolve_source(sheet, text)?;
        Ok(suggest::run(self, sheet, s, a, t))
    }

    fn pivot_name_free(&self, name: &str, except: Option<usize>) -> bool {
        formula::valid_name(name) && self.pivots.iter().enumerate().all(|(i, p)| Some(i) == except || !p.name.eq_ignore_ascii_case(name))
    }

    fn clear_edits(&self, sheet: usize, a: Area) -> Vec<(Addr, String)> {
        let mut v = Vec::new();
        self.sheets[sheet].cells.for_each_in(Addr { row: a.r0, col: a.c0 }, Addr { row: a.r1, col: a.c1 }, |at, _| v.push((at, String::new())));
        v
    }

    fn write_pivot(&mut self, mut p: Pivot, at: Option<usize>) -> Result<Effect, EngineError> {
        if p.sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(p.sheet));
        }
        let mut grid = self.render_pivot(&p)?;
        if grid.iter().all(|r| r.is_empty()) || p.rows.is_empty() && p.cols.is_empty() && p.values.is_empty() {
            grid = vec![vec![cl(label(&p.name), 3)], vec![cl("Choose fields in the PivotTable fields panel", 0)]];
        }
        let width = grid.iter().map(Vec::len).max().unwrap_or(1) as u32;
        let height = grid.len() as u32;
        self.check(p.sheet, Addr { row: p.row.saturating_add(height - 1), col: p.col.saturating_add(width - 1) })?;
        let area = Area { r0: p.row, c0: p.col, r1: p.row + height - 1, c1: p.col + width - 1 };
        let (ss, sa) = self.pivot_range(&p)?;
        if ss == p.sheet && overlaps(sa, area) {
            return Err(EngineError::BadStyle("a PivotTable cannot overlap its own source data".into()));
        }
        if self.pivots.iter().enumerate().any(|(i, o)| Some(i) != at && o.out.is_some_and(|(s, a)| s == p.sheet && overlaps(a, area))) {
            return Err(EngineError::BadStyle("a PivotTable cannot overlap another PivotTable".into()));
        }
        if self.tables.iter().any(|t| t.sheet == p.sheet && overlaps(t.area, area)) {
            return Err(EngineError::BadStyle("a PivotTable cannot overlap a table".into()));
        }
        let old = at.and_then(|i| self.pivots[i].out);
        let before = self.pivots.clone();
        let mark = self.undo_mark();
        let mut out = Effect::default();
        let mut fmts: Vec<(Addr, Option<String>, Option<String>)> = Vec::new();
        let mut edits: Vec<(Addr, String)> = Vec::new();
        for (ri, row) in grid.iter().enumerate() {
            for c in 0..width as usize {
                let a = Addr { row: area.r0 + ri as u32, col: area.c0 + c as u32 };
                let (raw, st, pct, dec) = row.get(c).map_or((String::new(), 0, false, false), |x| (x.raw.clone(), x.st, x.pct, x.dec));
                edits.push((a, raw));
                let style = match st {
                    1 => "b;bg:d9e1f2",
                    2 => "b;bg:f2f2f2",
                    3 => "b",
                    _ => "",
                };
                fmts.push((a, Some(style.to_string()), Some(if pct && st != 1 { "0.00%" } else if dec && st != 1 { "#,##0.00" } else { "" }.to_string())));
            }
        }
        if let Some((os, oa)) = old {
            if os < self.sheets.len() {
                let mut gone = self.clear_edits(os, oa);
                let mut gone_fmt: Vec<(Addr, Option<String>, Option<String>)> = Vec::new();
                for r in oa.r0..=oa.r1 {
                    for c in oa.c0..=oa.c1 {
                        let a = Addr { row: r, col: c };
                        if os == p.sheet && area.contains(r, c) {
                            continue;
                        }
                        gone_fmt.push((a, Some(String::new()), Some(String::new())));
                    }
                }
                if os == p.sheet {
                    gone.retain(|(a, _)| !area.contains(a.row, a.col));
                    edits.extend(gone);
                    fmts.extend(gone_fmt);
                } else {
                    self.table_quiet = true;
                    let r = self.apply(os, &gone);
                    self.table_quiet = false;
                    out.cells.extend(r?);
                    out = out.join(self.put_formats(os, &gone_fmt)?);
                }
            }
        }
        self.table_quiet = true;
        let r = self.apply(p.sheet, &edits);
        self.table_quiet = false;
        out.cells.extend(r?);
        out = out.join(self.put_formats(p.sheet, &fmts)?);
        p.out = Some((p.sheet, area));
        match at {
            Some(i) => self.pivots[i] = p,
            None => self.pivots.push(p),
        }
        if before != self.pivots {
            self.record(Tx::Pivots { before, after: self.pivots.clone() });
        }
        self.undo_group(mark);
        out.tables = true;
        Ok(out)
    }

    pub fn create_pivot(&mut self, line: &str) -> Result<Effect, EngineError> {
        let mut p = Pivot::parse(line).ok_or_else(|| EngineError::BadStyle(line.to_string()))?;
        if p.name.is_empty() {
            let mut k = 1;
            while !self.pivot_name_free(&format!("PivotTable{k}"), None) {
                k += 1;
            }
            p.name = format!("PivotTable{k}");
        } else if !self.pivot_name_free(&p.name, None) {
            return Err(EngineError::BadName(p.name));
        }
        p.out = None;
        self.write_pivot(p, None)
    }

    pub fn set_pivot(&mut self, name: &str, line: &str) -> Result<Effect, EngineError> {
        let i = self.find_pivot(name)?;
        let mut p = Pivot::parse(line).ok_or_else(|| EngineError::BadStyle(line.to_string()))?;
        if p.name.is_empty() {
            p.name = self.pivots[i].name.clone();
        }
        if !self.pivot_name_free(&p.name, Some(i)) {
            return Err(EngineError::BadName(p.name));
        }
        p.out = self.pivots[i].out;
        self.write_pivot(p, Some(i))
    }

    pub fn refresh_pivot(&mut self, name: &str) -> Result<Effect, EngineError> {
        if name.is_empty() {
            let mark = self.undo_mark();
            let mut out = Effect::default();
            let mut first = None;
            let mut ok = 0;
            for i in 0..self.pivots.len() {
                let p = self.pivots[i].clone();
                match self.write_pivot(p, Some(i)) {
                    Ok(e) => {
                        out = out.join(e);
                        ok += 1;
                    }
                    Err(e) => {
                        first.get_or_insert(e);
                    }
                }
            }
            self.undo_group(mark);
            return match first {
                Some(e) if ok == 0 => Err(e),
                _ => Ok(out),
            };
        }
        let i = self.find_pivot(name)?;
        let p = self.pivots[i].clone();
        self.write_pivot(p, Some(i))
    }

    pub fn remove_pivot(&mut self, name: &str) -> Result<Effect, EngineError> {
        let i = self.find_pivot(name)?;
        let before = self.pivots.clone();
        let mark = self.undo_mark();
        let mut out = Effect::default();
        if let Some((s, a)) = self.pivots[i].out {
            if s < self.sheets.len() {
                let edits = self.clear_edits(s, a);
                self.table_quiet = true;
                let r = self.apply(s, &edits);
                self.table_quiet = false;
                out.cells.extend(r?);
                let mut fmts = Vec::new();
                for r in a.r0..=a.r1 {
                    for c in a.c0..=a.c1 {
                        fmts.push((Addr { row: r, col: c }, Some(String::new()), Some(String::new())));
                    }
                }
                out = out.join(self.put_formats(s, &fmts)?);
            }
        }
        self.pivots.remove(i);
        self.record(Tx::Pivots { before, after: self.pivots.clone() });
        self.undo_group(mark);
        out.tables = true;
        Ok(out)
    }
}
