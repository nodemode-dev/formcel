#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HAlign {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VAlign {
    Top,
    Middle,
    Bottom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Line {
    Thin,
    Medium,
    Thick,
    Dashed,
    Dotted,
    Double,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Paint {
    Rgb(u32),
    Theme(u8, i8),
}

pub const SLOTS: [&str; 10] = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

impl Paint {
    pub fn text(self) -> String {
        match self {
            Paint::Rgb(c) => format!("{c:06x}"),
            Paint::Theme(s, 0) => format!("t:{}", SLOTS[s as usize]),
            Paint::Theme(s, t) => format!("t:{}:{t}", SLOTS[s as usize]),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Border {
    pub line: Line,
    pub color: Paint,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Cats {
    pub number: bool,
    pub alignment: bool,
    pub font: bool,
    pub border: bool,
    pub fill: bool,
}

impl Cats {
    pub const ALL: Cats = Cats { number: true, alignment: true, font: true, border: true, fill: true };

    pub fn parse(s: &str) -> Cats {
        Cats { number: s.contains('n'), alignment: s.contains('a'), font: s.contains('f'), border: s.contains('b'), fill: s.contains('p') }
    }

    pub fn text(self) -> String {
        [(self.number, 'n'), (self.alignment, 'a'), (self.font, 'f'), (self.border, 'b'), (self.fill, 'p')].iter().filter(|(on, _)| *on).map(|(_, c)| *c).collect()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strike: Option<bool>,
    pub size: Option<u8>,
    pub font: Option<String>,
    pub color: Option<Paint>,
    pub fill: Option<Paint>,
    pub h: Option<HAlign>,
    pub v: Option<VAlign>,
    pub wrap: Option<bool>,
    pub indent: u8,
    pub rot: i8,
    pub vertical: bool,
    pub borders: [Option<Border>; 4],
    pub named: Option<String>,
}

pub const EDGES: [&str; 4] = ["bt", "br", "bb", "bl"];
pub const MAX_INDENT: u8 = 15;

fn hex(s: &str) -> Option<Paint> {
    if let Some(t) = s.strip_prefix("t:") {
        let (slot, tint) = t.split_once(':').unwrap_or((t, "0"));
        let i = SLOTS.iter().position(|x| *x == slot)?;
        let tint = tint.parse::<i8>().ok().filter(|n| (-90..=90).contains(n))?;
        return Some(Paint::Theme(i as u8, tint));
    }
    let s = s.trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    u32::from_str_radix(s, 16).ok().map(Paint::Rgb)
}

pub fn clean_name(s: &str) -> String {
    s.chars().filter(|c| !matches!(c, ';' | ':' | '\t' | '\n' | '\r')).take(64).collect::<String>().trim().to_string()
}

fn line_of(s: &str) -> Option<Line> {
    Some(match s {
        "thin" => Line::Thin,
        "medium" => Line::Medium,
        "thick" => Line::Thick,
        "dashed" => Line::Dashed,
        "dotted" => Line::Dotted,
        "double" => Line::Double,
        _ => return None,
    })
}

fn line_name(l: Line) -> &'static str {
    match l {
        Line::Thin => "thin",
        Line::Medium => "medium",
        Line::Thick => "thick",
        Line::Dashed => "dashed",
        Line::Dotted => "dotted",
        Line::Double => "double",
    }
}

impl Style {
    pub fn is_plain(&self) -> bool {
        *self == Style::default()
    }

    pub fn normalize(&mut self) {
        if self.named.is_none() {
            for f in [&mut self.bold, &mut self.italic, &mut self.underline, &mut self.strike, &mut self.wrap] {
                if *f == Some(false) {
                    *f = None;
                }
            }
        }
    }

    pub fn clear(&mut self, c: Cats) {
        if c.font {
            (self.bold, self.italic, self.underline, self.strike, self.size, self.font, self.color) = (None, None, None, None, None, None, None);
        }
        if c.alignment {
            (self.h, self.v, self.wrap, self.indent, self.rot, self.vertical) = (None, None, None, 0, 0, false);
        }
        if c.border {
            self.borders = [None; 4];
        }
        if c.fill {
            self.fill = None;
        }
    }

    pub fn overlay(&self, top: &Style) -> Style {
        let mut out = self.clone();
        let pick = |a: Option<bool>, b: Option<bool>| b.or(a);
        out.bold = pick(self.bold, top.bold);
        out.italic = pick(self.italic, top.italic);
        out.underline = pick(self.underline, top.underline);
        out.strike = pick(self.strike, top.strike);
        out.wrap = pick(self.wrap, top.wrap);
        out.size = top.size.or(self.size);
        out.font = top.font.clone().or_else(|| self.font.clone());
        out.color = top.color.or(self.color);
        out.fill = top.fill.or(self.fill);
        out.h = top.h.or(self.h);
        out.v = top.v.or(self.v);
        if top.indent > 0 {
            out.indent = top.indent;
        }
        if top.rot != 0 || top.vertical {
            (out.rot, out.vertical) = (top.rot, top.vertical);
        }
        for i in 0..4 {
            if top.borders[i].is_some() {
                out.borders[i] = top.borders[i];
            }
        }
        out.named = None;
        out
    }

    pub fn apply(&mut self, patch: &str) -> Option<()> {
        for tok in patch.split(';').map(str::trim).filter(|t| !t.is_empty()) {
            let (key, val) = tok.split_once(':').map_or((tok, None), |(k, v)| (k, Some(v)));
            let (key, off) = key.strip_prefix('!').map_or((key, false), |k| (k, true));
            let clear = off || val == Some("");
            match key {
                "clear" => *self = Style::default(),
                "b" => self.bold = Some(!off),
                "i" => self.italic = Some(!off),
                "u" => self.underline = Some(!off),
                "s" => self.strike = Some(!off),
                "wrap" => self.wrap = Some(!off),
                "cs" => self.named = if clear { None } else { Some(clean_name(val?)).filter(|n| !n.is_empty()) },
                "sz" => self.size = if clear { None } else { Some(val?.parse::<u8>().ok().filter(|n| (1..=96).contains(n))?) },
                "ff" => self.font = if clear { None } else { Some(val?.chars().filter(|c| !matches!(c, ';' | ':' | '\t' | '\n')).take(64).collect()) },
                "fc" => self.color = if clear { None } else { Some(hex(val?)?) },
                "bg" => self.fill = if clear { None } else { Some(hex(val?)?) },
                "ha" => {
                    self.h = if clear {
                        None
                    } else {
                        Some(match val? {
                            "left" => HAlign::Left,
                            "center" => HAlign::Center,
                            "right" => HAlign::Right,
                            _ => return None,
                        })
                    }
                }
                "va" => {
                    self.v = if clear {
                        None
                    } else {
                        Some(match val? {
                            "top" => VAlign::Top,
                            "middle" => VAlign::Middle,
                            "bottom" => VAlign::Bottom,
                            _ => return None,
                        })
                    }
                }
                "in" => {
                    let v = val.unwrap_or("0");
                    self.indent = match v.strip_prefix('+') {
                        Some(d) => self.indent.saturating_add(d.parse().ok()?).min(MAX_INDENT),
                        None => match v.strip_prefix('-') {
                            Some(d) => self.indent.saturating_sub(d.parse().ok()?),
                            None => v.parse::<u8>().ok()?.min(MAX_INDENT),
                        },
                    }
                }
                "rot" => {
                    (self.rot, self.vertical) = match val {
                        None | Some("") | Some("0") => (0, false),
                        Some("v") => (0, true),
                        Some(v) => (v.parse::<i8>().ok().filter(|d| (-90..=90).contains(d))?, false),
                    }
                }
                "bt" | "br" | "bb" | "bl" => {
                    let i = EDGES.iter().position(|e| *e == key)?;
                    self.borders[i] = if clear {
                        None
                    } else {
                        let v = val?;
                        let (l, c) = v.split_once(':').unwrap_or((v, "000000"));
                        Some(Border { line: line_of(l)?, color: hex(c)? })
                    };
                }
                _ => return None,
            }
        }
        Some(())
    }

    pub fn parse(s: &str) -> Option<Style> {
        let mut st = Style::default();
        st.apply(s)?;
        Some(st)
    }

    pub fn text(&self) -> String {
        let mut out: Vec<String> = Vec::new();
        if let Some(n) = &self.named {
            out.push(format!("cs:{n}"));
        }
        for (on, k) in [(self.bold, "b"), (self.italic, "i"), (self.underline, "u"), (self.strike, "s")] {
            match on {
                Some(true) => out.push(k.into()),
                Some(false) => out.push(format!("!{k}")),
                None => {}
            }
        }
        if let Some(n) = self.size {
            out.push(format!("sz:{n}"));
        }
        if let Some(f) = &self.font {
            out.push(format!("ff:{f}"));
        }
        if let Some(c) = self.color {
            out.push(format!("fc:{}", c.text()));
        }
        if let Some(c) = self.fill {
            out.push(format!("bg:{}", c.text()));
        }
        if let Some(h) = self.h {
            out.push(format!("ha:{}", match h { HAlign::Left => "left", HAlign::Center => "center", HAlign::Right => "right" }));
        }
        if let Some(v) = self.v {
            out.push(format!("va:{}", match v { VAlign::Top => "top", VAlign::Middle => "middle", VAlign::Bottom => "bottom" }));
        }
        match self.wrap {
            Some(true) => out.push("wrap".into()),
            Some(false) => out.push("!wrap".into()),
            None => {}
        }
        if self.indent > 0 {
            out.push(format!("in:{}", self.indent));
        }
        if self.vertical {
            out.push("rot:v".into());
        } else if self.rot != 0 {
            out.push(format!("rot:{}", self.rot));
        }
        for (i, b) in self.borders.iter().enumerate() {
            if let Some(b) = b {
                out.push(format!("{}:{}:{}", EDGES[i], line_name(b.line), b.color.text()));
            }
        }
        out.join(";")
    }
}
