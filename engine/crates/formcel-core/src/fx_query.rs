use super::*;
use crate::col_name;
use std::cmp::Ordering;

#[derive(Clone, Debug, PartialEq)]
enum Q {
    Null,
    Num(f64),
    Str(String),
    Bool(bool),
}

#[derive(Clone, Debug, PartialEq)]
enum Tk {
    Num(f64),
    Str(String),
    Id(String),
    Word(String),
    Op(String),
    Open,
    Close,
    Comma,
}

#[derive(Clone, Debug, PartialEq)]
enum X {
    Lit(Q),
    Col(usize),
    Agg(String, usize),
    Func(String, Vec<X>),
    Bin(String, Box<X>, Box<X>),
    Not(Box<X>),
    Neg(Box<X>),
    IsNull(Box<X>, bool),
}

const RESERVED: [&str; 30] = [
    "select", "where", "group", "pivot", "order", "limit", "offset", "label", "format", "options", "by", "and", "or", "not", "is", "null", "true", "false", "contains", "starts", "ends", "with", "matches", "like", "asc", "desc", "date", "from", "datetime",
    "timeofday",
];

fn lex(src: &str) -> Result<Vec<(Tk, usize, usize)>, ErrKind> {
    let cs: Vec<(usize, char)> = src.char_indices().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < cs.len() {
        let (pos, c) = cs[i];
        let end_of = |j: usize| cs.get(j).map_or(src.len(), |x| x.0);
        if c.is_whitespace() {
            i += 1;
        } else if c.is_ascii_digit() || (c == '.' && cs.get(i + 1).is_some_and(|x| x.1.is_ascii_digit())) {
            let mut j = i;
            while j < cs.len() && (cs[j].1.is_ascii_digit() || cs[j].1 == '.') {
                j += 1;
            }
            let n = src[pos..end_of(j)].parse::<f64>().map_err(|_| ErrKind::Value)?;
            out.push((Tk::Num(n), pos, end_of(j)));
            i = j;
        } else if c == '\'' || c == '"' || c == '`' {
            let mut j = i + 1;
            let mut s = String::new();
            while j < cs.len() && cs[j].1 != c {
                if cs[j].1 == '\\' && j + 1 < cs.len() {
                    j += 1;
                }
                s.push(cs[j].1);
                j += 1;
            }
            if j >= cs.len() {
                return Err(ErrKind::Value);
            }
            out.push((if c == '`' { Tk::Id(s) } else { Tk::Str(s) }, pos, end_of(j + 1)));
            i = j + 1;
        } else if c.is_alphabetic() || c == '_' {
            let mut j = i;
            while j < cs.len() && (cs[j].1.is_alphanumeric() || cs[j].1 == '_' || cs[j].1 == '.') {
                j += 1;
            }
            out.push((Tk::Word(src[pos..end_of(j)].to_string()), pos, end_of(j)));
            i = j;
        } else if c == '(' {
            out.push((Tk::Open, pos, end_of(i + 1)));
            i += 1;
        } else if c == ')' {
            out.push((Tk::Close, pos, end_of(i + 1)));
            i += 1;
        } else if c == ',' {
            out.push((Tk::Comma, pos, end_of(i + 1)));
            i += 1;
        } else if "<>=!+-*/%".contains(c) {
            let two: String = cs[i..(i + 2).min(cs.len())].iter().map(|x| x.1).collect();
            if ["<=", ">=", "<>", "!="].contains(&two.as_str()) {
                out.push((Tk::Op(two), pos, end_of(i + 2)));
                i += 2;
            } else {
                out.push((Tk::Op(c.to_string()), pos, end_of(i + 1)));
                i += 1;
            }
        } else {
            return Err(ErrKind::Value);
        }
    }
    Ok(out)
}

struct Parser<'a> {
    t: Vec<(Tk, usize, usize)>,
    i: usize,
    cols: usize,
    names: &'a [String],
}

