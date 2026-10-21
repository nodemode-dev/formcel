use super::*;
use fancy_regex::{Captures, Regex, RegexBuilder};

fn build(pattern: &str, insensitive: bool) -> Result<Regex, ErrKind> {
    let p = if insensitive { format!("(?i){pattern}") } else { pattern.to_string() };
    RegexBuilder::new(&p).backtrack_limit(1_000_000).delegate_size_limit(1 << 22).build().map_err(|_| ErrKind::Value)
}

fn expand(c: &Captures, repl: &str) -> String {
    let cs: Vec<char> = repl.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < cs.len() {
        let ch = cs[i];
        if (ch == '$' || ch == '\\') && i + 1 < cs.len() {
            let n = cs[i + 1];
            if n.is_ascii_digit() {
                let mut j = i + 1;
                let mut k = 0usize;
                while j < cs.len() && cs[j].is_ascii_digit() && j < i + 3 {
                    k = k * 10 + cs[j].to_digit(10).unwrap_or(0) as usize;
                    j += 1;
                }
                if let Some(m) = c.get(k) {
                    out.push_str(m.as_str());
                }
                i = j;
                continue;
            }
            if ch == '$' && n == '$' {
                out.push('$');
                i += 2;
                continue;
            }
            if ch == '$' && n == '{' {
                if let Some(close) = cs[i + 2..].iter().position(|&x| x == '}') {
                    let name: String = cs[i + 2..i + 2 + close].iter().collect();
                    let m = name.parse::<usize>().ok().and_then(|k| c.get(k)).or_else(|| c.name(&name));
                    if let Some(m) = m {
                        out.push_str(m.as_str());
                    }
                    i += close + 3;
                    continue;
                }
            }
            if ch == '\\' && n == '\\' {
                out.push('\\');
                i += 2;
                continue;
            }
        }
        out.push(ch);
        i += 1;
    }
    out
}

impl Eval<'_> {
    fn insensitive(&self, a: &[Expr], i: usize) -> Result<bool, ErrKind> {
        Ok(self.whole_opt(a, i)? == 1.0)
    }

    fn whole_opt(&self, a: &[Expr], i: usize) -> Result<f64, ErrKind> {
        match fx_text::given(a, i) {
            Some(e) => Ok(number_of(&self.scalar(e))?.trunc()),
            None => Ok(0.0),
        }
    }

    pub(super) fn call_regex(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        if !matches!(name, "REGEXTEST" | "REGEXMATCH" | "REGEXREPLACE") {
            return None;
        }
        Some((|| {
            Ok(match name {
                "REGEXTEST" | "REGEXMATCH" => {
                    if a.len() < 2 || a.len() > 3 {
                        return Err(ErrKind::Na);
                    }
                    let re = build(&self.t(a, 1)?, self.insensitive(a, 2)?)?;
                    Value::Bool(re.is_match(&self.t(a, 0)?).map_err(|_| ErrKind::Value)?)
                }
                _ => {
                    if a.len() < 3 || a.len() > 5 {
                        return Err(ErrKind::Na);
                    }
                    let text = self.t(a, 0)?;
                    let re = build(&self.t(a, 1)?, self.insensitive(a, 4)?)?;
                    let repl = self.t(a, 2)?;
                    let k = self.whole_opt(a, 3)? as i64;
                    let all: Vec<Captures> = re.captures_iter(&text).collect::<Result<_, _>>().map_err(|_| ErrKind::Value)?;
                    let pick: Vec<usize> = if k == 0 {
                        (0..all.len()).collect()
                    } else if k > 0 {
                        vec![k as usize - 1].into_iter().filter(|&i| i < all.len()).collect()
                    } else {
                        all.len().checked_sub(k.unsigned_abs() as usize).into_iter().collect()
                    };
                    let mut out = String::new();
                    let mut last = 0;
                    for i in pick {
                        let m = all[i].get(0).ok_or(ErrKind::Value)?;
                        out.push_str(&text[last..m.start()]);
                        out.push_str(&expand(&all[i], &repl));
                        last = m.end();
                    }
                    out.push_str(&text[last..]);
                    Value::Text(out)
                }
            })
        })())
    }

    pub(super) fn extract(&self, a: &[Expr]) -> Result<Arg, ErrKind> {
        if a.len() < 2 || a.len() > 4 {
            return Err(ErrKind::Na);
        }
        let text = self.t(a, 0)?;
        let re = build(&self.t(a, 1)?, self.insensitive(a, 3)?)?;
        let groups = re.captures_len() > 1;
        let mode = if a.len() == 2 && groups { 2 } else { self.whole_opt(a, 2)? as i64 };
        let row = |data: Vec<Value>| Arg::A(Array { rows: 1, cols: data.len(), data });
        match mode {
            0 => match re.find(&text).map_err(|_| ErrKind::Value)? {
                Some(m) => Ok(Arg::V(Value::Text(m.as_str().to_string()))),
                None => Err(ErrKind::Na),
            },
            1 => {
                let mut data: Vec<Value> = Vec::new();
                for m in re.find_iter(&text) {
                    data.push(Value::Text(m.map_err(|_| ErrKind::Value)?.as_str().to_string()));
                }
                if data.is_empty() {
                    return Err(ErrKind::Na);
                }
                Ok(row(data))
            }
            2 => {
                let c = re.captures(&text).map_err(|_| ErrKind::Value)?.ok_or(ErrKind::Na)?;
                let data: Vec<Value> = (1..c.len()).map(|i| Value::Text(c.get(i).map_or(String::new(), |m| m.as_str().to_string()))).collect();
                if data.is_empty() {
                    return Err(ErrKind::Value);
                }
                if data.len() == 1 {
                    return Ok(Arg::V(data[0].clone()));
                }
                Ok(row(data))
            }
            _ => Err(ErrKind::Value),
        }
    }
}
