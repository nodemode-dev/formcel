use super::*;
use std::collections::HashSet;

fn leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn month_days(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => 28 + i64::from(leap(y)),
    }
}

fn ordinal(s: f64) -> Option<(i64, i64, i64, i64)> {
    let (y, m, d) = numfmt::ymd(s)?;
    let first = numfmt::serial(y, 1, 1)?;
    Some((y, m, d, s.floor() as i64 - first as i64 + 1))
}

fn weeks_in(y: i64) -> i64 {
    let p = |y: i64| (y + y.div_euclid(4) - y.div_euclid(100) + y.div_euclid(400)).rem_euclid(7);
    if p(y) == 4 || p(y - 1) == 3 {
        53
    } else {
        52
    }
}

fn iso_week(s: f64) -> Option<i64> {
    let (y, _, _, doy) = ordinal(s)?;
    let wd = (numfmt::weekday(s) + 5) % 7 + 1;
    let w = (doy - wd + 10).div_euclid(7);
    Some(if w < 1 {
        weeks_in(y - 1)
    } else if w > weeks_in(y) {
        1
    } else {
        w
    })
}

fn days360(a: f64, b: f64, european: bool) -> Option<f64> {
    let (y1, m1, mut d1) = numfmt::ymd(a)?;
    let (y2, mut m2, mut d2) = numfmt::ymd(b)?;
    let mut y2 = y2;
    if european {
        d1 = d1.min(30);
        d2 = d2.min(30);
    } else {
        let last_feb = |y: i64, m: i64, d: i64| m == 2 && d == month_days(y, 2);
        let start_feb = last_feb(y1, m1, d1);
        if start_feb && last_feb(y2, m2, d2) {
            d2 = 30;
        }
        if start_feb {
            d1 = 30;
        }
        if d1 == 31 {
            d1 = 30;
        }
        if d2 == 31 {
            if d1 < 30 {
                d2 = 1;
                m2 += 1;
                if m2 > 12 {
                    m2 = 1;
                    y2 += 1;
                }
            } else {
                d2 = 30;
            }
        }
    }
    Some(((y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)) as f64)
}

fn yearfrac(start: f64, end: f64, basis: i64) -> Option<f64> {
    let (s, e) = if start <= end { (start.floor(), end.floor()) } else { (end.floor(), start.floor()) };
    Some(match basis {
        0 => days360(s, e, false)? / 360.0,
        4 => days360(s, e, true)? / 360.0,
        2 => (e - s) / 360.0,
        3 => (e - s) / 365.0,
        _ => {
            let (y1, m1, d1) = numfmt::ymd(s)?;
            let (y2, m2, d2) = numfmt::ymd(e)?;
            let within = y1 == y2 || (y2 == y1 + 1 && (m1, d1) >= (m2, d2));
            let den = if within {
                let has29 = |y: i64| leap(y) && numfmt::serial(y, 2, 29).is_some_and(|f| f >= s && f <= e);
                if y1 == y2 { if leap(y1) { 366.0 } else { 365.0 } } else if has29(y1) || has29(y2) { 366.0 } else { 365.0 }
            } else {
                let total: i64 = (y1..=y2).map(|y| 365 + i64::from(leap(y))).sum();
                total as f64 / (y2 - y1 + 1) as f64
            };
            (e - s) / den
        }
    })
}

fn weekend_codes(code: i64) -> Option<[bool; 7]> {
    let mut m = [false; 7];
    match code {
        1..=7 => {
            let first = (code as usize + 4) % 7;
            m[first] = true;
            m[(first + 1) % 7] = true;
        }
        11..=17 => m[(code as usize - 11 + 6) % 7] = true,
        _ => return None,
    }
    Some(m)
}

