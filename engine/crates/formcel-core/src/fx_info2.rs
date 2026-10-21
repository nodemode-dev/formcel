use super::*;

fn email_ok(s: &str) -> bool {
    let Some((local, domain)) = s.split_once('@') else { return false };
    if local.is_empty() || local.len() > 64 || domain.contains('@') || local.starts_with('.') || local.ends_with('.') || local.contains("..") {
        return false;
    }
    if !local.chars().all(|c| c.is_alphanumeric() || "!#$%&'*+/=?^_`{|}~.-".contains(c)) {
        return false;
    }
    let labels: Vec<&str> = domain.split('.').collect();
    labels.len() >= 2
        && labels.iter().all(|l| !l.is_empty() && !l.starts_with('-') && !l.ends_with('-') && l.chars().all(|c| c.is_alphanumeric() || c == '-'))
        && labels.last().is_some_and(|t| t.chars().count() >= 2 && t.chars().all(char::is_alphabetic))
}

fn url_ok(s: &str) -> bool {
    if s.is_empty() || s.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let rest = match s.split_once("://") {
        Some((scheme, r)) => {
            if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
                return false;
            }
            r
        }
        None => s,
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let auth = rest[..end].rsplit('@').next().unwrap_or("");
    let (host, port) = match auth.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (auth, None),
    };
    if port.is_some_and(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit())) {
        return false;
    }
    if host == "localhost" {
        return true;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() == 4 && labels.iter().all(|l| l.parse::<u8>().is_ok()) {
        return true;
    }
    labels.len() >= 2
        && labels.iter().all(|l| !l.is_empty() && !l.starts_with('-') && !l.ends_with('-') && l.chars().all(|c| c.is_alphanumeric() || c == '-'))
        && labels.last().is_some_and(|t| t.chars().count() >= 2 && t.chars().all(char::is_alphabetic))
}

impl Eval<'_> {
    pub(super) fn call_info2(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        if !matches!(name, "ISBETWEEN" | "ISDATE" | "ISEMAIL" | "ISURL") {
            return None;
        }
        Some((|| {
            Ok(match name {
                "ISBETWEEN" => {
                    if a.len() < 3 || a.len() > 5 {
                        return Err(ErrKind::Na);
                    }
                    let (v, lo, hi) = (self.scalar(&a[0]), self.scalar(&a[1]), self.scalar(&a[2]));
                    for x in [&v, &lo, &hi] {
                        if let Value::Error(k) = x {
                            return Err(*k);
                        }
                    }
                    let flag = |i: usize| -> Result<bool, ErrKind> {
                        match fx_text::given(a, i) {
                            Some(e) => bool_of(&self.scalar(e)),
                            None => Ok(true),
                        }
                    };
                    let (lo_in, hi_in) = (flag(3)?, flag(4)?);
                    if rank(&v) != rank(&lo) || rank(&v) != rank(&hi) {
                        return Err(ErrKind::Value);
                    }
                    let above = match compare(&v, &lo) {
                        std::cmp::Ordering::Greater => true,
                        std::cmp::Ordering::Equal => lo_in,
                        _ => false,
                    };
                    let below = match compare(&v, &hi) {
                        std::cmp::Ordering::Less => true,
                        std::cmp::Ordering::Equal => hi_in,
                        _ => false,
                    };
                    Value::Bool(above && below)
                }
                "ISDATE" => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    match self.arg(&a[0]) {
                        Arg::R(s, ar) => {
                            let at = Addr { row: ar.r0, col: ar.c0 };
                            match self.ctx.cell(s, at) {
                                Value::Number(_) => Value::Bool(matches!(self.ctx.cell_prop(s, at, "format"), Some(Value::Text(f)) if f.starts_with('D'))),
                                Value::Text(t) => Value::Bool(numfmt::parse(&t).is_some_and(|p| p.1.is_date())),
                                _ => Value::Bool(false),
                            }
                        }
                        other => match self.deref(other) {
                            Value::Text(t) => Value::Bool(numfmt::parse(&t).is_some_and(|p| p.1.is_date())),
                            Value::Error(k) => return Err(k),
                            _ => Value::Bool(false),
                        },
                    }
                }
                _ => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    match self.scalar(&a[0]) {
                        Value::Text(t) => Value::Bool(if name == "ISEMAIL" { email_ok(t.trim()) } else { url_ok(t.trim()) }),
                        Value::Error(k) => return Err(k),
                        _ => Value::Bool(false),
                    }
                }
            })
        })())
    }
}
