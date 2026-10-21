use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    EnUs = 0,
    EnGb = 1,
    DeDe = 2,
    FrFr = 3,
    JaJp = 4,
    EsEs = 5,
    ItIt = 6,
    PtBr = 7,
    NlNl = 8,
    SvSe = 9,
    PlPl = 10,
    RuRu = 11,
    ZhCn = 12,
    KoKr = 13,
}

pub const ALL: [Locale; 14] = [
    Locale::EnUs,
    Locale::EnGb,
    Locale::DeDe,
    Locale::FrFr,
    Locale::JaJp,
    Locale::EsEs,
    Locale::ItIt,
    Locale::PtBr,
    Locale::NlNl,
    Locale::SvSe,
    Locale::PlPl,
    Locale::RuRu,
    Locale::ZhCn,
    Locale::KoKr,
];

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
            "es-es" => Locale::EsEs,
            "it-it" => Locale::ItIt,
            "pt-br" => Locale::PtBr,
            "nl-nl" => Locale::NlNl,
            "sv-se" => Locale::SvSe,
            "pl-pl" => Locale::PlPl,
            "ru-ru" => Locale::RuRu,
            "zh-cn" => Locale::ZhCn,
            "ko-kr" => Locale::KoKr,
            _ => return None,
        })
    }

    pub fn tag(self) -> &'static str {
        ["en-US", "en-GB", "de-DE", "fr-FR", "ja-JP", "es-ES", "it-IT", "pt-BR", "nl-NL", "sv-SE", "pl-PL", "ru-RU", "zh-CN", "ko-KR"][self as usize]
    }

    pub fn decimal(self) -> char {
        match self {
            Locale::EnUs | Locale::EnGb | Locale::JaJp | Locale::ZhCn | Locale::KoKr => '.',
            _ => ',',
        }
    }

    pub fn group(self) -> char {
        match self {
            Locale::DeDe | Locale::EsEs | Locale::ItIt | Locale::PtBr | Locale::NlNl => '.',
            Locale::FrFr => '\u{202f}',
            Locale::SvSe | Locale::PlPl | Locale::RuRu => '\u{a0}',
            _ => ',',
        }
    }

    pub fn list(self) -> char {
        if self.decimal() == ',' {
            ';'
        } else {
            ','
        }
    }

    pub fn order(self) -> Order {
        match self {
            Locale::EnUs => Order::Mdy,
            Locale::JaJp | Locale::SvSe | Locale::ZhCn | Locale::KoKr => Order::Ymd,
            _ => Order::Dmy,
        }
    }

    pub fn date_sep(self) -> char {
        match self {
            Locale::DeDe | Locale::PlPl | Locale::RuRu => '.',
            Locale::NlNl | Locale::SvSe | Locale::KoKr => '-',
            _ => '/',
        }
    }

    pub fn currency_after(self) -> bool {
        matches!(self, Locale::DeDe | Locale::FrFr | Locale::EsEs | Locale::ItIt | Locale::SvSe | Locale::PlPl | Locale::RuRu)
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Locale::EnUs => "$",
            Locale::EnGb => "\u{a3}",
            Locale::DeDe | Locale::FrFr | Locale::EsEs | Locale::ItIt | Locale::NlNl => "\u{20ac}",
            Locale::JaJp | Locale::ZhCn => "\u{a5}",
            Locale::PtBr => "R$",
            Locale::SvSe => "kr",
            Locale::PlPl => "z\u{142}",
            Locale::RuRu => "\u{20bd}",
            Locale::KoKr => "\u{20a9}",
        }
    }

    pub fn space_group(self) -> bool {
        matches!(self, Locale::FrFr | Locale::SvSe | Locale::PlPl | Locale::RuRu)
    }
}

pub fn current() -> Locale {
    ALL.get(CURRENT.load(Ordering::Relaxed) as usize).copied().unwrap_or(Locale::EnUs)
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
    let is_group = |c: char| c == l.group() || (l.space_group() && matches!(c, ' ' | '\u{a0}' | '\u{202f}'));
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
