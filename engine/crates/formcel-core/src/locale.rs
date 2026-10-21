use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    EnUs = 0,
    EnGb = 1,
    DeDe = 2,
    FrFr = 3,
    JaJp = 4,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Order {
    Mdy,
    Dmy,
    Ymd,
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

impl Locale {
    pub fn parse(tag: &str) -> Option<Locale> {
        Some(match tag.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "en-us" | "" => Locale::EnUs,
            "en-gb" => Locale::EnGb,
            "de-de" => Locale::DeDe,
            "fr-fr" => Locale::FrFr,
            "ja-jp" => Locale::JaJp,
            _ => return None,
        })
    }

    pub fn tag(self) -> &'static str {
        ["en-US", "en-GB", "de-DE", "fr-FR", "ja-JP"][self as usize]
    }

    pub fn decimal(self) -> char {
        match self {
            Locale::DeDe | Locale::FrFr => ',',
            _ => '.',
        }
    }

    pub fn group(self) -> char {
        match self {
            Locale::DeDe => '.',
            Locale::FrFr => '\u{202f}',
            _ => ',',
        }
    }

    pub fn list(self) -> char {
        match self {
            Locale::DeDe | Locale::FrFr => ';',
            _ => ',',
        }
    }

    pub fn order(self) -> Order {
        match self {
            Locale::EnUs => Order::Mdy,
            Locale::JaJp => Order::Ymd,
            _ => Order::Dmy,
        }
    }

    pub fn date_sep(self) -> char {
        if self == Locale::DeDe {
            '.'
        } else {
            '/'
        }
    }

    pub fn currency_after(self) -> bool {
        matches!(self, Locale::DeDe | Locale::FrFr)
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Locale::EnUs => "$",
            Locale::EnGb => "\u{a3}",
            Locale::DeDe | Locale::FrFr => "\u{20ac}",
            Locale::JaJp => "\u{a5}",
        }
    }
}

pub fn current() -> Locale {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Locale::EnGb,
        2 => Locale::DeDe,
        3 => Locale::FrFr,
        4 => Locale::JaJp,
        _ => Locale::EnUs,
    }
}

pub fn set(l: Locale) {
    CURRENT.store(l as u8, Ordering::Relaxed);
}

pub fn is_default() -> bool {
    current() == Locale::EnUs
}

pub fn localize_number(s: &str) -> String {
    let l = current();
    if l == Locale::EnUs {
        return s.to_string();
    }
    s.chars()
        .map(|c| match c {
            '.' => l.decimal(),
            ',' => l.group(),
            o => o,
        })
        .collect()
}

pub fn normalize_input(s: &str) -> Option<String> {
    let l = current();
    if l.decimal() != ',' {
        return None;
    }
    let t = s.trim();
    let (sign, rest) = match t.strip_prefix(['-', '+']) {
        Some(r) => (&t[..1], r),
        None => ("", t),
    };
    let (rest, pct) = rest.strip_suffix('%').map_or((rest, ""), |r| (r.trim_end(), "%"));
    let (int, frac) = rest.split_once(',').map_or((rest, None), |(a, b)| (a, Some(b)));
    let is_group = |c: char| c == l.group() || (l == Locale::FrFr && matches!(c, ' ' | '\u{a0}'));
    let parts: Vec<&str> = int.split(is_group).collect();
    let digits = |x: &str| !x.is_empty() && x.chars().all(|c| c.is_ascii_digit());
    if !parts.iter().all(|x| digits(x)) || (parts.len() > 1 && (parts[0].len() > 3 || parts[1..].iter().any(|x| x.len() != 3))) {
        return None;
    }
    if frac.is_some_and(|f| !digits(f)) {
        return None;
    }
    let mut out = format!("{sign}{}", parts.concat());
    if let Some(f) = frac {
        out.push('.');
        out.push_str(f);
    }
    out.push_str(pct);
    Some(out)
}
