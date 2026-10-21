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
pub struct Border {
    pub line: Line,
    pub color: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub size: Option<u8>,
    pub font: Option<String>,
    pub color: Option<u32>,
    pub fill: Option<u32>,
    pub h: Option<HAlign>,
    pub v: Option<VAlign>,
    pub wrap: bool,
    pub indent: u8,
    pub borders: [Option<Border>; 4],
}

pub const EDGES: [&str; 4] = ["bt", "br", "bb", "bl"];
pub const MAX_INDENT: u8 = 15;

fn hex(s: &str) -> Option<u32> {
    let s = s.trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    u32::from_str_radix(s, 16).ok()
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

    pub fn apply(&mut self, patch: &str) -> Option<()> {
        for tok in patch.split(';').map(str::trim).filter(|t| !t.is_empty()) {
            let (key, val) = tok.split_once(':').map_or((tok, None), |(k, v)| (k, Some(v)));
            let (key, off) = key.strip_prefix('!').map_or((key, false), |k| (k, true));
            let clear = off || val == Some("");
            match key {
                "clear" => *self = Style::default(),
                "b" => self.bold = !off,
                "i" => self.italic = !off,
                "u" => self.underline = !off,
                "s" => self.strike = !off,
                "wrap" => self.wrap = !off,
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
        for (on, k) in [(self.bold, "b"), (self.italic, "i"), (self.underline, "u"), (self.strike, "s")] {
            if on {
                out.push(k.into());
            }
        }
        if let Some(n) = self.size {
            out.push(format!("sz:{n}"));
        }
        if let Some(f) = &self.font {
            out.push(format!("ff:{f}"));
        }
        if let Some(c) = self.color {
            out.push(format!("fc:{c:06x}"));
        }
        if let Some(c) = self.fill {
            out.push(format!("bg:{c:06x}"));
        }
        if let Some(h) = self.h {
            out.push(format!("ha:{}", match h { HAlign::Left => "left", HAlign::Center => "center", HAlign::Right => "right" }));
        }
        if let Some(v) = self.v {
            out.push(format!("va:{}", match v { VAlign::Top => "top", VAlign::Middle => "middle", VAlign::Bottom => "bottom" }));
        }
        if self.wrap {
            out.push("wrap".into());
        }
        if self.indent > 0 {
            out.push(format!("in:{}", self.indent));
        }
        for (i, b) in self.borders.iter().enumerate() {
            if let Some(b) = b {
                out.push(format!("{}:{}:{:06x}", EDGES[i], line_name(b.line), b.color));
            }
        }
        out.join(";")
    }
}
