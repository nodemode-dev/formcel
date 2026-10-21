use crate::wire::{escape, unescape};
use crate::{Effect, EngineError, Shift, Tx, Workbook, MAX_COLS, MAX_ROWS};

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Anchor {
    pub id: String,
    pub r0: u32,
    pub c0: u32,
    pub dy0: f64,
    pub dx0: f64,
    pub r1: u32,
    pub c1: u32,
    pub dy1: f64,
    pub dx1: f64,
    pub data: String,
}

impl Anchor {
    pub fn line(&self) -> String {
        let mut id = String::new();
        escape(&self.id, &mut id);
        format!("{id}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}", self.r0, self.c0, self.dy0, self.dx0, self.r1, self.c1, self.dy1, self.dx1, self.data)
    }

    pub fn parse(line: &str) -> Option<Anchor> {
        let mut p = line.splitn(10, '\t');
        let id = unescape(p.next()?);
        let r0 = p.next()?.parse().ok()?;
        let c0 = p.next()?.parse().ok()?;
        let dy0 = p.next()?.parse().ok()?;
        let dx0 = p.next()?.parse().ok()?;
        let r1 = p.next()?.parse().ok()?;
        let c1 = p.next()?.parse().ok()?;
        let dy1 = p.next()?.parse().ok()?;
        let dx1 = p.next()?.parse().ok()?;
        let data = p.next()?.to_string();
        if id.is_empty() || r0 >= MAX_ROWS || r1 >= MAX_ROWS || c0 >= MAX_COLS || c1 >= MAX_COLS {
            return None;
        }
        Some(Anchor { id, r0, c0, dy0, dx0, r1, c1, dy1, dx1, data })
    }

    fn shifted(mut self, s: Shift) -> Anchor {
        let limit = if s.rows { MAX_ROWS } else { MAX_COLS } - 1;
        let at = i64::from(s.at);
        let end = at - s.delta;
        let map = |i: u32| -> (u32, bool) {
            let x = i64::from(i);
            if s.delta >= 0 {
                (if x >= at { (x + s.delta).min(i64::from(limit)) as u32 } else { i }, false)
            } else if x >= end {
                ((x + s.delta) as u32, false)
            } else if x >= at {
                (s.at, true)
            } else {
                (i, false)
            }
        };
        if s.rows {
            let (a, ca) = map(self.r0);
            let (b, cb) = map(self.r1);
            self.r0 = a;
            self.r1 = b;
            if ca {
                self.dy0 = 0.0;
            }
            if cb {
                self.dy1 = 0.0;
            }
        } else {
            let (a, ca) = map(self.c0);
            let (b, cb) = map(self.c1);
            self.c0 = a;
            self.c1 = b;
            if ca {
                self.dx0 = 0.0;
            }
            if cb {
                self.dx1 = 0.0;
            }
        }
        self
    }
}

pub fn shift_all(list: Vec<Anchor>, s: Shift) -> Vec<Anchor> {
    list.into_iter().map(|a| a.shifted(s)).collect()
}

impl Workbook {
    pub fn objects(&self, sheet: usize) -> Vec<String> {
        self.sheets.get(sheet).map(|s| s.objects.iter().map(Anchor::line).collect()).unwrap_or_default()
    }

    pub fn load_objects(&mut self, sheet: usize, lines: &[String]) -> Result<usize, EngineError> {
        let s = self.sheets.get_mut(sheet).ok_or(EngineError::NoSheet(sheet))?;
        s.objects = lines.iter().filter_map(|l| Anchor::parse(l)).collect();
        Ok(s.objects.len())
    }

    pub fn set_objects(&mut self, sheet: usize, lines: &[String]) -> Result<Effect, EngineError> {
        let s = self.sheets.get(sheet).ok_or(EngineError::NoSheet(sheet))?;
        let before = s.objects.clone();
        let after: Vec<Anchor> = lines.iter().filter_map(|l| Anchor::parse(l)).collect();
        if before != after {
            self.sheets[sheet].objects = after.clone();
            self.record(Tx::Objects { sheet, before, after });
        }
        Ok(Effect { objects: Some(sheet), ..Effect::default() })
    }
}
