use super::*;
use crate::cube::CUBE_FNS;

fn constant(name: &str) -> Option<&'static str> {
    Some(match name.to_ascii_lowercase().as_str() {
        "kpivalue" => "1",
        "kpigoal" => "2",
        "kpistatus" => "3",
        "kpitrend" => "4",
        "kpiweight" => "5",
        "kpicurrenttimemember" => "6",
        "sortnone" => "0",
        "sortascending" => "1",
        "sortdescending" => "2",
        "sortalphaascending" => "3",
        "sortalphadescending" | "sort_alpha_descending" => "4",
        "sortnaturalascending" | "sort_natural_ascending" => "5",
        "sortnaturaldescending" | "sort_natural_descending" => "6",
        _ => return None,
    })
}

fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

impl Eval<'_> {
    fn cube_value_text(&self, v: &Value) -> Result<String, ErrKind> {
        match v {
            Value::Error(k) => Err(*k),
            Value::Empty => Ok(String::new()),
            Value::Number(n) => Ok(format!("{n}")),
            Value::Text(t) => Ok(t.clone()),
            Value::Bool(b) => Ok(if *b { "TRUE" } else { "FALSE" }.to_string()),
        }
    }

    fn cube_cell(&self, sheet: usize, at: Addr, depth: u32) -> Result<String, ErrKind> {
        if let Some(Expr::Call(n, args)) = self.ctx.cell_ast(sheet, at) {
            if CUBE_FNS.contains(&n.as_str()) && depth < 16 {
                return self.cube_normal(&n, &args, depth + 1);
            }
        }
        self.cube_value_text(&self.ctx.cell(sheet, at))
    }

    fn cube_group(&self, parts: Vec<String>, set: bool) -> String {
        if parts.len() == 1 && !set {
            return parts.into_iter().next().unwrap_or_default();
        }
        if set {
            format!("{{{}}}", parts.join(","))
        } else {
            format!("({})", parts.join(","))
        }
    }

    pub(super) fn cube_text(&self, e: &Expr, set: bool, depth: u32) -> Result<String, ErrKind> {
        match e {
            Expr::Missing => Ok(String::new()),
            Expr::Name(n) if constant(n).is_some() && self.ctx.name(n).is_none() => Ok(constant(n).unwrap_or("").to_string()),
            Expr::Paren(inner) => self.cube_text(inner, set, depth),
            Expr::Union(parts) => {
                let items = parts.iter().map(|p| self.cube_text(p, false, depth)).collect::<Result<Vec<_>, _>>()?;
                Ok(self.cube_group(items, set))
            }
            Expr::Call(n, args) if CUBE_FNS.contains(&n.as_str()) && depth < 16 => self.cube_normal(n, args, depth + 1),
            Expr::Ref(..) | Expr::Range(..) | Expr::Name(_) | Expr::Table(..) => match self.arg(e) {
                Arg::R(s, ar) => {
                    let mut items = Vec::new();
                    for r in ar.r0..=ar.r1 {
                        for c in ar.c0..=ar.c1 {
                            items.push(self.cube_cell(s, Addr { row: r, col: c }, depth)?);
                        }
                    }
                    if items.len() == 1 {
                        return Ok(items.remove(0));
                    }
                    Ok(self.cube_group(items, set))
                }
                Arg::V(v) => self.cube_value_text(&v),
                _ => Err(ErrKind::Value),
            },
            o => self.cube_value_text(&self.scalar(o)),
        }
    }

    fn cube_normal(&self, name: &str, a: &[Expr], depth: u32) -> Result<String, ErrKind> {
        let at = |i: usize, set: bool| a.get(i).map_or(Ok(String::new()), |e| self.cube_text(e, set, depth));
        match name {
            "CUBEMEMBER" => at(1, false),
            "CUBESET" => Ok(format!("$SORT({},{},{})", at(1, true)?, at(3, false).map(|s| if s.is_empty() { "0".to_string() } else { s })?, quote(&at(4, false)?))),
            "CUBERANKEDMEMBER" => Ok(format!("$RANK({},{})", at(1, true)?, at(2, false)?)),
            "CUBEKPIMEMBER" => Ok(format!("$KPI({},{})", quote(&at(1, false)?), at(2, false)?)),
            _ => self.cube_value_text(&self.scalar(&Expr::Call(name.to_string(), a.to_vec()))),
        }
    }

    pub(super) fn call_cube(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        if !CUBE_FNS.contains(&name) {
            return None;
        }
        Some((|| {
            let (lo, hi) = match name {
                "CUBEMEMBER" => (2, 3),
                "CUBEVALUE" => (1, usize::MAX),
                "CUBESET" => (2, 5),
                "CUBESETCOUNT" => (1, 1),
                "CUBERANKEDMEMBER" => (3, 4),
                "CUBEMEMBERPROPERTY" => (3, 3),
                _ => (3, 4),
            };
            if a.len() < lo || a.len() > hi {
                return Err(ErrKind::Value);
            }
            if a.iter().any(|e| matches!(e, Expr::Str(s) if s.chars().count() > 255)) {
                return Err(ErrKind::Value);
            }
            let mut args = Vec::with_capacity(a.len());
            for (i, e) in a.iter().enumerate() {
                let set = match name {
                    "CUBESETCOUNT" => true,
                    "CUBESET" | "CUBERANKEDMEMBER" => i == 1,
                    _ => false,
                };
                let text = if i == 0 && name != "CUBESETCOUNT" { self.cube_value_text(&self.scalar(e))? } else { self.cube_text(e, set, 0)? };
                args.push(text);
            }
            self.ctx.cube_call(name, &args).unwrap_or(Err(ErrKind::Name))
        })())
    }
}
