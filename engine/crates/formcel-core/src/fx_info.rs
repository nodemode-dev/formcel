use super::*;
use crate::col_name;

fn even_of(v: &Value) -> Result<bool, ErrKind> {
    match v {
        Value::Error(k) => Err(*k),
        Value::Bool(_) => Err(ErrKind::Value),
        o => Ok(number_of(o)?.trunc().abs() % 2.0 == 0.0),
    }
}

impl Eval<'_> {
    fn cell_info(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.is_empty() || a.len() > 2 {
            return Err(ErrKind::Na);
        }
        let kind = self.t(a, 0)?.to_ascii_lowercase();
        let (sheet, at) = match a.get(1) {
            Some(e) => match self.arg(e) {
                Arg::R(s, ar) => (s, Addr { row: ar.r0, col: ar.c0 }),
                Arg::V(Value::Error(k)) => return Err(k),
                _ => return Err(ErrKind::Value),
            },
            None => (self.sheet, self.at.ok_or(ErrKind::Value)?),
        };
        let v = self.ctx.cell(sheet, at);
        Ok(match kind.as_str() {
            "address" => Value::Text(format!("${}${}", col_name(at.col), at.row + 1)),
            "col" => Value::Number(f64::from(at.col + 1)),
            "row" => Value::Number(f64::from(at.row + 1)),
            "contents" => v,
            "type" => Value::Text(
                match v {
                    Value::Empty => "b",
                    Value::Text(_) => "l",
                    _ => "v",
                }
                .to_string(),
            ),
            "width" => Value::Number(9.0),
            "filename" | "prefix" | "protect" | "format" | "color" | "parentheses" => self.ctx.cell_prop(sheet, at, &kind).ok_or(ErrKind::Value)?,
            _ => return Err(ErrKind::Value),
        })
    }

    fn info(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.len() != 1 {
            return Err(ErrKind::Na);
        }
        Ok(match self.t(a, 0)?.to_ascii_lowercase().as_str() {
            "directory" => self.ctx.cell_prop(0, Addr { row: 0, col: 0 }, "directory").unwrap_or(Value::Text(String::new())),
            "numfile" => Value::Number(self.ctx.sheet_total() as f64),
            "origin" => Value::Text("$A:$A$1".to_string()),
            "osversion" => Value::Text("FormCel".to_string()),
            "recalc" => Value::Text(self.ctx.calc_mode().to_string()),
            "release" => Value::Text("16.0".to_string()),
            "system" => Value::Text("pcdos".to_string()),
            "memavail" | "memused" | "totmem" => return Err(ErrKind::Na),
            _ => return Err(ErrKind::Value),
        })
    }

    pub(super) fn call_info(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        if !matches!(name, "CELL" | "INFO" | "ISEVEN" | "ISODD" | "ISFORMULA" | "TYPE" | "SHEET" | "SHEETS" | "FIELDVALUE" | "_FV") {
            return None;
        }
        Some((|| {
            Ok(match name {
                "FIELDVALUE" | "_FV" => {
                    if a.len() != 2 {
                        return Err(ErrKind::Na);
                    }
                    let field = self.t(a, 1)?;
                    let found = match self.arg(&a[0]) {
                        Arg::R(s, ar) if ar.r0 == ar.r1 && ar.c0 == ar.c1 => self.ctx.dtype_field(s, Addr { row: ar.r0, col: ar.c0 }, &field),
                        Arg::V(Value::Error(k)) => return Err(k),
                        _ => None,
                    };
                    found.ok_or(ErrKind::Value)??
                }
                "CELL" => self.cell_info(a)?,
                "INFO" => self.info(a)?,
                "ISEVEN" | "ISODD" => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    let even = even_of(&self.scalar(&a[0]))?;
                    Value::Bool(even == (name == "ISEVEN"))
                }
                "ISFORMULA" => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    match self.arg(&a[0]) {
                        Arg::R(s, ar) => Value::Bool(self.ctx.formula_at(s, Addr { row: ar.r0, col: ar.c0 }).is_some()),
                        Arg::V(Value::Error(k)) => return Err(k),
                        _ => return Err(ErrKind::Value),
                    }
                }
                "TYPE" => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    let arg = self.arg(&a[0]);
                    if multi(&arg) {
                        return Ok(Value::Number(64.0));
                    }
                    Value::Number(match self.deref(arg) {
                        Value::Number(_) | Value::Empty => 1.0,
                        Value::Text(_) => 2.0,
                        Value::Bool(_) => 4.0,
                        Value::Error(_) => 16.0,
                    })
                }
                "SHEET" => match a.first() {
                    None => Value::Number((self.sheet + 1) as f64),
                    Some(e) => match self.arg(e) {
                        Arg::R(s, _) => Value::Number((s + 1) as f64),
                        Arg::V(Value::Text(t)) => Value::Number((self.ctx.sheet_index(&t).ok_or(ErrKind::Na)? + 1) as f64),
                        Arg::V(Value::Error(k)) => return Err(k),
                        _ => return Err(ErrKind::Na),
                    },
                },
                _ => match a.first() {
                    None => Value::Number(self.ctx.sheet_total() as f64),
                    Some(e) => match self.arg(e) {
                        Arg::R(..) => Value::Number(1.0),
                        Arg::V(Value::Error(k)) => return Err(k),
                        _ => return Err(ErrKind::Value),
                    },
                },
            })
        })())
    }
}
