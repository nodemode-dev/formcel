use crate::formula::{Expr, RefKind};
use crate::{chips, Addr, ErrKind, Fmt, Value, Workbook};

#[derive(Clone, Debug, PartialEq)]
pub struct DType {
    pub kind: String,
    pub entity: String,
    pub provider: String,
    pub at: i64,
    pub fields: Vec<(String, Value, char)>,
}

pub(crate) fn field_value(kind: &str, body: &str) -> (Value, char) {
    let tag = kind.chars().next().unwrap_or('t');
    let v = match tag {
        'n' | 'p' | 'i' | 'd' | 'm' => body.parse().map_or(Value::Error(ErrKind::Value), Value::Number),
        'b' => Value::Bool(body == "1"),
        'e' => ErrKind::parse(body).map_or(Value::Error(ErrKind::Value), Value::Error),
        'z' => Value::Empty,
        _ => Value::Text(body.to_string()),
    };
    (v, tag)
}

impl DType {
    pub fn find(&self, name: &str) -> Option<&(String, Value, char)> {
        let n = name.trim();
        self.fields.iter().find(|(k, _, _)| k.eq_ignore_ascii_case(n))
    }

    pub fn field(&self, name: &str) -> Option<&Value> {
        self.find(name).map(|f| &f.1)
    }
}

impl Workbook {
    pub fn dtype_at(&self, sheet: usize, a: Addr) -> Option<DType> {
        let text = self.chips.get(&(sheet, a))?;
        let chip = chips::parse(text).into_iter().find(|c| chips::typed_kind(&c.kind))?;
        self.record_of(&chip.value).map(|r| r.dtype())
    }

    pub(crate) fn field_fmt(&self, sheet: usize, args: &[Expr]) -> Option<Fmt> {
        let (Some(Expr::Ref(s, RefKind::Cell(c))), Some(Expr::Str(name))) = (args.first(), args.get(1)) else { return None };
        let idx = match s {
            None => sheet,
            Some(n) => self.sheet_by_name(n)?,
        };
        let d = self.dtype_at(idx, Addr { row: c.row, col: c.col })?;
        match d.find(name)?.2 {
            'p' => Some(Fmt::Percent(2)),
            'd' => Some(Fmt::Date),
            'm' => Some(Fmt::DateTime { secs: false, ampm: false }),
            _ => None,
        }
    }
}
