use super::*;
use fancy_regex::RegexBuilder;
use std::cmp::Ordering::{Greater, Less};

impl Eval<'_> {
    pub(super) fn find_x(&self, key: &Value, cells: Vec<(u32, Value)>, mode: i64, search: i64) -> Result<Option<u32>, ErrKind> {
        if !matches!(mode, -1 | 0 | 1 | 2 | 3) || !matches!(search, -2 | -1 | 1 | 2) {
            return Err(ErrKind::Value);
        }
        if mode == 3 {
            let Value::Text(p) = key else { return Err(ErrKind::Value) };
            let re = RegexBuilder::new(&format!("(?i){p}")).backtrack_limit(1_000_000).build().map_err(|_| ErrKind::Value)?;
            let mut it: Box<dyn Iterator<Item = &(u32, Value)>> = if search < 0 { Box::new(cells.iter().rev()) } else { Box::new(cells.iter()) };
            return Ok(it.find(|(_, v)| matches!(v, Value::Text(t) if re.is_match(t).unwrap_or(false))).map(|c| c.0));
        }
        if search.abs() == 1 || mode == 2 {
            let m = match mode {
                -1 => 10,
                1 => 11,
                m => m as i32,
            };
            return self.find(key, cells, m, search < 0);
        }
        let desc = search == -2;
        let ord = |v: &Value| {
            let o = compare(v, key);
            if desc {
                o.reverse()
            } else {
                o
            }
        };
        let lower = cells.partition_point(|(_, v)| ord(v) == Less);
        let upper = cells.partition_point(|(_, v)| ord(v) != Greater);
        if lower < upper {
            return Ok(Some(cells[lower].0));
        }
        let (before, after) = (lower.checked_sub(1), (upper < cells.len()).then_some(upper));
        let pick = match (mode, desc) {
            (0, _) => None,
            (-1, false) | (1, true) => before,
            _ => after,
        };
        Ok(pick.map(|i| cells[i].0))
    }

    fn xlookup_one(&self, a: &[Expr], key: &Value) -> Result<Array, ErrKind> {
        let (look, ret) = (self.table(&a[1])?, self.table(&a[2])?);
        let ((lh, lw), (rh, rw)) = (look.dims(), ret.dims());
        if lh != 1 && lw != 1 {
            return Err(ErrKind::Value);
        }
        let vertical = lw == 1;
        if (vertical && lh != rh) || (!vertical && lw != rw) {
            return Err(ErrKind::Value);
        }
        let opt = |i: usize, d: f64| -> Result<f64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { self.n(a, i) } else { Ok(d) } };
        let mode = opt(4, 0.0)?.trunc() as i64;
        let search = opt(5, 1.0)?.trunc() as i64;
        match self.find_x(key, self.line(&look, vertical, 0), mode, search)? {
            Some(p) => {
                let data: Vec<Value> = if vertical { (0..rw).map(|c| self.at(&ret, p, c)).collect() } else { (0..rh).map(|r| self.at(&ret, r, p)).collect() };
                Ok(if vertical { Array { rows: 1, cols: data.len(), data } } else { Array { rows: data.len(), cols: 1, data } })
            }
            None if a.len() > 3 && !matches!(a[3], Expr::Missing) => self.grid(self.arg(&a[3])),
            None => Err(ErrKind::Na),
        }
    }

    pub(super) fn xlookup(&self, a: &[Expr]) -> Result<Arg, ErrKind> {
        if a.len() < 3 || a.len() > 6 {
            return Err(ErrKind::Na);
        }
        let k = self.arg(&a[0]);
        let single = |g: Array| if g.data.len() == 1 { Arg::V(g.data[0].clone()) } else { Arg::A(g) };
        if !multi(&k) {
            let key = self.deref(k);
            if let Value::Error(e) = key {
                return Err(e);
            }
            return self.xlookup_one(a, &key).map(single);
        }
        let keys = self.grid(k)?;
        if keys.rows != 1 && keys.cols != 1 {
            return Err(ErrKind::Value);
        }
        let parts: Vec<Array> = keys.data.iter().map(|key| self.xlookup_one(a, key)).collect::<Result<_, _>>()?;
        let down = keys.cols == 1;
        let (h, w) = (parts[0].rows, parts[0].cols);
        if parts.iter().any(|p| if down { p.cols != w } else { p.rows != h }) {
            return Err(ErrKind::Value);
        }
        if down {
            let data: Vec<Value> = parts.iter().flat_map(|p| p.data.clone()).collect();
            Ok(single(Array { rows: parts.iter().map(|p| p.rows).sum(), cols: w, data }))
        } else {
            let cols: usize = parts.iter().map(|p| p.cols).sum();
            let mut data = Vec::with_capacity(h * cols);
            for r in 0..h {
                for p in &parts {
                    data.extend_from_slice(&p.data[r * p.cols..(r + 1) * p.cols]);
                }
            }
            Ok(single(Array { rows: h, cols, data }))
        }
    }

    pub(super) fn xmatch(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.len() < 2 || a.len() > 4 {
            return Err(ErrKind::Na);
        }
        let key = self.scalar(&a[0]);
        if let Value::Error(k) = key {
            return Err(k);
        }
        let t = self.table(&a[1])?;
        let (h, w) = t.dims();
        if h != 1 && w != 1 {
            return Err(ErrKind::Na);
        }
        let opt = |i: usize, d: f64| -> Result<i64, ErrKind> { if a.len() > i && !matches!(a[i], Expr::Missing) { Ok(self.n(a, i)?.trunc() as i64) } else { Ok(d as i64) } };
        let pos = self.find_x(&key, self.line(&t, w == 1, 0), opt(2, 0.0)?, opt(3, 1.0)?)?.ok_or(ErrKind::Na)?;
        Ok(Value::Number(f64::from(pos + 1)))
    }
}