impl Eval<'_> {
    fn day_arg(&self, a: &[Expr], i: usize) -> Result<f64, ErrKind> {
        Ok(self.date_arg(a, i)?.floor())
    }

    fn weekend(&self, a: &[Expr], i: usize) -> Result<[bool; 7], ErrKind> {
        let Some(e) = fx_text::given(a, i) else { return Ok(weekend_codes(1).unwrap_or([false; 7])) };
        match self.scalar(e) {
            Value::Error(k) => Err(k),
            Value::Text(s) if s.chars().count() == 7 && s.chars().all(|c| c == '0' || c == '1') => {
                let mut m = [false; 7];
                for (i, c) in s.chars().enumerate() {
                    m[i] = c == '1';
                }
                if m.iter().all(|x| *x) {
                    return Err(ErrKind::Value);
                }
                Ok(m)
            }
            Value::Text(_) => Err(ErrKind::Value),
            v => weekend_codes(number_of(&v)?.trunc() as i64).ok_or(ErrKind::Num),
        }
    }

    fn holidays(&self, a: &[Expr], i: usize) -> Result<HashSet<i64>, ErrKind> {
        let mut out = HashSet::new();
        let Some(e) = fx_text::given(a, i) else { return Ok(out) };
        for v in self.grid(self.arg(e))?.data {
            match v {
                Value::Error(k) => return Err(k),
                Value::Empty => {}
                Value::Text(s) => {
                    out.insert(numfmt::parse(&s).ok_or(ErrKind::Value)?.0.floor() as i64);
                }
                o => {
                    out.insert(number_of(&o)?.floor() as i64);
                }
            }
        }
        Ok(out)
    }

    fn working(&self, s: i64, mask: &[bool; 7], hol: &HashSet<i64>) -> bool {
        let w = (numfmt::weekday(s as f64) + 5) % 7;
        !mask[w as usize] && !hol.contains(&s)
    }

    pub(super) fn call_date(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        if !NAMES.contains(&name) {
            return None;
        }
        Some((|| {
            Ok(match name {
                "DATEDIF" => {
                    if a.len() != 3 {
                        return Err(ErrKind::Na);
                    }
                    let (s, e) = (self.day_arg(a, 0)?, self.day_arg(a, 1)?);
                    if s > e {
                        return Err(ErrKind::Num);
                    }
                    let (y1, m1, d1) = numfmt::ymd(s).ok_or(ErrKind::Num)?;
                    let (y2, m2, d2) = numfmt::ymd(e).ok_or(ErrKind::Num)?;
                    let unit = self.t(a, 2)?.to_ascii_uppercase();
                    let behind = i64::from(d2 < d1);
                    let r = match unit.as_str() {
                        "Y" => y2 - y1 - i64::from((m2, d2) < (m1, d1)),
                        "M" => (y2 - y1) * 12 + m2 - m1 - behind,
                        "D" => (e - s) as i64,
                        "MD" => {
                            if d2 >= d1 {
                                d2 - d1
                            } else {
                                let (py, pm) = if m2 == 1 { (y2 - 1, 12) } else { (y2, m2 - 1) };
                                month_days(py, pm) - d1 + d2
                            }
                        }
                        "YM" => (m2 - m1 - behind).rem_euclid(12),
                        "YD" => {
                            let ty = if (m2, d2) >= (m1, d1) { y2 } else { y2 - 1 };
                            let anchor = numfmt::serial(ty, m1, d1).ok_or(ErrKind::Num)?;
                            (e - anchor) as i64
                        }
                        _ => return Err(ErrKind::Num),
                    };
                    Value::Number(r as f64)
                }
                "DAYS360" => {
                    if a.len() < 2 || a.len() > 3 {
                        return Err(ErrKind::Na);
                    }
                    let eu = match fx_text::given(a, 2) {
                        Some(e) => bool_of(&self.scalar(e))?,
                        None => false,
                    };
                    Value::Number(days360(self.day_arg(a, 0)?, self.day_arg(a, 1)?, eu).ok_or(ErrKind::Num)?)
                }
                "YEARFRAC" => {
                    if a.len() < 2 || a.len() > 3 {
                        return Err(ErrKind::Na);
                    }
                    let basis = match fx_text::given(a, 2) {
                        Some(_) => self.n(a, 2)?.trunc() as i64,
                        None => 0,
                    };
                    if !(0..=4).contains(&basis) {
                        return Err(ErrKind::Num);
                    }
                    num(yearfrac(self.day_arg(a, 0)?, self.day_arg(a, 1)?, basis).ok_or(ErrKind::Num)?)
                }
                "WEEKNUM" | "ISOWEEKNUM" => {
                    let s = self.day_arg(a, 0)?;
                    let t = if name == "WEEKNUM" && fx_text::given(a, 1).is_some() { self.n(a, 1)?.trunc() as i64 } else { 1 };
                    if name == "ISOWEEKNUM" || t == 21 {
                        return Ok(Value::Number(iso_week(s).ok_or(ErrKind::Num)? as f64));
                    }
                    let start = match t {
                        1 | 17 => 1,
                        2 | 11 => 2,
                        12..=16 => t - 9,
                        _ => return Err(ErrKind::Num),
                    };
                    let (y, _, _, doy) = ordinal(s).ok_or(ErrKind::Num)?;
                    let first = numfmt::weekday(numfmt::serial(y, 1, 1).ok_or(ErrKind::Num)?);
                    let shift = (first - start).rem_euclid(7);
                    Value::Number(((doy - 1 + shift) / 7 + 1) as f64)
                }
                "NETWORKDAYS" | "NETWORKDAYS.INTL" => {
                    let intl = name.ends_with("INTL");
                    if a.len() < 2 || a.len() > if intl { 4 } else { 3 } {
                        return Err(ErrKind::Na);
                    }
                    let (s, e) = (self.day_arg(a, 0)? as i64, self.day_arg(a, 1)? as i64);
                    let mask = if intl { self.weekend(a, 2)? } else { weekend_codes(1).unwrap_or([false; 7]) };
                    let hol = self.holidays(a, if intl { 3 } else { 2 })?;
                    let (lo, hi) = (s.min(e), s.max(e));
                    let n = (lo..=hi).filter(|&d| self.working(d, &mask, &hol)).count() as f64;
                    Value::Number(if e < s { -n } else { n })
                }
                "WORKDAY" | "WORKDAY.INTL" => {
                    let intl = name.ends_with("INTL");
                    if a.len() < 2 || a.len() > if intl { 4 } else { 3 } {
                        return Err(ErrKind::Na);
                    }
                    let mut d = self.day_arg(a, 0)? as i64;
                    let k = self.n(a, 1)?.trunc() as i64;
                    let mask = if intl { self.weekend(a, 2)? } else { weekend_codes(1).unwrap_or([false; 7]) };
                    let hol = self.holidays(a, if intl { 3 } else { 2 })?;
                    let step = k.signum();
                    let mut left = k.abs();
                    while left > 0 {
                        d += step;
                        if d < 0 || d > 2_958_465 {
                            return Err(ErrKind::Num);
                        }
                        if self.working(d, &mask, &hol) {
                            left -= 1;
                        }
                    }
                    Value::Number(d as f64)
                }
                "EPOCHTODATE" => {
                    if a.is_empty() || a.len() > 2 {
                        return Err(ErrKind::Na);
                    }
                    let t = self.n(a, 0)?;
                    let div = match fx_text::given(a, 1) {
                        None => 86_400.0,
                        Some(_) => match self.n(a, 1)?.trunc() as i64 {
                            1 => 86_400.0,
                            2 => 86_400_000.0,
                            3 => 86_400_000_000.0,
                            _ => return Err(ErrKind::Num),
                        },
                    };
                    num(25569.0 + t / div)
                }
                _ => return Err(ErrKind::Name),
            })
        })())
    }
}

pub(super) const NAMES: [&str; 10] = ["DATEDIF", "DAYS360", "YEARFRAC", "WEEKNUM", "ISOWEEKNUM", "NETWORKDAYS", "NETWORKDAYS.INTL", "WORKDAY", "WORKDAY.INTL", "EPOCHTODATE"];
