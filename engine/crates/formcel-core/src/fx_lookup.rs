use super::*;
use crate::{col_name, MAX_COLS, MAX_ROWS};

fn quote_sheet(name: &str) -> String {
    let plain = !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') && !name.chars().next().is_some_and(|c| c.is_ascii_digit());
    if plain {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

impl Eval<'_> {
    fn lookup_flat(&self, t: &Src, i: u32) -> Value {
        let (h, w) = t.dims();
        if h == 1 {
            self.at(t, 0, i)
        } else if w == 1 {
            self.at(t, i, 0)
        } else {
            Value::Empty
        }
    }

    fn lookup_vec(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.len() < 2 || a.len() > 3 {
            return Err(ErrKind::Na);
        }
        let key = self.scalar(&a[0]);
        if let Value::Error(k) = key {
            return Err(k);
        }
        let t = self.table(&a[1])?;
        let (h, w) = t.dims();
        if a.len() == 3 {
            let r = self.table(&a[2])?;
            if h != 1 && w != 1 {
                return Err(ErrKind::Na);
            }
            let pos = self.find(&key, self.line(&t, w == 1, 0), 1, false)?.ok_or(ErrKind::Na)?;
            let (rh, rw) = r.dims();
            if pos >= rh * rw {
                return Err(ErrKind::Ref);
            }
            if rh != 1 && rw != 1 {
                return Err(ErrKind::Ref);
            }
            return Ok(self.lookup_flat(&r, pos));
        }
        let wide = w > h;
        let pos = self.find(&key, self.line(&t, !wide, 0), 1, false)?.ok_or(ErrKind::Na)?;
        Ok(if wide { self.at(&t, h - 1, pos) } else { self.at(&t, pos, w - 1) })
    }

    fn address(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.len() < 2 || a.len() > 5 {
            return Err(ErrKind::Na);
        }
        let (r, c) = (self.n(a, 0)?.trunc(), self.n(a, 1)?.trunc());
        if r < 1.0 || c < 1.0 || r > f64::from(MAX_ROWS) || c > f64::from(MAX_COLS) {
            return Err(ErrKind::Value);
        }
        let abs = match fx_text::given(a, 2) {
            Some(_) => self.n(a, 2)?.trunc() as i64,
            None => 1,
        };
        if !(1..=4).contains(&abs) {
            return Err(ErrKind::Value);
        }
        let a1 = match fx_text::given(a, 3) {
            Some(e) => bool_of(&self.scalar(e))?,
            None => true,
        };
        let (row_abs, col_abs) = (abs == 1 || abs == 2, abs == 1 || abs == 3);
        let mut out = String::new();
        if a1 {
            if col_abs {
                out.push('$');
            }
            out.push_str(&col_name(c as u32 - 1));
            if row_abs {
                out.push('$');
            }
            out.push_str(&(r as u32).to_string());
        } else {
            out.push_str(&if row_abs { format!("R{}", r as u32) } else { format!("R[{}]", r as u32) });
            out.push_str(&if col_abs { format!("C{}", c as u32) } else { format!("C[{}]", c as u32) });
        }
        if let Some(e) = fx_text::given(a, 4) {
            let s = text_of(&self.scalar(e))?;
            if !s.is_empty() {
                out = format!("{}!{}", quote_sheet(&s), out);
            }
        }
        Ok(Value::Text(out))
    }

    pub(super) fn call_lookup(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        if !matches!(name, "LOOKUP" | "ADDRESS" | "ROWS" | "COLUMNS" | "AREAS" | "FORMULATEXT") {
            return None;
        }
        Some((|| {
            Ok(match name {
                "LOOKUP" => self.lookup_vec(a)?,
                "ADDRESS" => self.address(a)?,
                "ROWS" | "COLUMNS" => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    let (h, w) = self.table(&a[0])?.dims();
                    Value::Number(f64::from(if name == "ROWS" { h } else { w }))
                }
                "AREAS" => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    let mut head = &a[0];
                    while let Expr::Paren(x) = head {
                        head = x;
                    }
                    match head {
                        Expr::Union(items) => Value::Number(items.len() as f64),
                        e => match self.arg(e) {
                            Arg::R(..) => Value::Number(1.0),
                            Arg::V(Value::Error(k)) => return Err(k),
                            _ => return Err(ErrKind::Value),
                        },
                    }
                }
                _ => {
                    if a.len() != 1 {
                        return Err(ErrKind::Na);
                    }
                    match self.arg(&a[0]) {
                        Arg::R(s, ar) => Value::Text(self.ctx.formula_at(s, Addr { row: ar.r0, col: ar.c0 }).ok_or(ErrKind::Na)?),
                        Arg::V(Value::Error(k)) => return Err(k),
                        _ => return Err(ErrKind::Na),
                    }
                }
            })
        })())
    }

    fn origin(&self, a: &[Expr]) -> Result<Arg, ErrKind> {
        match a.first() {
            Some(e) => self.arg(e).pipe_ref(),
            None => {
                let at = self.at.ok_or(ErrKind::Value)?;
                Ok(Arg::R(self.sheet, Area { r0: at.row, c0: at.col, r1: at.row, c1: at.col }))
            }
        }
    }

    pub(super) fn call_ref(&self, name: &str, a: &[Expr]) -> Option<Result<Arg, ErrKind>> {
        Some(match name {
            "ROW" | "COLUMN" => (|| {
                if a.len() > 1 {
                    return Err(ErrKind::Na);
                }
                let Arg::R(_, ar) = self.origin(a)? else { return Err(ErrKind::Value) };
                let rows = name == "ROW";
                let (lo, hi) = if rows { (ar.r0, ar.r1) } else { (ar.c0, ar.c1) };
                let data: Vec<Value> = (lo..=hi).map(|k| Value::Number(f64::from(k + 1))).collect();
                if data.len() == 1 {
                    return Ok(Arg::V(data[0].clone()));
                }
                Ok(Arg::A(if rows { Array { rows: data.len(), cols: 1, data } } else { Array { rows: 1, cols: data.len(), data } }))
            })(),
            "OFFSET" => (|| {
                if a.len() < 3 || a.len() > 5 {
                    return Err(ErrKind::Na);
                }
                let Arg::R(s, ar) = self.arg(&a[0]).pipe_ref()? else { return Err(ErrKind::Value) };
                let (dr, dc) = (self.n(a, 1)?.trunc(), self.n(a, 2)?.trunc());
                let h = match fx_text::given(a, 3) {
                    Some(_) => self.n(a, 3)?.trunc(),
                    None => f64::from(ar.r1 - ar.r0 + 1),
                };
                let w = match fx_text::given(a, 4) {
                    Some(_) => self.n(a, 4)?.trunc(),
                    None => f64::from(ar.c1 - ar.c0 + 1),
                };
                if h < 1.0 || w < 1.0 {
                    return Err(ErrKind::Ref);
                }
                let (r0, c0) = (f64::from(ar.r0) + dr, f64::from(ar.c0) + dc);
                let (r1, c1) = (r0 + h - 1.0, c0 + w - 1.0);
                if r0 < 0.0 || c0 < 0.0 || r1 >= f64::from(MAX_ROWS) || c1 >= f64::from(MAX_COLS) {
                    return Err(ErrKind::Ref);
                }
                Ok(Arg::R(s, Area { r0: r0 as u32, c0: c0 as u32, r1: r1 as u32, c1: c1 as u32 }))
            })(),
            "INDIRECT" => (|| {
                if a.is_empty() || a.len() > 2 {
                    return Err(ErrKind::Na);
                }
                let text = self.t(a, 0)?;
                let a1 = match fx_text::given(a, 1) {
                    Some(e) => bool_of(&self.scalar(e))?,
                    None => true,
                };
                if !a1 {
                    return Err(ErrKind::Ref);
                }
                let e = crate::formula::parse(text.trim()).ok_or(ErrKind::Ref)?;
                match e {
                    Expr::Ref(..) | Expr::Range(..) | Expr::Name(_) | Expr::Table(..) => self.arg(&e).pipe_ref(),
                    _ => Err(ErrKind::Ref),
                }
            })(),
            _ => return None,
        })
    }

    pub(super) fn sortn(&self, a: &[Expr]) -> Result<Arg, ErrKind> {
        if a.is_empty() {
            return Err(ErrKind::Na);
        }
        let g = self.grid(self.arg(&a[0]))?;
        let n = match fx_text::given(a, 1) {
            Some(_) => self.n(a, 1)?.trunc(),
            None => 1.0,
        };
        if n < 1.0 {
            return Err(ErrKind::Value);
        }
        let mode = match fx_text::given(a, 2) {
            Some(_) => self.n(a, 2)?.trunc() as i64,
            None => 0,
        };
        if !(0..=3).contains(&mode) {
            return Err(ErrKind::Value);
        }
        let mut keys: Vec<(Vec<Value>, bool)> = Vec::new();
        let mut i = 3;
        while i < a.len() {
            let col = self.grid(self.arg(&a[i]))?;
            let asc = match a.get(i + 1) {
                Some(e) => bool_of(&self.scalar(e))?,
                None => true,
            };
            let vals = if col.rows == 1 && col.cols == 1 {
                let k = number_of(&col.data[0])?.trunc();
                if k < 1.0 || k as usize > g.cols {
                    return Err(ErrKind::Value);
                }
                (0..g.rows).map(|r| g.get(r, k as usize - 1).clone()).collect()
            } else if col.cols == 1 && col.rows == g.rows {
                col.data
            } else {
                return Err(ErrKind::Value);
            };
            keys.push((vals, !asc));
            i += 2;
        }
        if keys.is_empty() {
            keys.push(((0..g.rows).map(|r| g.get(r, 0).clone()).collect(), false));
        }
        let mut idx: Vec<usize> = (0..g.rows).collect();
        idx.sort_by(|&x, &y| {
            for (k, desc) in &keys {
                let o = sort_key(&k[x], &k[y]);
                let o = if *desc { o.reverse() } else { o };
                if o != std::cmp::Ordering::Equal {
                    return o;
                }
            }
            std::cmp::Ordering::Equal
        });
        let row_eq = |x: usize, y: usize| (0..g.cols).all(|c| same(g.get(x, c), g.get(y, c)) || (*g.get(x, c) == Value::Empty && *g.get(y, c) == Value::Empty));
        let n = n as usize;
        let mut keep: Vec<usize> = Vec::new();
        let mut uniques: Vec<usize> = Vec::new();
        for &r in &idx {
            let dup = uniques.iter().any(|&u| row_eq(u, r));
            match mode {
                0 => {
                    if keep.len() < n {
                        keep.push(r);
                    }
                }
                1 => {
                    let tie = keep.len() >= n && keep.last().is_some_and(|&l| keys.iter().all(|(k, _)| sort_key(&k[l], &k[r]) == std::cmp::Ordering::Equal)) && row_eq(*keep.last().unwrap_or(&r), r);
                    if keep.len() < n || tie {
                        keep.push(r);
                    }
                }
                2 => {
                    if !dup && uniques.len() < n {
                        uniques.push(r);
                        keep.push(r);
                    }
                }
                _ => {
                    if dup || uniques.len() < n {
                        if !dup {
                            uniques.push(r);
                        }
                        keep.push(r);
                    }
                }
            }
        }
        if keep.is_empty() {
            return Err(ErrKind::Calc);
        }
        Ok(Arg::A(pick_rows(&g, &keep)))
    }

    pub(super) fn split_text(&self, a: &[Expr]) -> Result<Arg, ErrKind> {
        if a.len() < 2 || a.len() > 4 {
            return Err(ErrKind::Na);
        }
        let text = self.t(a, 0)?;
        let delim = self.t(a, 1)?;
        let each = match fx_text::given(a, 2) {
            Some(e) => bool_of(&self.scalar(e))?,
            None => true,
        };
        let drop = match fx_text::given(a, 3) {
            Some(e) => bool_of(&self.scalar(e))?,
            None => true,
        };
        let ds: Vec<String> = if each { delim.chars().map(String::from).collect() } else { vec![delim] };
        let ds: Vec<String> = ds.into_iter().filter(|d| !d.is_empty()).collect();
        if ds.is_empty() {
            return Ok(Arg::A(Array { rows: 1, cols: 1, data: vec![Value::Text(text)] }));
        }
        let parts: Vec<String> = split_on(&text, &ds, false).into_iter().filter(|p| !(drop && p.is_empty())).collect();
        if parts.is_empty() {
            return Err(ErrKind::Value);
        }
        let data: Vec<Value> = parts.into_iter().map(|p| match Value::parse_input(&p) {
            Value::Number(n) => Value::Number(n),
            _ => Value::Text(p),
        }).collect();
        Ok(Arg::A(Array { rows: 1, cols: data.len(), data }))
    }
}

trait PipeRef {
    fn pipe_ref(self) -> Result<Arg, ErrKind>;
}

impl PipeRef for Arg {
    fn pipe_ref(self) -> Result<Arg, ErrKind> {
        match self {
            Arg::R(..) => Ok(self),
            Arg::V(Value::Error(k)) => Err(k),
            _ => Err(ErrKind::Value),
        }
    }
}
