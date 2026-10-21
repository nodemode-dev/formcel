use super::fx_stat::var_of;
use super::*;

type R<T> = Result<T, ErrKind>;

fn db_crit(v: &Value) -> R<Option<Crit>> {
    match v {
        Value::Empty => Ok(None),
        Value::Text(s) if s.is_empty() => Ok(None),
        Value::Text(s) => {
            let op = ["<=", ">=", "<>", "<", ">", "="].iter().any(|p| s.starts_with(p));
            if op || !matches!(Value::parse_input(s), Value::Text(_)) {
                crit_of(v).map(Some)
            } else {
                Ok(Some(Crit { op: Op::Eq, v: Value::Text(format!("{s}*")) }))
            }
        }
        o => crit_of(o).map(Some),
    }
}

impl Eval<'_> {
    pub(super) fn db(&self, name: &str, a: &[Expr]) -> Option<R<Value>> {
        if !matches!(name, "DSUM" | "DAVERAGE" | "DCOUNT" | "DCOUNTA" | "DGET" | "DMAX" | "DMIN" | "DPRODUCT" | "DSTDEV" | "DSTDEVP" | "DVAR" | "DVARP") {
            return None;
        }
        Some((|| {
            self.arity(a, 3, 3)?;
            let (s, d) = self.range(&a[0])?;
            let (cs, c) = self.range(&a[2])?;
            let width = (d.c1 - d.c0 + 1) as usize;
            let head = |sheet: usize, row: u32, col: u32| self.ctx.cell(sheet, Addr { row, col }).to_string().trim().to_lowercase();
            let heads: Vec<String> = (d.c0..=d.c1).map(|col| head(s, d.r0, col)).collect();
            let col = match self.scalar(&a[1]) {
                Value::Error(k) => return Err(k),
                Value::Empty if matches!(name, "DCOUNT" | "DCOUNTA") => None,
                Value::Number(n) => {
                    let k = n.trunc();
                    if k < 1.0 || k as usize > width {
                        return Err(ErrKind::Value);
                    }
                    Some(k as usize - 1)
                }
                Value::Text(t) => {
                    let t = t.trim().to_lowercase();
                    match heads.iter().position(|h| *h == t) {
                        Some(i) => Some(i),
                        None => return Err(ErrKind::Value),
                    }
                }
                _ => return Err(ErrKind::Value),
            };
            let mut conds: Vec<Vec<(usize, Crit)>> = Vec::new();
            for row in c.r0 + 1..=c.r1 {
                let mut one = Vec::new();
                for cc in c.c0..=c.c1 {
                    let h = head(cs, c.r0, cc);
                    let Some(pos) = heads.iter().position(|x| *x == h) else { continue };
                    if h.is_empty() {
                        continue;
                    }
                    if let Some(k) = db_crit(&self.ctx.cell(cs, Addr { row, col: cc }))? {
                        one.push((pos, k));
                    }
                }
                conds.push(one);
            }
            let mut vals: Vec<Value> = Vec::new();
            let mut matched = 0usize;
            for row in d.r0 + 1..=d.r1 {
                let cell = |pos: usize| self.ctx.cell(s, Addr { row, col: d.c0 + pos as u32 });
                if !(conds.is_empty() || conds.iter().any(|one| one.iter().all(|(pos, k)| crit_matches(k, &cell(*pos))))) {
                    continue;
                }
                matched += 1;
                if let Some(p) = col {
                    vals.push(cell(p));
                }
            }
            if name == "DGET" {
                return match matched {
                    0 => Err(ErrKind::Value),
                    1 => Ok(vals.pop().map_or(Value::Empty, |v| if v == Value::Empty { Value::Text(String::new()) } else { v })),
                    _ => Err(ErrKind::Num),
                };
            }
            if name == "DCOUNT" && col.is_none() {
                return Ok(Value::Number(matched as f64));
            }
            if name == "DCOUNTA" {
                return Ok(Value::Number(if col.is_none() { matched } else { vals.iter().filter(|v| **v != Value::Empty).count() } as f64));
            }
            let mut nums = Vec::new();
            for v in &vals {
                match v {
                    Value::Number(n) => nums.push(*n),
                    Value::Error(k) => return Err(*k),
                    _ => {}
                }
            }
            let n = nums.len() as f64;
            Ok(num(match name {
                "DCOUNT" => n,
                "DSUM" => nums.iter().sum(),
                "DAVERAGE" => {
                    if nums.is_empty() {
                        return Err(ErrKind::Div0);
                    }
                    nums.iter().sum::<f64>() / n
                }
                "DMAX" => nums.iter().copied().reduce(f64::max).unwrap_or(0.0),
                "DMIN" => nums.iter().copied().reduce(f64::min).unwrap_or(0.0),
                "DPRODUCT" => {
                    if nums.is_empty() {
                        0.0
                    } else {
                        nums.iter().product()
                    }
                }
                "DSTDEV" => var_of(&nums, false).ok_or(ErrKind::Div0)?.sqrt(),
                "DSTDEVP" => var_of(&nums, true).ok_or(ErrKind::Div0)?.sqrt(),
                "DVAR" => var_of(&nums, false).ok_or(ErrKind::Div0)?,
                _ => var_of(&nums, true).ok_or(ErrKind::Div0)?,
            }))
        })())
    }
}
