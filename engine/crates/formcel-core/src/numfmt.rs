use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fmt {
    Currency(u8),
    Percent(u8),
    Date,
    Time { secs: bool, ampm: bool },
    DateTime { secs: bool, ampm: bool },
}

impl Fmt {
    pub fn is_date(self) -> bool {
        matches!(self, Fmt::Date | Fmt::DateTime { .. })
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn base() -> i64 {
    days_from_civil(1899, 12, 31)
}

fn march_1900() -> i64 {
    days_from_civil(1900, 3, 1)
}

pub fn serial(y: i64, m: i64, d: i64) -> Option<f64> {
    let y = y + (m - 1).div_euclid(12);
    let m = (m - 1).rem_euclid(12) + 1;
    if (y, m, d) == (1900, 2, 29) {
        return Some(60.0);
    }
    let days = days_from_civil(y, m, 1) + d - 1;
    let mut n = days - base();
    if days >= march_1900() {
        n += 1;
    }
    (0..=2_958_465).contains(&n).then_some(n as f64)
}

pub fn ymd(serial: f64) -> Option<(i64, i64, i64)> {
    if !(0.0..2_958_466.0).contains(&serial) {
        return None;
    }
    let n = serial.floor() as i64;
    if n == 60 {
        return Some((1900, 2, 29));
    }
    if n == 0 {
        return Some((1900, 1, 0));
    }
    let days = if n < 60 { base() + n } else { base() + n - 1 };
    Some(civil_from_days(days))
}

pub fn hms(serial: f64) -> (i64, i64, i64) {
    let secs = ((serial - serial.floor()) * 86_400.0).round() as i64 % 86_400;
    (secs / 3600, secs / 60 % 60, secs % 60)
}

pub fn weekday(serial: f64) -> i64 {
    (serial.floor() as i64 - 1).rem_euclid(7) + 1
}

const MONTHS: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

fn month_of(s: &str) -> Option<i64> {
    let s = s.trim_end_matches('.').to_ascii_lowercase();
    if s.len() < 3 {
        return None;
    }
    MONTHS.iter().position(|m| m.starts_with(&s) && (s.len() == 3 || *m == s)).map(|i| i as i64 + 1)
}

fn year_of(s: &str) -> Option<i64> {
    if !s.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let y: i64 = s.parse().ok()?;
    match s.len() {
        1 | 2 => Some(if y < 30 { 2000 + y } else { 1900 + y }),
        4 => Some(y),
        _ => None,
    }
}

fn num(s: &str) -> Option<i64> {
    (!s.is_empty() && s.len() <= 2 && s.chars().all(|c| c.is_ascii_digit())).then(|| s.parse().ok()).flatten()
}

fn valid(y: i64, m: i64, d: i64) -> Option<f64> {
    if !(1..=12).contains(&m) || d < 1 {
        return None;
    }
    let last = if m == 12 { 31 } else { days_from_civil(y, m + 1, 1) - days_from_civil(y, m, 1) };
    if d > last && !(y == 1900 && m == 2 && d == 29) {
        return None;
    }
    serial(y, m, d)
}

fn parse_date(s: &str) -> Option<f64> {
    let s = s.trim();
    for sep in ['-', '/'] {
        let p: Vec<&str> = s.split(sep).collect();
        if p.len() == 2 && sep == '-' {
            if let (Some(d), Some(m)) = (num(p[0]), month_of(p[1])) {
                let (y, _, _) = ymd(now())?;
                return valid(y, m, d);
            }
        }
        if p.len() == 3 {
            if p[0].len() == 4 && p[0].chars().all(|c| c.is_ascii_digit()) {
                return valid(p[0].parse().ok()?, num(p[1])?, num(p[2])?);
            }
            if sep == '/' {
                return valid(year_of(p[2])?, num(p[0])?, num(p[1])?);
            }
            if let Some(m) = month_of(p[1]) {
                return valid(year_of(p[2])?, m, num(p[0])?);
            }
        }
    }
    let words: Vec<&str> = s.split([' ', ',']).filter(|w| !w.is_empty()).collect();
    if words.len() == 3 {
        if let Some(m) = month_of(words[0]) {
            return valid(year_of(words[2])?, m, num(words[1])?);
        }
        if let Some(m) = month_of(words[1]) {
            return valid(year_of(words[2])?, m, num(words[0])?);
        }
    }
    None
}

fn parse_time(s: &str) -> Option<(f64, bool, bool)> {
    let s = s.trim();
    let up = s.to_ascii_uppercase();
    let (body, pm) = if let Some(b) = up.strip_suffix("PM") {
        (b.trim().to_string(), Some(true))
    } else if let Some(b) = up.strip_suffix("AM") {
        (b.trim().to_string(), Some(false))
    } else {
        (up.clone(), None)
    };
    let p: Vec<&str> = body.split(':').collect();
    if p.len() < 2 && pm.is_none() || p.len() > 3 {
        return None;
    }
    let h = num(p[0])?;
    let m = if p.len() > 1 { num(p[1]).filter(|_| p[1].len() == 2)? } else { 0 };
    let sec: f64 = if p.len() == 3 { p[2].parse().ok().filter(|v: &f64| (0.0..60.0).contains(v))? } else { 0.0 };
    if m > 59 {
        return None;
    }
    let h = match pm {
        Some(true) if (1..=12).contains(&h) => h % 12 + 12,
        Some(false) if (1..=12).contains(&h) => h % 12,
        Some(_) => return None,
        None if h <= 23 => h,
        None => return None,
    };
    Some(((h as f64 * 3600.0 + m as f64 * 60.0 + sec) / 86_400.0, p.len() == 3, pm.is_some()))
}

pub fn parse(s: &str) -> Option<(f64, Fmt)> {
    let t = s.trim();
    if !t.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    if let Some(d) = parse_date(t) {
        return Some((d, Fmt::Date));
    }
    if let Some((v, secs, ampm)) = parse_time(t) {
        return Some((v, Fmt::Time { secs, ampm }));
    }
    for (i, _) in t.match_indices(' ') {
        if let (Some(d), Some((v, secs, ampm))) = (parse_date(&t[..i]), parse_time(&t[i + 1..])) {
            return Some((d + v, Fmt::DateTime { secs, ampm }));
        }
    }
    None
}

fn time_text(v: f64, secs: bool, ampm: bool) -> String {
    let (h, m, s) = hms(v);
    let tail = if secs { format!(":{s:02}") } else { String::new() };
    if ampm {
        let h12 = if h % 12 == 0 { 12 } else { h % 12 };
        format!("{h12}:{m:02}{tail} {}", if h < 12 { "AM" } else { "PM" })
    } else {
        format!("{h}:{m:02}{tail}")
    }
}

fn grouped(n: f64, dec: u8) -> String {
    let s = format!("{:.*}", dec as usize, n.abs());
    let (int, frac) = s.split_once('.').map_or((s.as_str(), ""), |(a, b)| (a, b));
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if !frac.is_empty() {
        out.push('.');
        out.push_str(frac);
    }
    out
}

pub fn show(n: f64, f: Fmt) -> Option<String> {
    Some(match f {
        Fmt::Currency(d) => format!("{}${}", if n < 0.0 { "-" } else { "" }, grouped(n, d)),
        Fmt::Percent(d) => format!("{:.*}%", d as usize, n * 100.0),
        Fmt::Date => {
            let (y, m, d) = ymd(n)?;
            format!("{m}/{d}/{y}")
        }
        Fmt::Time { secs, ampm } => {
            if n < 0.0 {
                return None;
            }
            time_text(n, secs, ampm)
        }
        Fmt::DateTime { secs, ampm } => {
            let (y, m, d) = ymd(n)?;
            format!("{m}/{d}/{y} {}", time_text(n, secs, ampm))
        }
    })
}

static CLOCK: AtomicU64 = AtomicU64::new(0);

pub fn set_clock(serial: f64) {
    CLOCK.store(serial.to_bits(), Ordering::Relaxed);
}

pub fn now() -> f64 {
    let v = f64::from_bits(CLOCK.load(Ordering::Relaxed));
    if v > 0.0 {
        return v;
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        if let Ok(d) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
            return d.as_secs_f64() / 86_400.0 + 25_569.0;
        }
    }
    0.0
}
