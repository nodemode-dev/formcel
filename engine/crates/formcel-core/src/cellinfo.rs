use crate::numfmt::Fmt;
use crate::style::HAlign;
use crate::{Addr, Value, Workbook};

const UNLOCKED: u8 = 1;

fn norm(code: &str) -> String {
    let mut out = String::new();
    let mut chars = code.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '_' => {
                chars.next();
            }
            '\\' => {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            }
            '"' => {
                for n in chars.by_ref() {
                    if n == '"' {
                        break;
                    }
                    out.push(n);
                }
            }
            c => out.push(c.to_ascii_lowercase()),
        }
    }
    out
}

fn strip_color(s: &str) -> String {
    let mut out = String::new();
    let mut depth = false;
    for c in s.chars() {
        match c {
            '[' => depth = true,
            ']' => depth = false,
            c if !depth => out.push(c),
            _ => {}
        }
    }
    out
}

fn decimals(s: &str) -> usize {
    s.split('.').nth(1).map_or(0, |d| d.chars().take_while(|c| *c == '0' || *c == '#').count())
}

pub fn excel_format(code: &str) -> String {
    let first = code.split(';').next().unwrap_or("");
    let has_color = code.split(';').skip(1).any(|s| s.contains('['));
    let raw = norm(first);
    let s = strip_color(&raw);
    let s = s.trim();
    let paren = s.contains('(');
    let tail = |base: String| format!("{base}{}{}", if has_color { "-" } else { "" }, if paren && !base.starts_with('C') { "()" } else { "" });
    if s.is_empty() || s == "general" || s == "@" {
        return "G".to_string();
    }
    let datey = s.chars().any(|c| matches!(c, 'y' | 'd' | 'h' | 's')) || s.contains("mmm") || (s.contains('m') && s.contains('/')) || s.contains("am/pm");
    if datey {
        let t = s.replace("dd", "d").replace("yyyy", "yy");
        return match t.as_str() {
            "m/d/yy" | "m/d/yy h:mm" | "mm/dd/yy" | "m/d/yy hh:mm" => "D4",
            "d-mmm-yy" | "d-mmmm-yy" => "D1",
            "d-mmm" | "d-mmmm" => "D2",
            "mmm-yy" | "mmmm-yy" => "D3",
            "mm/d" | "m/d" => "D5",
            "h:mm:ss am/pm" | "hh:mm:ss am/pm" => "D6",
            "h:mm am/pm" | "hh:mm am/pm" => "D7",
            "h:mm:ss" | "hh:mm:ss" => "D8",
            "h:mm" | "hh:mm" => "D9",
            _ if t.contains("am/pm") => "D6",
            _ if t.contains(':') && !t.contains('y') => "D8",
            _ => "D4",
        }
        .to_string();
    }
    if s.contains('e') && s.contains('+') || s.contains("e-") {
        return format!("S{}", decimals(s));
    }
    if s.contains('%') {
        return format!("P{}", decimals(s));
    }
    if s.contains('?') && s.contains('/') {
        return "G".to_string();
    }
    let money = s.contains('$') || s.contains('€') || s.contains('£') || s.contains('¥');
    let d = decimals(s);
    if money {
        return format!("C{d}{}", if has_color { "-" } else { "" });
    }
    if s.contains(',') {
        return tail(format!(",{d}"));
    }
    if s.contains('0') || s.contains('#') {
        return tail(format!("F{d}"));
    }
    "G".to_string()
}

impl Workbook {
    pub(crate) fn prop_of(&self, sheet: usize, a: Addr, what: &str) -> Option<Value> {
        let key = (sheet, a);
        let code = self.code_of(&key).map(|c| c.0.clone());
        Some(match what {
            "format" => Value::Text(match (&code, self.fmts.get(&key)) {
                (Some(c), _) => excel_format(c),
                (None, Some(Fmt::Currency(n))) => format!("C{n}"),
                (None, Some(Fmt::Percent(n))) => format!("P{n}"),
                (None, Some(Fmt::Date | Fmt::DateTime { .. })) => "D4".to_string(),
                (None, Some(Fmt::Time { secs, ampm })) => match (secs, ampm) {
                    (true, true) => "D6",
                    (false, true) => "D7",
                    (true, false) => "D8",
                    (false, false) => "D9",
                }
                .to_string(),
                _ => "G".to_string(),
            }),
            "parentheses" => {
                let first = code.as_deref().and_then(|c| c.split(';').next()).unwrap_or("");
                Value::Number(f64::from(u8::from(first.contains('('))))
            }
            "color" => {
                let neg = code.as_deref().map_or(false, |c| c.split(';').skip(1).next().is_some_and(|s| s.contains('[') && !s.contains("[<") && !s.contains("[>") && !s.contains("[=")));
                Value::Number(f64::from(u8::from(neg)))
            }
            "prefix" => {
                let is_text = matches!(self.sheets.get(sheet).and_then(|s| s.cells.get(a)), Some(Value::Text(t)) if !t.is_empty());
                Value::Text(if !is_text {
                    String::new()
                } else {
                    match self.effective_style(sheet, a).h {
                        Some(HAlign::Right) => "\"",
                        Some(HAlign::Center) => "^",
                        _ => "'",
                    }
                    .to_string()
                })
            }
            "protect" => Value::Number(f64::from(u8::from(self.cell_flags(sheet, a.row, a.col) & UNLOCKED == 0))),
            "filename" => Value::Text(if self.file.is_empty() {
                String::new()
            } else {
                format!("{}{}", self.file, self.sheets.get(sheet).map_or(String::new(), |s| s.name.clone()))
            }),
            "directory" => Value::Text(self.file_folder()),
            _ => return None,
        })
    }

    pub fn set_file_name(&mut self, folder: &str, name: &str) {
        self.file = if name.is_empty() { String::new() } else { format!("{folder}[{name}]") };
    }

    pub fn file_folder(&self) -> String {
        self.file.split('[').next().unwrap_or("").to_string()
    }
}
