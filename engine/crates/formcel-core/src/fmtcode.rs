use crate::numfmt::{weekday, ymd};
use crate::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Color {
    Black,
    Green,
    White,
    Blue,
    Magenta,
    Yellow,
    Cyan,
    Red,
}

impl Color {
    pub fn rgb(self) -> u32 {
        match self {
            Color::Black => 0x000000,
            Color::Green => 0x00ff00,
            Color::White => 0xffffff,
            Color::Blue => 0x0000ff,
            Color::Magenta => 0xff00ff,
            Color::Yellow => 0xffff00,
            Color::Cyan => 0x00ffff,
            Color::Red => 0xff0000,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Lit(String),
    Digit(char),
    Point,
    Comma,
    Percent,
    Exp(bool, usize),
    Slash,
    At,
    General,
    Date(char, usize),
    AmPm(bool),
    Elapsed(char, usize),
    Frac(usize),
}

#[derive(Clone, Debug)]
struct Section {
    toks: Vec<Tok>,
    color: Option<Color>,
    cond: Option<(String, f64)>,
}

impl Section {
    fn is_date(&self) -> bool {
        self.toks.iter().any(|t| matches!(t, Tok::Date(..) | Tok::AmPm(_) | Tok::Elapsed(..)))
    }

    fn is_text(&self) -> bool {
        self.toks.iter().any(|t| matches!(t, Tok::At))
    }

    fn has_number(&self) -> bool {
        self.toks.iter().any(|t| matches!(t, Tok::Digit(_) | Tok::General))
    }
}

#[derive(Clone, Debug)]
pub struct Code {
    sections: Vec<Section>,
}

fn color_of(s: &str) -> Option<Color> {
    Some(match s.to_ascii_lowercase().as_str() {
        "black" => Color::Black,
        "green" => Color::Green,
        "white" => Color::White,
        "blue" => Color::Blue,
        "magenta" => Color::Magenta,
        "yellow" => Color::Yellow,
        "cyan" => Color::Cyan,
        "red" => Color::Red,
        _ => return None,
    })
}

fn section(src: &str) -> Option<Section> {
    let c: Vec<char> = src.chars().collect();
    let mut toks = Vec::new();
    let mut color = None;
    let mut cond = None;
    let mut i = 0;
    let lit = |toks: &mut Vec<Tok>, s: &str| match toks.last_mut() {
        Some(Tok::Lit(l)) => l.push_str(s),
        _ => toks.push(Tok::Lit(s.to_string())),
    };
    while i < c.len() {
        let ch = c[i];
        let low = ch.to_ascii_lowercase();
        match ch {
            '"' => {
                let end = c[i + 1..].iter().position(|&x| x == '"')? + i + 1;
                lit(&mut toks, &c[i + 1..end].iter().collect::<String>());
                i = end + 1;
                continue;
            }
            '\\' => {
                lit(&mut toks, &c.get(i + 1)?.to_string());
                i += 2;
                continue;
            }
            '_' => {
                c.get(i + 1)?;
                lit(&mut toks, " ");
                i += 2;
                continue;
            }
            '*' => {
                c.get(i + 1)?;
                i += 2;
                continue;
            }
            '[' => {
                let end = c[i + 1..].iter().position(|&x| x == ']')? + i + 1;
                let inner: String = c[i + 1..end].iter().collect();
                let lower = inner.to_ascii_lowercase();
                if let Some(col) = color_of(&inner) {
                    color = Some(col);
                } else if let Some(rest) = inner.strip_prefix('$') {
                    lit(&mut toks, rest.split('-').next().unwrap_or(""));
                } else if !lower.is_empty() && lower.chars().all(|x| x == lower.chars().next().unwrap_or(' ')) && matches!(lower.chars().next(), Some('h' | 'm' | 's')) {
                    toks.push(Tok::Elapsed(lower.chars().next()?, lower.len()));
                } else {
                    let op_len = inner.chars().take_while(|x| matches!(x, '<' | '>' | '=')).count();
                    if op_len == 0 {
                        return None;
                    }
                    let (op, num) = inner.split_at(op_len);
                    cond = Some((op.to_string(), num.trim().parse().ok()?));
                }
                i = end + 1;
                continue;
            }
            _ => {}
        }
        let rest: String = c[i..].iter().collect::<String>().to_ascii_lowercase();
        if rest.starts_with("general") {
            toks.push(Tok::General);
            i += 7;
            continue;
        }
        if rest.starts_with("am/pm") {
            toks.push(Tok::AmPm(false));
            i += 5;
            continue;
        }
        if rest.starts_with("a/p") {
            toks.push(Tok::AmPm(true));
            i += 3;
            continue;
        }
        match ch {
            '0' | '#' | '?' => toks.push(Tok::Digit(ch)),
            '.' => {
                if matches!(toks.last(), Some(Tok::Date('s', _)) | Some(Tok::Elapsed('s', _))) || (toks.iter().any(|t| matches!(t, Tok::Date('s', _) | Tok::Elapsed('s', _))) && c.get(i + 1) == Some(&'0')) {
                    let n = c[i + 1..].iter().take_while(|&&x| x == '0').count();
                    toks.push(Tok::Frac(n));
                    i += 1 + n;
                    continue;
                }
                toks.push(Tok::Point)
            }
            ',' => toks.push(Tok::Comma),
            '%' => toks.push(Tok::Percent),
            '@' => toks.push(Tok::At),
            '/' => toks.push(Tok::Slash),
            'E' | 'e' if matches!(c.get(i + 1), Some('+') | Some('-')) => {
                let n = c[i + 2..].iter().take_while(|&&x| matches!(x, '0' | '#' | '?')).count();
                toks.push(Tok::Exp(c[i + 1] == '+', n.max(1)));
                i += 2 + n;
                continue;
            }
            _ if matches!(low, 'y' | 'm' | 'd' | 'h' | 's') => {
                let n = c[i..].iter().take_while(|x| x.to_ascii_lowercase() == low).count();
                toks.push(Tok::Date(low, n));
                i += n;
                continue;
            }
            _ => lit(&mut toks, &ch.to_string()),
        }
        i += 1;
    }
    Some(Section { toks, color, cond })
}

pub fn parse(code: &str) -> Option<Code> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = code.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                quoted = !quoted;
                cur.push(ch);
            }
            '\\' if !quoted => {
                cur.push(ch);
                cur.push(chars.next()?);
            }
            ';' if !quoted => parts.push(std::mem::take(&mut cur)),
            _ => cur.push(ch),
        }
    }
    if quoted {
        return None;
    }
    parts.push(cur);
    if parts.len() > 4 {
        return None;
    }
    Some(Code { sections: parts.iter().map(|p| section(p)).collect::<Option<Vec<_>>>()? })
}

