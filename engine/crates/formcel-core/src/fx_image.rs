use super::*;

pub const IMAGE_MARK: char = '\u{E001}';

const SOURCE_LIMIT: usize = 8_000_000;

impl Eval<'_> {
    pub(crate) fn image(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.is_empty() || a.len() > 5 {
            return Err(ErrKind::Na);
        }
        let given = |i: usize| a.len() > i && !matches!(a[i], Expr::Missing);
        let source = text_of(&self.scalar(&a[0]))?.trim().to_string();
        let lower = source.to_ascii_lowercase();
        if source.is_empty() || source.len() > SOURCE_LIMIT || !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("data:image/")) {
            return Err(ErrKind::Value);
        }
        let alt = if given(1) { text_of(&self.scalar(&a[1]))? } else { String::new() };
        let sizing = if given(2) { self.n(a, 2)? } else { 0.0 };
        if sizing.fract() != 0.0 || !(0.0..=3.0).contains(&sizing) {
            return Err(ErrKind::Value);
        }
        let dim = |i: usize| -> Result<Option<f64>, ErrKind> {
            if !given(i) {
                return Ok(None);
            }
            let v = self.n(a, i)?;
            if v <= 0.0 || v > 10_000.0 {
                return Err(ErrKind::Value);
            }
            Ok(Some(v))
        };
        let height = dim(3)?;
        let width = dim(4)?;
        if sizing == 3.0 && height.is_none() && width.is_none() {
            return Err(ErrKind::Value);
        }
        let opt = |x: Option<f64>| x.map_or(String::new(), |n| format!("{}", n));
        Ok(Value::Text(format!("{}IMG\t{}\t{}\t{}\t{}\t{}", IMAGE_MARK, sizing as u8, opt(height), opt(width), alt.replace(['\t', '\n'], " "), source)))
    }
}
