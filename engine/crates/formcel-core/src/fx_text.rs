use super::*;

const CP1252: [char; 32] = [
    '\u{20AC}', '?', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '?', '\u{017D}', '?', '?', '\u{2018}', '\u{2019}', '\u{201C}',
    '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '?', '\u{017E}', '\u{0178}',
];

fn from_code(n: u32) -> char {
    match n {
        128..=159 => CP1252[n as usize - 128],
        _ => char::from_u32(n).unwrap_or('?'),
    }
}

fn to_code(c: char) -> u32 {
    if let Some(i) = CP1252.iter().position(|&x| x == c && c != '?') {
        return 128 + i as u32;
    }
    c as u32
}

pub(super) fn given(a: &[Expr], i: usize) -> Option<&Expr> {
    a.get(i).filter(|e| !matches!(e, Expr::Missing))
}

fn group(int: &str) -> String {
    let n = int.len();
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (n - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn rounded(x: f64, d: i32) -> f64 {
    let m = 10f64.powi(d);
    let s = sig15(x * m);
    (s.abs() + 0.5).floor() * s.signum() / m
}

fn fixed_text(x: f64, d: i32, commas: bool) -> String {
    let r = rounded(x, d);
    let places = d.max(0) as usize;
    let body = format!("{:.*}", places, r.abs());
    let (int, frac) = match body.split_once('.') {
        Some((i, f)) => (i.to_string(), Some(f.to_string())),
        None => (body, None),
    };
    let int = if commas { group(&int) } else { int };
    let neg = r < 0.0 && (int.chars().any(|c| c.is_ascii_digit() && c != '0') || frac.as_deref().is_some_and(|f| f.chars().any(|c| c != '0')));
    let mut out = String::new();
    if neg {
        out.push('-');
    }
    out.push_str(&int);
    if let Some(f) = frac {
        out.push('.');
        out.push_str(&f);
    }
    out
}

fn proper(s: &str) -> String {
    let mut out = String::new();
    let mut prev = false;
    for c in s.chars() {
        if c.is_alphabetic() {
            if prev {
                out.extend(c.to_lowercase());
            } else {
                out.extend(c.to_uppercase());
            }
            prev = true;
        } else {
            out.push(c);
            prev = false;
        }
    }
    out
}

fn number_value(s: &str, dec: &str, grp: &str) -> Result<f64, ErrKind> {
    let t: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if t.is_empty() {
        return Ok(0.0);
    }
    let (dc, gc) = (dec.chars().next(), grp.chars().next());
    if dc.is_some() && dc == gc {
        return Err(ErrKind::Value);
    }
    let mut seen_dec = false;
    let mut clean = String::new();
    for c in t.chars() {
        if Some(c) == dc {
            if seen_dec {
                return Err(ErrKind::Value);
            }
            seen_dec = true;
            clean.push('.');
        } else if Some(c) == gc {
            if seen_dec {
                return Err(ErrKind::Value);
            }
        } else {
            clean.push(c);
        }
    }
    let n: f64 = clean.parse().map_err(|_| ErrKind::Value)?;
    if !n.is_finite() {
        return Err(ErrKind::Value);
    }
    Ok(n)
}

#[derive(Clone, Copy)]
struct Hit {
    start: usize,
    end: usize,
}

fn delimiter_hits(text: &[char], delims: &[Vec<char>], fold: bool, from_end: bool) -> Vec<Hit> {
    let same = |a: char, b: char| a == b || (fold && a.to_lowercase().eq(b.to_lowercase()));
    let fits = |d: &[char], at: usize| at + d.len() <= text.len() && d.iter().enumerate().all(|(k, &c)| same(text[at + k], c));
    let mut out = Vec::new();
    if !from_end {
        let mut i = 0;
        while i < text.len() {
            match delims.iter().filter(|d| !d.is_empty() && fits(d, i)).map(Vec::len).max() {
                Some(n) => {
                    out.push(Hit { start: i, end: i + n });
                    i += n;
                }
                None => i += 1,
            }
        }
    } else {
        let mut e = text.len();
        while e > 0 {
            match delims.iter().filter(|d| !d.is_empty() && d.len() <= e && fits(d, e - d.len())).map(Vec::len).max() {
                Some(n) => {
                    out.push(Hit { start: e - n, end: e });
                    e -= n;
                }
                None => e -= 1,
            }
        }
    }
    out
}

impl Eval<'_> {
    fn flag(&self, a: &[Expr], i: usize, default: bool) -> Result<bool, ErrKind> {
        match given(a, i) {
            Some(e) => bool_of(&self.scalar(e)),
            None => Ok(default),
        }
    }

    fn whole(&self, a: &[Expr], i: usize, default: f64) -> Result<f64, ErrKind> {
        match given(a, i) {
            Some(e) => Ok(number_of(&self.scalar(e))?.trunc()),
            None => Ok(default),
        }
    }

    fn texts(&self, e: &Expr) -> Result<Vec<String>, ErrKind> {
        self.grid(self.arg(e))?.data.iter().map(text_of).collect()
    }

    fn around(&self, name: &str, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.len() < 2 || a.len() > 6 {
            return Err(ErrKind::Na);
        }
        let text: Vec<char> = self.t(a, 0)?.chars().collect();
        let delims: Vec<Vec<char>> = self.texts(&a[1])?.iter().map(|d| d.chars().collect()).collect();
        let k = self.whole(a, 2, 1.0)? as i64;
        let fold = self.whole(a, 3, 0.0)? == 1.0;
        let end_match = self.flag(a, 4, false)?;
        let missing = || match given(a, 5) {
            Some(e) => self.scalar(e),
            None => err(ErrKind::Na),
        };
        if text.is_empty() {
            return Ok(Value::Text(String::new()));
        }
        if k == 0 || k.unsigned_abs() as usize > text.len() {
            return Err(ErrKind::Value);
        }
        let before = name == "TEXTBEFORE";
        if delims.iter().any(Vec::is_empty) {
            let at = if k > 0 { 0 } else { text.len() };
            let s: String = if before { text[..at].iter().collect() } else { text[at..].iter().collect() };
            return Ok(Value::Text(s));
        }
        let mut hits = delimiter_hits(&text, &delims, fold, k < 0);
        if end_match {
            hits.push(if k > 0 { Hit { start: text.len(), end: text.len() } } else { Hit { start: 0, end: 0 } });
        }
        let Some(h) = hits.get(k.unsigned_abs() as usize - 1) else { return Ok(missing()) };
        let s: String = if before { text[..h.start].iter().collect() } else { text[h.end..].iter().collect() };
        Ok(Value::Text(s))
    }

    fn join(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.len() < 3 {
            return Err(ErrKind::Na);
        }
        let delims = self.texts(&a[0])?;
        let skip = match self.scalar(&a[1]) {
            Value::Error(k) => return Err(k),
            v => bool_of(&v)?,
        };
        let mut parts: Vec<String> = Vec::new();
        for e in &a[2..] {
            for v in self.grid(self.arg(e))?.data {
                match v {
                    Value::Error(k) => return Err(k),
                    Value::Empty if skip => {}
                    Value::Text(ref s) if skip && s.is_empty() => {}
                    o => parts.push(o.to_string()),
                }
            }
        }
        let mut out = String::new();
        for (i, p) in parts.iter().enumerate() {
            if i > 0 && !delims.is_empty() {
                out.push_str(&delims[(i - 1) % delims.len()]);
            }
            out.push_str(p);
        }
        if out.chars().count() > 32767 {
            return Err(ErrKind::Value);
        }
        Ok(Value::Text(out))
    }

    fn quoted(&self, v: &Value, strict: bool) -> String {
        match v {
            Value::Text(s) if strict => format!("\"{}\"", s.replace('"', "\"\"")),
            o => o.to_string(),
        }
    }

    pub(super) fn call_text(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        let r: Result<Value, ErrKind> = (|| {
            Ok(match name {
                "REPLACE" => {
                    if a.len() != 4 {
                        return Err(ErrKind::Na);
                    }
                    let s: Vec<char> = self.t(a, 0)?.chars().collect();
                    let (st, k) = (self.n(a, 1)?.trunc(), self.n(a, 2)?.trunc());
                    if st < 1.0 || k < 0.0 {
                        return Err(ErrKind::Value);
                    }
                    let at = (st as usize - 1).min(s.len());
                    let to = at.saturating_add(k as usize).min(s.len());
                    let mut out: String = s[..at].iter().collect();
                    out.push_str(&self.t(a, 3)?);
                    out.extend(s[to..].iter());
                    Value::Text(out)
                }
                "REPT" => {
                    if a.len() != 2 {
                        return Err(ErrKind::Na);
                    }
                    let (s, k) = (self.t(a, 0)?, self.n(a, 1)?.trunc());
                    if k < 0.0 || (s.chars().count() as f64) * k > 32767.0 {
                        return Err(ErrKind::Value);
                    }
                    Value::Text(s.repeat(k as usize))
                }
                "CHAR" => {
                    let n = self.n(a, 0)?.trunc();
                    if !(1.0..=255.0).contains(&n) {
                        return Err(ErrKind::Value);
                    }
                    Value::Text(from_code(n as u32).to_string())
                }
                "CODE" => match self.t(a, 0)?.chars().next() {
                    Some(c) => Value::Number(f64::from(to_code(c))),
                    None => return Err(ErrKind::Value),
                },
                "UNICHAR" => {
                    let n = self.n(a, 0)?.trunc();
                    if !(1.0..=1_114_111.0).contains(&n) {
                        return Err(ErrKind::Value);
                    }
                    match char::from_u32(n as u32) {
                        Some(c) => Value::Text(c.to_string()),
                        None => return Err(ErrKind::Na),
                    }
                }
                "UNICODE" => match self.t(a, 0)?.chars().next() {
                    Some(c) => Value::Number(f64::from(c as u32)),
                    None => return Err(ErrKind::Value),
                },
                "CLEAN" => Value::Text(self.t(a, 0)?.chars().filter(|c| (*c as u32) >= 32).collect()),
                "PROPER" => Value::Text(proper(&self.t(a, 0)?)),
                "VALUE" => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    match self.scalar(&a[0]) {
                        Value::Error(k) => return Err(k),
                        Value::Number(n) => Value::Number(n),
                        Value::Empty => Value::Number(0.0),
                        Value::Bool(_) => return Err(ErrKind::Value),
                        Value::Text(s) => {
                            let t = s.trim();
                            match Value::parse_input(t) {
                                Value::Number(n) => Value::Number(n),
                                _ => match numfmt::parse(t) {
                                    Some((n, _)) => Value::Number(n),
                                    None => return Err(ErrKind::Value),
                                },
                            }
                        }
                    }
                }
                "NUMBERVALUE" => {
                    if a.is_empty() || a.len() > 3 {
                        return Err(ErrKind::Na);
                    }
                    let text = self.t(a, 0)?;
                    let dec = if given(a, 1).is_some() { self.t(a, 1)? } else { ".".to_string() };
                    let grp = if given(a, 2).is_some() { self.t(a, 2)? } else { ",".to_string() };
                    let mut t: String = text.chars().filter(|c| !c.is_whitespace()).collect();
                    let mut pct = 0;
                    while t.ends_with('%') {
                        t.pop();
                        pct += 1;
                    }
                    let n = number_value(&t, &dec, &grp)?;
                    num(n / 100f64.powi(pct))
                }
                "FIXED" => {
                    if a.is_empty() || a.len() > 3 {
                        return Err(ErrKind::Na);
                    }
                    let x = self.n(a, 0)?;
                    let d = self.whole(a, 1, 2.0)?.clamp(-127.0, 127.0) as i32;
                    let no = self.flag(a, 2, false)?;
                    Value::Text(fixed_text(x, d, !no))
                }
                "DOLLAR" => {
                    if a.is_empty() || a.len() > 2 {
                        return Err(ErrKind::Na);
                    }
                    let x = self.n(a, 0)?;
                    let d = self.whole(a, 1, 2.0)?.clamp(-127.0, 127.0) as i32;
                    let body = fixed_text(x.abs(), d, true);
                    let zero = body.chars().all(|c| !c.is_ascii_digit() || c == '0');
                    Value::Text(if x < 0.0 && !zero { format!("(${body})") } else { format!("${body}") })
                }
                "TEXTBEFORE" | "TEXTAFTER" => self.around(name, a)?,
                "TEXTJOIN" => self.join(a)?,
                "VALUETOTEXT" => {
                    if a.is_empty() || a.len() > 2 {
                        return Err(ErrKind::Na);
                    }
                    let strict = match self.whole(a, 1, 0.0)? as i64 {
                        0 => false,
                        1 => true,
                        _ => return Err(ErrKind::Value),
                    };
                    let v = self.scalar(&a[0]);
                    Value::Text(self.quoted(&v, strict))
                }
                "ARRAYTOTEXT" => {
                    if a.is_empty() || a.len() > 2 {
                        return Err(ErrKind::Na);
                    }
                    let strict = match self.whole(a, 1, 0.0)? as i64 {
                        0 => false,
                        1 => true,
                        _ => return Err(ErrKind::Value),
                    };
                    let g = self.grid(self.arg(&a[0]))?;
                    let mut rows = Vec::new();
                    for r in 0..g.rows {
                        let line: Vec<String> = (0..g.cols).map(|c| self.quoted(g.get(r, c), strict)).collect();
                        rows.push(line.join(if strict { "," } else { ", " }));
                    }
                    if strict {
                        Value::Text(format!("{{{}}}", rows.join(";")))
                    } else {
                        Value::Text(rows.join(", "))
                    }
                }
                "T" => match self.scalar(a.first().ok_or(ErrKind::Na)?) {
                    Value::Error(k) => return Err(k),
                    Value::Text(s) => Value::Text(s),
                    _ => Value::Text(String::new()),
                },
                "N" => match self.scalar(a.first().ok_or(ErrKind::Na)?) {
                    Value::Error(k) => return Err(k),
                    Value::Number(n) => Value::Number(n),
                    Value::Bool(b) => Value::Number(f64::from(u8::from(b))),
                    _ => Value::Number(0.0),
                },
                _ => return Err(ErrKind::Name),
            })
        })();
        if name_known(name) {
            Some(r)
        } else {
            None
        }
    }
}

pub(super) const NAMES: [&str; 19] =
    ["REPLACE", "REPT", "CHAR", "CODE", "UNICHAR", "UNICODE", "CLEAN", "PROPER", "VALUE", "NUMBERVALUE", "FIXED", "DOLLAR", "TEXTBEFORE", "TEXTAFTER", "TEXTJOIN", "VALUETOTEXT", "ARRAYTOTEXT", "T", "N"];

fn name_known(name: &str) -> bool {
    NAMES.contains(&name)
}