fn holds(cond: &(String, f64), x: f64) -> bool {
    let v = cond.1;
    match cond.0.as_str() {
        "<" => x < v,
        "<=" | "=<" => x <= v,
        ">" => x > v,
        ">=" | "=>" => x >= v,
        "=" => x == v,
        "<>" => x != v,
        _ => false,
    }
}

fn general(x: f64) -> String {
    Value::Number(x).to_string()
}

fn round_to(x: f64, d: usize) -> f64 {
    let p = 10f64.powi(d as i32);
    (x * p).round() / p
}

fn group(digits: &str) -> String {
    let n = digits.len();
    let mut out = String::with_capacity(n + n / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (n - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

fn fill_int(slots: &[char], digits: &str) -> Vec<String> {
    let ds: Vec<char> = digits.chars().collect();
    let mut out = vec![String::new(); slots.len()];
    let mut k = ds.len();
    for i in (0..slots.len()).rev() {
        if k > 0 {
            k -= 1;
            out[i] = ds[k].to_string();
            if i == 0 {
                out[i] = ds[..=k].iter().collect();
                k = 0;
            }
        } else {
            out[i] = match slots[i] {
                '0' => "0".into(),
                '?' => " ".into(),
                _ => String::new(),
            };
        }
    }
    out
}

fn fill_frac(slots: &[char], digits: &str) -> Vec<String> {
    let ds: Vec<char> = digits.chars().collect();
    let mut out: Vec<String> = ds.iter().map(|d| d.to_string()).collect();
    for i in (0..slots.len()).rev() {
        if ds[i] != '0' || slots[i] == '0' {
            break;
        }
        out[i] = if slots[i] == '?' { " ".into() } else { String::new() };
    }
    out
}

fn best_fraction(x: f64, max_den: u64) -> (u64, u64) {
    let (mut best, mut err) = ((0u64, 1u64), x);
    for den in 1..=max_den {
        let num = (x * den as f64).round() as u64;
        let e = (x - num as f64 / den as f64).abs();
        if e < err - 1e-12 {
            best = (num, den);
            err = e;
        }
    }
    best
}

fn number(sec: &Section, x: f64) -> String {
    let toks = &sec.toks;
    let mut x = x;
    for t in toks {
        if *t == Tok::Percent {
            x *= 100.0;
        }
    }
    let last_digit = toks.iter().rposition(|t| matches!(t, Tok::Digit(_)));
    let point = toks.iter().position(|t| *t == Tok::Point);
    let int_end = point.or_else(|| toks.iter().position(|t| matches!(t, Tok::Exp(..)))).unwrap_or(toks.len());
    let mut scale = 0;
    let mut thousands = false;
    for (i, t) in toks.iter().enumerate() {
        if *t != Tok::Comma {
            continue;
        }
        let before = toks[..i].iter().rev().find(|t| !matches!(t, Tok::Comma));
        let after = toks[i + 1..].iter().find(|t| !matches!(t, Tok::Comma));
        if matches!(before, Some(Tok::Digit(_))) && matches!(after, Some(Tok::Digit(_))) && i < int_end {
            thousands = true;
        } else if matches!(before, Some(Tok::Digit(_))) && last_digit.is_some_and(|l| i > l || matches!(after, Some(Tok::Point) | None | Some(Tok::Lit(_)) | Some(Tok::Percent))) {
            scale += 1;
        }
    }
    x /= 1000f64.powi(scale);
    if let Some(si) = toks.iter().position(|t| *t == Tok::Slash) {
        return fraction(toks, si, x);
    }
    let int_slots: Vec<char> = toks[..int_end].iter().filter_map(|t| if let Tok::Digit(d) = t { Some(*d) } else { None }).collect();
    let frac_end = toks.iter().position(|t| matches!(t, Tok::Exp(..))).unwrap_or(toks.len());
    let frac_slots: Vec<char> = point.map_or(Vec::new(), |p| toks[p + 1..frac_end].iter().filter_map(|t| if let Tok::Digit(d) = t { Some(*d) } else { None }).collect());
    let mut exp_val = 0i32;
    if let Some(Tok::Exp(..)) = toks.get(frac_end) {
        let n_int = int_slots.len().max(1) as i32;
        if x != 0.0 {
            let e = x.abs().log10().floor() as i32;
            exp_val = if int_slots.contains(&'#') { e.div_euclid(n_int) * n_int } else { e - (n_int - 1) };
        }
        x /= 10f64.powi(exp_val);
        if round_to(x.abs(), frac_slots.len()) >= 10f64.powi(int_slots.len().max(1) as i32) {
            x /= 10.0;
            exp_val += 1;
        }
    }
    let r = round_to(x.abs(), frac_slots.len());
    let int_part = r.trunc();
    let int_digits = if int_part == 0.0 { String::new() } else { format!("{:.0}", int_part) };
    let frac_digits = if frac_slots.is_empty() { String::new() } else { format!("{:.*}", frac_slots.len(), r - int_part).trim_start_matches('0').trim_start_matches('.').to_string() };
    let frac_digits = format!("{:0<width$}", frac_digits, width = frac_slots.len());
    let mut int_text = fill_int(&int_slots, &int_digits);
    if thousands {
        let joined: String = int_text.concat();
        let trimmed = joined.trim_start();
        let pad = joined.len() - trimmed.len();
        let grouped = format!("{}{}", " ".repeat(pad), group(trimmed));
        int_text = vec![grouped];
        int_text.extend(std::iter::repeat_n(String::new(), int_slots.len().saturating_sub(1)));
    }
    let frac_text = fill_frac(&frac_slots, &frac_digits);
    let (mut ii, mut fi) = (0, 0);
    let mut out = String::new();
    for (i, t) in toks.iter().enumerate() {
        match t {
            Tok::Digit(_) if i < int_end => {
                out.push_str(&int_text[ii]);
                ii += 1;
            }
            Tok::Digit(_) if i < frac_end => {
                out.push_str(&frac_text[fi]);
                fi += 1;
            }
            Tok::Point => {
                if int_slots.is_empty() {
                    out.push_str(&int_digits);
                }
                out.push('.')
            }
            Tok::Lit(s) => out.push_str(s),
            Tok::Percent => out.push('%'),
            Tok::General => out.push_str(&general(x.abs())),
            Tok::Exp(plus, n) => {
                out.push('E');
                if exp_val < 0 {
                    out.push('-');
                } else if *plus {
                    out.push('+');
                }
                out.push_str(&format!("{:0width$}", exp_val.abs(), width = *n));
            }
            _ => {}
        }
    }
    out
}

fn fraction(toks: &[Tok], si: usize, x: f64) -> String {
    let num_start = toks[..si].iter().rposition(|t| !matches!(t, Tok::Digit(_))).map_or(0, |p| p + 1);
    let num_slots: Vec<char> = toks[num_start..si].iter().filter_map(|t| if let Tok::Digit(d) = t { Some(*d) } else { None }).collect();
    let int_slots: Vec<char> = toks[..num_start].iter().filter_map(|t| if let Tok::Digit(d) = t { Some(*d) } else { None }).collect();
    let den_toks: Vec<&Tok> = toks[si + 1..].iter().take_while(|t| matches!(t, Tok::Digit(_) | Tok::Lit(_)) && !matches!(t, Tok::Lit(s) if !s.chars().all(|c| c.is_ascii_digit()))).collect();
    let fixed: String = den_toks.iter().filter_map(|t| if let Tok::Lit(s) = t { Some(s.as_str()) } else { None }).collect();
    let den_slots: Vec<char> = den_toks.iter().filter_map(|t| if let Tok::Digit(d) = t { Some(*d) } else { None }).collect();
    let a = x.abs();
    let (whole, rest) = if int_slots.is_empty() { (0.0, a) } else { (a.trunc(), a - a.trunc()) };
    let (mut n, d) = if let Ok(fd) = fixed.parse::<u64>() { ((rest * fd as f64).round() as u64, fd) } else { best_fraction(rest, 10u64.pow(den_slots.len().max(1) as u32) - 1) };
    let mut whole = whole;
    if n == d && !int_slots.is_empty() {
        whole += 1.0;
        n = 0;
    }
    let pad_left = |s: String, w: usize| format!("{:>w$}", s, w = w);
    let pad_right = |s: String, w: usize| format!("{:<w$}", s, w = w);
    let mut out = String::new();
    let int_text = fill_int(&int_slots, &if whole == 0.0 { String::new() } else { format!("{:.0}", whole) }).concat();
    let mut seen_int = false;
    for t in &toks[..num_start] {
        match t {
            Tok::Digit(_) => {
                if !seen_int {
                    out.push_str(&int_text);
                    seen_int = true;
                }
            }
            Tok::Lit(s) => out.push_str(s),
            _ => {}
        }
    }
    let den_w = den_slots.len().max(fixed.len());
    if n == 0 && !int_slots.is_empty() {
        out.push_str(&" ".repeat(num_slots.len() + 1 + den_w));
        return out;
    }
    out.push_str(&pad_left(n.to_string(), num_slots.len()));
    out.push('/');
    out.push_str(&pad_right(d.to_string(), den_w));
    for t in toks[si + 1 + den_toks.len()..].iter() {
        if let Tok::Lit(s) = t {
            out.push_str(s);
        }
    }
    out
}

fn date(sec: &Section, x: f64) -> Option<String> {
    let toks = &sec.toks;
    let has_frac = toks.iter().find_map(|t| if let Tok::Frac(n) = t { Some(*n) } else { None }).unwrap_or(0);
    let total_secs = round_to(x * 86_400.0, has_frac);
    let day = (total_secs / 86_400.0).floor();
    let (y, mo, d) = ymd(day)?;
    let tod = total_secs - day * 86_400.0;
    let (h, mi, s) = ((tod / 3600.0).floor() as i64, ((tod % 3600.0) / 60.0).floor() as i64, (tod % 60.0).floor() as i64);
    let frac = tod - tod.floor();
    let twelve = toks.iter().any(|t| matches!(t, Tok::AmPm(_)));
    let kinds: Vec<(usize, char)> = toks.iter().enumerate().filter_map(|(i, t)| match t {
        Tok::Date(c, _) => Some((i, *c)),
        Tok::Elapsed(c, _) => Some((i, *c)),
        _ => None,
    }).collect();
    let minute_at = |i: usize| {
        let k = kinds.iter().position(|&(j, _)| j == i).unwrap_or(0);
        (k > 0 && kinds[k - 1].1 == 'h') || kinds.get(k + 1).is_some_and(|&(_, c)| c == 's')
    };
    let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let mut out = String::new();
    for (i, t) in toks.iter().enumerate() {
        match t {
            Tok::Lit(s) => out.push_str(s),
            Tok::Date('y', n) => out.push_str(&if *n <= 2 { format!("{:02}", y % 100) } else { y.to_string() }),
            Tok::Date('m', n) if *n <= 2 && minute_at(i) => out.push_str(&if *n == 1 { mi.to_string() } else { format!("{:02}", mi) }),
            Tok::Date('m', n) => {
                let name = months[(mo - 1) as usize];
                out.push_str(&match n {
                    1 => mo.to_string(),
                    2 => format!("{:02}", mo),
                    3 => name[..3].to_string(),
                    5 => name[..1].to_string(),
                    _ => name.to_string(),
                });
            }
            Tok::Date('d', n) => {
                let name = days[(weekday(day) - 1) as usize];
                out.push_str(&match n {
                    1 => d.to_string(),
                    2 => format!("{:02}", d),
                    3 => name[..3].to_string(),
                    _ => name.to_string(),
                });
            }
            Tok::Date('h', n) => {
                let hh = if twelve { (h + 11) % 12 + 1 } else { h };
                out.push_str(&if *n == 1 { hh.to_string() } else { format!("{:02}", hh) });
            }
            Tok::Date('s', n) => out.push_str(&if *n == 1 { s.to_string() } else { format!("{:02}", s) }),
            Tok::Frac(n) => out.push_str(&format!("{:.*}", *n, frac)[1..]),
            Tok::Elapsed(c, n) => {
                let v = match c {
                    'h' => (total_secs / 3600.0).floor(),
                    'm' => (total_secs / 60.0).floor(),
                    _ => total_secs.floor(),
                };
                out.push_str(&format!("{:0width$}", v as i64, width = *n));
            }
            Tok::AmPm(short) => {
                let pm = h >= 12;
                out.push_str(match (short, pm) {
                    (false, false) => "AM",
                    (false, true) => "PM",
                    (true, false) => "A",
                    (true, true) => "P",
                });
            }
            Tok::Digit(ch) => out.push(*ch),
            Tok::Point => out.push('.'),
            Tok::Comma => out.push(','),
            Tok::Slash => out.push('/'),
            _ => {}
        }
    }
    Some(out)
}

fn literal(sec: &Section, text: Option<&str>) -> String {
    let mut out = String::new();
    for t in &sec.toks {
        match t {
            Tok::Lit(s) => out.push_str(s),
            Tok::At => out.push_str(text.unwrap_or("")),
            Tok::Point => out.push('.'),
            Tok::Comma => out.push(','),
            Tok::Slash => out.push('/'),
            Tok::Percent => out.push('%'),
            _ => {}
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Number,
    Percent,
    Date,
    Time,
    DateTime,
    Text,
}

impl Code {
    pub fn class(&self) -> Class {
        let s = &self.sections[0];
        if s.is_text() && !s.has_number() && self.sections.len() == 1 {
            return Class::Text;
        }
        if s.is_date() {
            let date = s.toks.iter().any(|t| matches!(t, Tok::Date('y' | 'd', _)) || matches!(t, Tok::Date('m', n) if *n > 2));
            let time = s.toks.iter().any(|t| matches!(t, Tok::Date('h' | 's', _) | Tok::AmPm(_) | Tok::Elapsed(..)));
            return match (date, time) {
                (true, true) => Class::DateTime,
                (false, true) => Class::Time,
                _ => Class::Date,
            };
        }
        if s.toks.contains(&Tok::Percent) {
            return Class::Percent;
        }
        Class::Number
    }

    pub fn render(&self, v: &Value) -> Option<(String, Option<Color>)> {
        let secs = &self.sections;
        match v {
            Value::Number(x) => {
                let x = *x;
                let (sec, abs) = if secs.iter().any(|s| s.cond.is_some()) {
                    let hit = secs.iter().take(2).position(|s| s.cond.as_ref().is_some_and(|c| holds(c, x)));
                    match hit {
                        Some(k) => (&secs[k], false),
                        None => (secs.get(2).or_else(|| secs.iter().find(|s| s.cond.is_none())).unwrap_or(&secs[secs.len() - 1]), x < 0.0),
                    }
                } else if x < 0.0 && secs.len() >= 2 && !secs[1].is_text() {
                    (&secs[1], true)
                } else if x == 0.0 && secs.len() >= 3 && !secs[2].is_text() {
                    (&secs[2], false)
                } else {
                    (&secs[0], false)
                };
                if sec.is_text() && !sec.has_number() {
                    return Some((general(x), None));
                }
                let body = if sec.is_date() {
                    if x < 0.0 {
                        return None;
                    }
                    date(sec, x)?
                } else if sec.has_number() {
                    number(sec, if abs { x.abs() } else { x })
                } else {
                    literal(sec, None)
                };
                let neg = x < 0.0 && !abs && !sec.is_date() && sec.has_number() && body.chars().any(|c| c.is_ascii_digit() && c != '0');
                Some((if neg { format!("-{body}") } else { body }, sec.color))
            }
            Value::Text(t) => {
                let sec = secs.get(3).or_else(|| secs.iter().find(|s| s.is_text() && !s.has_number()));
                Some(match sec {
                    Some(s) => (literal(s, Some(t)), s.color),
                    None => (t.clone(), None),
                })
            }
            other => Some((other.to_string(), None)),
        }
    }
}

pub fn text(v: &Value, code: &str) -> Option<String> {
    parse(code)?.render(v).map(|r| r.0)
}
