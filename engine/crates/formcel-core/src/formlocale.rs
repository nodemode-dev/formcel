use crate::locale;

fn boundary(prev: Option<char>) -> bool {
    !prev.is_some_and(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '$' | '!' | ':'))
}

pub fn convert(text: &str, to_local: bool) -> String {
    let loc = locale::current();
    if loc.list() != ';' || !text.trim_start().starts_with('=') {
        return text.to_string();
    }
    let (dec_from, dec_to) = if to_local { ('.', loc.decimal()) } else { (loc.decimal(), '.') };
    let (list_from, list_to) = if to_local { (',', loc.list()) } else { (loc.list(), ',') };
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                out.push(chars[i]);
                if chars[i] == c {
                    if chars.get(i + 1) == Some(&c) {
                        out.push(c);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        let prev = if i > 0 { Some(chars[i - 1]) } else { None };
        let starts_number = (c.is_ascii_digit() || (c == dec_from && chars.get(i + 1).is_some_and(char::is_ascii_digit))) && boundary(prev);
        if starts_number {
            while i < chars.len() && chars[i].is_ascii_digit() {
                out.push(chars[i]);
                i += 1;
            }
            if i < chars.len() && chars[i] == dec_from && chars.get(i + 1).is_some_and(char::is_ascii_digit) {
                out.push(dec_to);
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    out.push(chars[i]);
                    i += 1;
                }
            }
            if i < chars.len() && matches!(chars[i], 'e' | 'E') {
                let sign = chars.get(i + 1).is_some_and(|s| matches!(s, '+' | '-')) as usize;
                if chars.get(i + 1 + sign).is_some_and(char::is_ascii_digit) {
                    out.extend(&chars[i..i + 1 + sign]);
                    i += 1 + sign;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        out.push(chars[i]);
                        i += 1;
                    }
                }
            }
            continue;
        }
        if c == list_from {
            out.push(list_to);
        } else {
            out.push(c);
        }
        i += 1;
    }
    out
}
