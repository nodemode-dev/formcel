use crate::formula::{Expr, RefKind};
use crate::wire::unescape;
use crate::{chips, Addr, ErrKind, Fmt, Value, Workbook};

#[derive(Clone, Debug, PartialEq)]
pub struct DType {
    pub kind: String,
    pub entity: String,
    pub provider: String,
    pub at: i64,
    pub fields: Vec<(String, Value, char)>,
}

fn field_value(kind: &str, body: &str) -> (Value, char) {
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

pub fn parse(kind: &str, payload: &str) -> Option<DType> {
    let mut lines = payload.split('\n');
    let head: Vec<String> = lines.next()?.split('\t').map(unescape).collect();
    if head.len() < 4 || head[0] != "v1" {
        return None;
    }
    let mut fields = Vec::new();
    for l in lines.filter(|l| !l.is_empty()) {
        let p: Vec<String> = l.split('\t').map(unescape).collect();
        if p.len() < 3 {
            continue;
        }
        let (v, tag) = field_value(&p[1], &p[2]);
        fields.push((p[0].clone(), v, tag));
    }
    Some(DType { kind: kind.to_string(), entity: head[1].clone(), provider: head[2].clone(), at: head[3].parse().unwrap_or(0), fields })
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
        chips::parse(text).into_iter().find(|c| chips::typed_kind(&c.kind)).and_then(|c| parse(&c.kind, &c.value))
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