fn letters(s: &str) -> Option<usize> {
    if s.is_empty() || s.len() > 3 || !s.chars().all(|c| c.is_ascii_uppercase()) {
        return None;
    }
    Some(s.chars().fold(0usize, |a, c| a * 26 + (c as usize - 64)) - 1)
}

impl Parser<'_> {
    fn word(&self) -> Option<String> {
        match self.t.get(self.i) {
            Some((Tk::Word(w), _, _)) => Some(w.to_ascii_lowercase()),
            _ => None,
        }
    }

    fn eat(&mut self, kw: &str) -> bool {
        if self.word().as_deref() == Some(kw) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    fn eat_tk(&mut self, tk: &Tk) -> bool {
        if self.t.get(self.i).map(|x| &x.0) == Some(tk) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    fn column(&self, name: &str) -> Result<usize, ErrKind> {
        let found = letters(name).or_else(|| name.strip_prefix("Col").and_then(|n| n.parse::<usize>().ok()).and_then(|n| n.checked_sub(1)));
        match found {
            Some(c) if c < self.cols => Ok(c),
            Some(_) => Err(ErrKind::Value),
            None => self.names.iter().position(|n| n == name).ok_or(ErrKind::Value),
        }
    }

    fn or(&mut self) -> Result<X, ErrKind> {
        let mut l = self.and()?;
        while self.eat("or") {
            l = X::Bin("or".into(), Box::new(l), Box::new(self.and()?));
        }
        Ok(l)
    }

    fn and(&mut self) -> Result<X, ErrKind> {
        let mut l = self.not()?;
        while self.eat("and") {
            l = X::Bin("and".into(), Box::new(l), Box::new(self.not()?));
        }
        Ok(l)
    }

    fn not(&mut self) -> Result<X, ErrKind> {
        if self.eat("not") {
            return Ok(X::Not(Box::new(self.not()?)));
        }
        self.cmp()
    }

    fn cmp(&mut self) -> Result<X, ErrKind> {
        let l = self.add()?;
        if self.eat("is") {
            let neg = self.eat("not");
            if !self.eat("null") {
                return Err(ErrKind::Value);
            }
            return Ok(X::IsNull(Box::new(l), neg));
        }
        for (words, op) in [(&["contains"][..], "contains"), (&["starts", "with"], "starts"), (&["ends", "with"], "ends"), (&["matches"], "matches"), (&["like"], "like")] {
            let save = self.i;
            if words.iter().all(|w| self.eat(w)) {
                return Ok(X::Bin(op.into(), Box::new(l), Box::new(self.add()?)));
            }
            self.i = save;
        }
        if let Some((Tk::Op(o), _, _)) = self.t.get(self.i) {
            if ["<", ">", "<=", ">=", "=", "!=", "<>"].contains(&o.as_str()) {
                let op = if o == "<>" { "!=".to_string() } else { o.clone() };
                self.i += 1;
                return Ok(X::Bin(op, Box::new(l), Box::new(self.add()?)));
            }
        }
        Ok(l)
    }

    fn add(&mut self) -> Result<X, ErrKind> {
        let mut l = self.mul()?;
        while let Some((Tk::Op(o), _, _)) = self.t.get(self.i) {
            if o != "+" && o != "-" {
                break;
            }
            let op = o.clone();
            self.i += 1;
            l = X::Bin(op, Box::new(l), Box::new(self.mul()?));
        }
        Ok(l)
    }

    fn mul(&mut self) -> Result<X, ErrKind> {
        let mut l = self.unary()?;
        while let Some((Tk::Op(o), _, _)) = self.t.get(self.i) {
            if o != "*" && o != "/" && o != "%" {
                break;
            }
            let op = o.clone();
            self.i += 1;
            l = X::Bin(op, Box::new(l), Box::new(self.unary()?));
        }
        Ok(l)
    }

    fn unary(&mut self) -> Result<X, ErrKind> {
        if self.eat_tk(&Tk::Op("-".into())) {
            return Ok(X::Neg(Box::new(self.unary()?)));
        }
        self.primary()
    }

    fn primary(&mut self) -> Result<X, ErrKind> {
        let (tk, _, _) = self.t.get(self.i).cloned().ok_or(ErrKind::Value)?;
        self.i += 1;
        match tk {
            Tk::Num(n) => Ok(X::Lit(Q::Num(n))),
            Tk::Str(s) => Ok(X::Lit(Q::Str(s))),
            Tk::Open => {
                let e = self.or()?;
                if !self.eat_tk(&Tk::Close) {
                    return Err(ErrKind::Value);
                }
                Ok(e)
            }
            Tk::Id(n) => Ok(X::Col(self.column(&n)?)),
            Tk::Word(w) => {
                let lw = w.to_ascii_lowercase();
                match lw.as_str() {
                    "true" => return Ok(X::Lit(Q::Bool(true))),
                    "false" => return Ok(X::Lit(Q::Bool(false))),
                    "null" => return Ok(X::Lit(Q::Null)),
                    "date" => {
                        if let Some((Tk::Str(s), _, _)) = self.t.get(self.i).cloned() {
                            self.i += 1;
                            let (n, _) = numfmt::parse(&s).ok_or(ErrKind::Value)?;
                            return Ok(X::Lit(Q::Num(n.floor())));
                        }
                        return Err(ErrKind::Value);
                    }
                    "datetime" | "timeofday" => {
                        if let Some((Tk::Str(s), _, _)) = self.t.get(self.i).cloned() {
                            self.i += 1;
                            let (n, _) = numfmt::parse(&s).ok_or(ErrKind::Value)?;
                            return Ok(X::Lit(Q::Num(if lw == "timeofday" { n.fract() } else { n })));
                        }
                        return Err(ErrKind::Value);
                    }
                    _ => {}
                }
                if self.eat_tk(&Tk::Open) {
                    let mut args = Vec::new();
                    if !self.eat_tk(&Tk::Close) {
                        loop {
                            args.push(self.or()?);
                            if self.eat_tk(&Tk::Comma) {
                                continue;
                            }
                            if self.eat_tk(&Tk::Close) {
                                break;
                            }
                            return Err(ErrKind::Value);
                        }
                    }
                    if ["avg", "count", "max", "min", "sum"].contains(&lw.as_str()) {
                        return match args.as_slice() {
                            [X::Col(c)] => Ok(X::Agg(lw, *c)),
                            _ => Err(ErrKind::Value),
                        };
                    }
                    return Ok(X::Func(lw, args));
                }
                if RESERVED.contains(&lw.as_str()) {
                    return Err(ErrKind::Value);
                }
                Ok(X::Col(self.column(&w)?))
            }
            _ => Err(ErrKind::Value),
        }
    }
}

fn has_agg(x: &X) -> bool {
    match x {
        X::Agg(..) => true,
        X::Func(_, a) => a.iter().any(has_agg),
        X::Bin(_, a, b) => has_agg(a) || has_agg(b),
        X::Not(a) | X::Neg(a) | X::IsNull(a, _) => has_agg(a),
        _ => false,
    }
}

fn rank(q: &Q) -> u8 {
    match q {
        Q::Null => 0,
        Q::Bool(_) => 1,
        Q::Num(_) => 2,
        Q::Str(_) => 3,
    }
}

fn order(a: &Q, b: &Q) -> Ordering {
    match (a, b) {
        (Q::Num(x), Q::Num(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (Q::Str(x), Q::Str(y)) => x.cmp(y),
        (Q::Bool(x), Q::Bool(y)) => x.cmp(y),
        _ => rank(a).cmp(&rank(b)),
    }
}

fn text_of_q(q: &Q) -> String {
    match q {
        Q::Null => String::new(),
        Q::Num(n) => Value::Number(*n).to_string(),
        Q::Str(s) => s.clone(),
        Q::Bool(b) => b.to_string(),
    }
}

fn like(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let mut row = vec![false; t.len() + 1];
    row[0] = true;
    for &pc in &p {
        let mut next = vec![false; t.len() + 1];
        if pc == '%' {
            let mut any = false;
            for j in 0..=t.len() {
                any = any || row[j];
                next[j] = any;
            }
        } else {
            for j in 0..t.len() {
                if row[j] && (pc == '_' || pc == t[j]) {
                    next[j + 1] = true;
                }
            }
        }
        row = next;
    }
    row[t.len()]
}

fn eval(x: &X, rows: &[&Vec<Q>]) -> Result<Q, ErrKind> {
    Ok(match x {
        X::Lit(q) => q.clone(),
        X::Col(c) => rows.first().map_or(Q::Null, |r| r[*c].clone()),
        X::Agg(f, c) => {
            let vals: Vec<&Q> = rows.iter().map(|r| &r[*c]).filter(|q| **q != Q::Null).collect();
            match f.as_str() {
                "count" => Q::Num(vals.len() as f64),
                "sum" | "avg" => {
                    let nums: Vec<f64> = vals.iter().filter_map(|q| if let Q::Num(n) = q { Some(*n) } else { None }).collect();
                    if nums.is_empty() {
                        Q::Null
                    } else {
                        let s: f64 = nums.iter().sum();
                        Q::Num(if f == "sum" { s } else { s / nums.len() as f64 })
                    }
                }
                _ => {
                    let mut it = vals.into_iter();
                    let first = it.next().cloned().unwrap_or(Q::Null);
                    it.fold(first, |a, b| if (order(b, &a) == Ordering::Less) == (f == "min") && order(b, &a) != Ordering::Equal { b.clone() } else { a })
                }
            }
        }
        X::Not(a) => match eval(a, rows)? {
            Q::Bool(b) => Q::Bool(!b),
            _ => Q::Null,
        },
        X::Neg(a) => match eval(a, rows)? {
            Q::Num(n) => Q::Num(-n),
            _ => Q::Null,
        },
        X::IsNull(a, neg) => Q::Bool((eval(a, rows)? == Q::Null) != *neg),
        X::Func(f, args) => {
            let v: Vec<Q> = args.iter().map(|a| eval(a, rows)).collect::<Result<_, _>>()?;
            let n = match v.first() {
                Some(Q::Num(n)) => Some(*n),
                _ => None,
            };
            match (f.as_str(), v.first()) {
                ("upper", Some(Q::Str(s))) => Q::Str(s.to_uppercase()),
                ("lower", Some(Q::Str(s))) => Q::Str(s.to_lowercase()),
                ("year", _) => n.and_then(numfmt::ymd).map_or(Q::Null, |d| Q::Num(d.0 as f64)),
                ("month", _) => n.and_then(numfmt::ymd).map_or(Q::Null, |d| Q::Num((d.1 - 1) as f64)),
                ("day", _) => n.and_then(numfmt::ymd).map_or(Q::Null, |d| Q::Num(d.2 as f64)),
                ("quarter", _) => n.and_then(numfmt::ymd).map_or(Q::Null, |d| Q::Num(((d.1 - 1) / 3 + 1) as f64)),
                ("dayofweek", _) => n.map_or(Q::Null, |s| Q::Num(numfmt::weekday(s) as f64)),
                ("hour", _) => n.map_or(Q::Null, |s| Q::Num(numfmt::hms(s).0 as f64)),
                ("minute", _) => n.map_or(Q::Null, |s| Q::Num(numfmt::hms(s).1 as f64)),
                ("second", _) => n.map_or(Q::Null, |s| Q::Num(numfmt::hms(s).2 as f64)),
                ("millisecond", _) => n.map_or(Q::Null, |s| Q::Num(((s.fract() * 86_400_000.0).round() % 1000.0).abs())),
                ("now", _) => Q::Num(numfmt::now()),
                ("todate", _) => n.map_or(Q::Null, |s| Q::Num(s.floor())),
                ("datediff", _) => match (v.first(), v.get(1)) {
                    (Some(Q::Num(a)), Some(Q::Num(b))) => Q::Num(a.floor() - b.floor()),
                    _ => Q::Null,
                },
                ("upper" | "lower", _) => Q::Null,
                _ => return Err(ErrKind::Value),
            }
        }
        X::Bin(op, a, b) => {
            let (l, r) = (eval(a, rows)?, eval(b, rows)?);
            match op.as_str() {
                "and" | "or" => match (l, r) {
                    (Q::Bool(p), Q::Bool(q)) => Q::Bool(if op == "and" { p && q } else { p || q }),
                    _ => Q::Null,
                },
                "+" | "-" | "*" | "/" | "%" => match (l, r) {
                    (Q::Num(p), Q::Num(q)) => match op.as_str() {
                        "+" => Q::Num(p + q),
                        "-" => Q::Num(p - q),
                        "*" => Q::Num(p * q),
                        "/" if q != 0.0 => Q::Num(p / q),
                        "%" if q != 0.0 => Q::Num(p % q),
                        _ => Q::Null,
                    },
                    _ => Q::Null,
                },
                "contains" | "starts" | "ends" | "matches" | "like" => {
                    if l == Q::Null || r == Q::Null {
                        return Ok(Q::Bool(false));
                    }
                    let (s, p) = (text_of_q(&l), text_of_q(&r));
                    Q::Bool(match op.as_str() {
                        "contains" => s.contains(&p),
                        "starts" => s.starts_with(&p),
                        "ends" => s.ends_with(&p),
                        "like" => like(&p, &s),
                        _ => fancy_regex::Regex::new(&format!("^(?:{p})$")).map_err(|_| ErrKind::Value)?.is_match(&s).map_err(|_| ErrKind::Value)?,
                    })
                }
                _ => {
                    if l == Q::Null || r == Q::Null || rank(&l) != rank(&r) {
                        return Ok(Q::Bool(false));
                    }
                    let o = order(&l, &r);
                    Q::Bool(match op.as_str() {
                        "=" => o == Ordering::Equal,
                        "!=" => o != Ordering::Equal,
                        "<" => o == Ordering::Less,
                        "<=" => o != Ordering::Greater,
                        ">" => o == Ordering::Greater,
                        _ => o != Ordering::Less,
                    })
                }
            }
        }
    })
}

fn q_of(v: &Value) -> Q {
    match v {
        Value::Number(n) => Q::Num(*n),
        Value::Text(s) => Q::Str(s.clone()),
        Value::Bool(b) => Q::Bool(*b),
        _ => Q::Null,
    }
}

fn value_of(q: &Q) -> Value {
    match q {
        Q::Null => Value::Empty,
        Q::Num(n) => Value::Number(*n),
        Q::Str(s) => Value::Text(s.clone()),
        Q::Bool(b) => Value::Bool(*b),
    }
}

struct Plan {
    select: Vec<(X, String)>,
    wher: Option<X>,
    group: Vec<X>,
    order: Vec<(X, bool)>,
    limit: Option<usize>,
    offset: usize,
    labels: Vec<(X, String)>,
    star: bool,
    pivot: Vec<X>,
    formats: Vec<(X, String)>,
    no_format: bool,
    no_values: bool,
}

fn parse(src: &str, cols: usize, names: &[String]) -> Result<Plan, ErrKind> {
    let mut p = Parser { t: lex(src)?, i: 0, cols, names };
    let mut plan = Plan { select: Vec::new(), wher: None, group: Vec::new(), order: Vec::new(), limit: None, offset: 0, labels: Vec::new(), star: true, pivot: Vec::new(), formats: Vec::new(), no_format: false, no_values: false };
    let span = |p: &Parser, from: usize| -> String {
        let (a, b) = (p.t[from].1, p.t[p.i - 1].2);
        src[a..b].to_string()
    };
    let list = |p: &mut Parser| -> Result<Vec<(X, String)>, ErrKind> {
        let mut out = Vec::new();
        loop {
            let from = p.i;
            let x = p.or()?;
            out.push((x, span(p, from)));
            if !p.eat_tk(&Tk::Comma) {
                break;
            }
        }
        Ok(out)
    };
    if p.eat("select") {
        if p.eat_tk(&Tk::Op("*".into())) {
            plan.star = true;
        } else {
            plan.star = false;
            plan.select = list(&mut p)?;
        }
    }
    if p.eat("where") {
        plan.wher = Some(p.or()?);
    }
    if p.eat("group") {
        if !p.eat("by") {
            return Err(ErrKind::Value);
        }
        plan.group = list(&mut p)?.into_iter().map(|x| x.0).collect();
    }
    if p.eat("pivot") {
        plan.pivot = list(&mut p)?.into_iter().map(|x| x.0).collect();
    }
    if p.eat("order") {
        if !p.eat("by") {
            return Err(ErrKind::Value);
        }
        loop {
            let x = p.or()?;
            let desc = if p.eat("desc") {
                true
            } else {
                p.eat("asc");
                false
            };
            plan.order.push((x, desc));
            if !p.eat_tk(&Tk::Comma) {
                break;
            }
        }
    }
    if p.eat("limit") {
        match p.t.get(p.i) {
            Some((Tk::Num(n), _, _)) if *n >= 0.0 => plan.limit = Some(*n as usize),
            _ => return Err(ErrKind::Value),
        }
        p.i += 1;
    }
    if p.eat("offset") {
        match p.t.get(p.i) {
            Some((Tk::Num(n), _, _)) if *n >= 0.0 => plan.offset = *n as usize,
            _ => return Err(ErrKind::Value),
        }
        p.i += 1;
    }
    if p.eat("label") {
        loop {
            let x = p.or()?;
            match p.t.get(p.i).cloned() {
                Some((Tk::Str(s), _, _)) => {
                    p.i += 1;
                    plan.labels.push((x, s));
                }
                _ => return Err(ErrKind::Value),
            }
            if !p.eat_tk(&Tk::Comma) {
                break;
            }
        }
    }
    if p.eat("format") {
        loop {
            let x = p.or()?;
            match p.t.get(p.i).cloned() {
                Some((Tk::Str(s), _, _)) => {
                    p.i += 1;
                    plan.formats.push((x, s));
                }
                _ => return Err(ErrKind::Value),
            }
            if !p.eat_tk(&Tk::Comma) {
                break;
            }
        }
    }
    if p.eat("options") {
        while let Some(w) = p.word() {
            match w.as_str() {
                "no_format" => plan.no_format = true,
                "no_values" => plan.no_values = true,
                _ => return Err(ErrKind::Value),
            }
            p.i += 1;
        }
    }
    if p.i < p.t.len() {
        return Err(ErrKind::Value);
    }
    Ok(plan)
}

impl Eval<'_> {
    pub(super) fn query(&self, a: &[Expr]) -> Result<Arg, ErrKind> {
        if a.len() < 2 || a.len() > 3 {
            return Err(ErrKind::Na);
        }
        let g = self.grid(self.arg(&a[0]))?;
        let text = self.t(a, 1)?;
        let want = match fx_text::given(a, 2) {
            Some(_) => self.n(a, 2)?.trunc() as i64,
            None => -1,
        };
        let first_text = g.rows > 0 && (0..g.cols).all(|c| matches!(g.get(0, c), Value::Text(s) if !s.is_empty()));
        let hdr = if want >= 0 { (want as usize).min(g.rows) } else { usize::from(first_text && g.rows > 1) };
        let names: Vec<String> = (0..g.cols).map(|c| (0..hdr).map(|r| g.get(r, c).to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ")).collect();
        let mut kinds = Vec::new();
        for c in 0..g.cols {
            let (mut n, mut s, mut b) = (0, 0, 0);
            for r in hdr..g.rows {
                match g.get(r, c) {
                    Value::Number(_) => n += 1,
                    Value::Text(t) if !t.is_empty() => s += 1,
                    Value::Bool(_) => b += 1,
                    _ => {}
                }
            }
            kinds.push(if n >= s && n >= b && n > 0 { 0 } else if s >= b && s > 0 { 1 } else { 2 });
        }
        let table: Vec<Vec<Q>> = (hdr..g.rows)
            .map(|r| {
                (0..g.cols)
                    .map(|c| {
                        let q = q_of(g.get(r, c));
                        match (&q, kinds[c]) {
                            (Q::Num(_), 0) | (Q::Str(_), 1) | (Q::Bool(_), 2) => q,
                            _ => Q::Null,
                        }
                    })
                    .collect()
            })
            .collect();
        let plan = parse(&text, g.cols, &names)?;
        let select: Vec<(X, String)> = if plan.star { (0..g.cols).map(|c| (X::Col(c), String::new())).collect() } else { plan.select };
        if plan.wher.as_ref().is_some_and(has_agg) || plan.group.iter().any(has_agg) {
            return Err(ErrKind::Value);
        }
        let mut kept: Vec<&Vec<Q>> = Vec::new();
        for row in &table {
            let ok = match &plan.wher {
                Some(w) => eval(w, &[row])? == Q::Bool(true),
                None => true,
            };
            if ok {
                kept.push(row);
            }
        }
        let pivoted = !plan.pivot.is_empty();
        if pivoted && !select.iter().any(|s| has_agg(&s.0)) {
            return Err(ErrKind::Value);
        }
        let grouped = pivoted || !plan.group.is_empty() || select.iter().any(|s| has_agg(&s.0)) || plan.order.iter().any(|o| has_agg(&o.0));
        let units: Vec<Vec<&Vec<Q>>> = if grouped {
            let mut keyed: Vec<(Vec<Q>, Vec<&Vec<Q>>)> = Vec::new();
            for row in &kept {
                let key: Vec<Q> = plan.group.iter().map(|x| eval(x, &[row])).collect::<Result<_, _>>()?;
                match keyed.iter_mut().find(|k| k.0 == key) {
                    Some(k) => k.1.push(row),
                    None => keyed.push((key, vec![row])),
                }
            }
            if plan.group.is_empty() && keyed.is_empty() {
                return Err(ErrKind::Na);
            }
            keyed.sort_by(|x, y| x.0.iter().zip(&y.0).map(|(p, q)| order(p, q)).find(|o| *o != Ordering::Equal).unwrap_or(Ordering::Equal));
            keyed.into_iter().map(|k| k.1).collect()
        } else {
            kept.iter().map(|r| vec![*r]).collect()
        };
        let plain: Vec<usize> = (0..select.len()).filter(|i| !has_agg(&select[*i].0)).collect();
        let aggs: Vec<usize> = (0..select.len()).filter(|i| has_agg(&select[*i].0)).collect();
        let mut pivkeys: Vec<Vec<Q>> = Vec::new();
        if pivoted {
            for row in &kept {
                let key: Vec<Q> = plan.pivot.iter().map(|x| eval(x, &[row])).collect::<Result<_, _>>()?;
                if !pivkeys.contains(&key) {
                    pivkeys.push(key);
                }
            }
            pivkeys.sort_by(|x, y| x.iter().zip(y).map(|(p, q)| order(p, q)).find(|o| *o != Ordering::Equal).unwrap_or(Ordering::Equal));
        }
        let mut rows: Vec<(Vec<Q>, Vec<Q>)> = Vec::new();
        for u in &units {
            let out: Vec<Q> = if pivoted {
                let mut o: Vec<Q> = plain.iter().map(|i| eval(&select[*i].0, u)).collect::<Result<_, _>>()?;
                for pk in &pivkeys {
                    let mut sub: Vec<&Vec<Q>> = Vec::new();
                    for r in u {
                        let k: Vec<Q> = plan.pivot.iter().map(|x| eval(x, &[*r])).collect::<Result<_, _>>()?;
                        if &k == pk {
                            sub.push(*r);
                        }
                    }
                    for i in &aggs {
                        o.push(if sub.is_empty() { Q::Null } else { eval(&select[*i].0, &sub)? });
                    }
                }
                o
            } else {
                select.iter().map(|s| eval(&s.0, u)).collect::<Result<_, _>>()?
            };
            let keys: Vec<Q> = plan.order.iter().map(|o| eval(&o.0, u)).collect::<Result<_, _>>()?;
            rows.push((keys, out));
        }
        rows.sort_by(|x, y| {
            for (i, (_, desc)) in plan.order.iter().enumerate() {
                let o = order(&x.0[i], &y.0[i]);
                let o = if *desc { o.reverse() } else { o };
                if o != Ordering::Equal {
                    return o;
                }
            }
            Ordering::Equal
        });
        let rows: Vec<Vec<Q>> = rows.into_iter().skip(plan.offset).take(plan.limit.unwrap_or(usize::MAX)).map(|r| r.1).collect();
        let head = |x: &X, src: &str| -> String {
            if let Some(l) = plan.labels.iter().find(|l| l.0 == *x) {
                return l.1.clone();
            }
            match x {
                X::Col(c) if hdr > 0 => names[*c].clone(),
                X::Col(c) => col_name(*c as u32),
                X::Agg(f, c) => format!("{f} {}", if hdr > 0 { names[*c].clone() } else { col_name(*c as u32) }),
                _ => src.to_string(),
            }
        };
        let mut heads: Vec<String> = Vec::new();
        let mut formats: Vec<Option<String>> = Vec::new();
        let pattern = |x: &X| if plan.no_format { None } else { plan.formats.iter().find(|f| f.0 == *x).map(|f| f.1.clone()) };
        for i in &plain {
            heads.push(head(&select[*i].0, &select[*i].1));
            formats.push(pattern(&select[*i].0));
        }
        if pivoted {
            for pk in &pivkeys {
                let label = pk.iter().map(text_of_q).collect::<Vec<_>>().join(", ");
                for i in &aggs {
                    heads.push(if aggs.len() == 1 { label.clone() } else { format!("{label} {}", head(&select[*i].0, &select[*i].1)) });
                    formats.push(pattern(&select[*i].0));
                }
            }
        } else {
            heads.clear();
            formats.clear();
            for s in &select {
                heads.push(head(&s.0, &s.1));
                formats.push(pattern(&s.0));
            }
        }
        let width = heads.len();
        if plan.no_values {
            if hdr == 0 {
                return Err(ErrKind::Na);
            }
            return Ok(Arg::A(Array { rows: 1, cols: width, data: heads.into_iter().map(Value::Text).collect() }));
        }
        let mut data = Vec::new();
        if hdr > 0 {
            data.extend(heads.into_iter().map(Value::Text));
        }
        let height = rows.len() + usize::from(hdr > 0);
        for r in &rows {
            for (c, q) in r.iter().enumerate() {
                let shown = match (q, formats.get(c).and_then(Option::as_ref)) {
                    (Q::Num(n), Some(pat)) => crate::fmtcode::text(&Value::Number(*n), pat).map(Value::Text),
                    _ => None,
                };
                data.push(shown.unwrap_or_else(|| value_of(q)));
            }
        }
        if rows.is_empty() {
            return Err(ErrKind::Na);
        }
        Ok(Arg::A(Array { rows: height, cols: width, data }))
    }
}
