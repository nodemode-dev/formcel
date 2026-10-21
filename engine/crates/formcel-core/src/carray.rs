use crate::eval::{Array, Out};
use crate::formula::Area;
use crate::graph::{FastMap, Key};
use crate::{Addr, Effect, EngineError, Shift, Tx, Value, Workbook, MAX_COLS, MAX_ROWS};

pub const PART_MSG: &str = "You can't change part of an array.";
const CELL_LIMIT: u64 = 1_000_000;

fn area_of(k: Key, (h, w): (u32, u32)) -> Area {
    Area { r0: k.1.row, c0: k.1.col, r1: k.1.row + h - 1, c1: k.1.col + w - 1 }
}

fn overlaps(a: Area, b: Area) -> bool {
    a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0
}

impl Workbook {
    pub(crate) fn array_key(&self, sheet: usize, a: Addr) -> Option<Key> {
        if self.arrays.is_empty() {
            return None;
        }
        let here = (sheet, a);
        if self.arrays.contains_key(&here) {
            return Some(here);
        }
        self.spilled.get(&here).copied().filter(|k| self.arrays.contains_key(k))
    }

    pub fn array_at(&self, sheet: usize, a: Addr) -> Option<Area> {
        let k = self.array_key(sheet, a)?;
        self.arrays.get(&k).map(|d| area_of(k, *d))
    }

    pub fn array_formula(&self, sheet: usize, a: Addr) -> Option<String> {
        let k = self.array_key(sheet, a)?;
        self.formulas.get(&k).map(|f| format!("{{{}}}", f.text()))
    }

    pub fn arrays(&self, sheet: usize) -> Vec<Area> {
        let mut out: Vec<Area> = self.arrays.iter().filter(|(k, _)| k.0 == sheet).map(|(k, d)| area_of(*k, *d)).collect();
        out.sort_by_key(|a| (a.r0, a.c0));
        out
    }

    pub fn load_arrays(&mut self, sheet: usize, list: &[Area]) -> usize {
        let mut seeds = Vec::new();
        for ar in list {
            let k = (sheet, Addr { row: ar.r0, col: ar.c0 });
            if ar.r1 < ar.r0 || ar.c1 < ar.c0 || ar.r1 >= MAX_ROWS || ar.c1 >= MAX_COLS || !self.formulas.contains_key(&k) {
                continue;
            }
            if u64::from(ar.r1 - ar.r0 + 1) * u64::from(ar.c1 - ar.c0 + 1) > CELL_LIMIT {
                continue;
            }
            self.arrays.insert(k, (ar.r1 - ar.r0 + 1, ar.c1 - ar.c0 + 1));
            seeds.push(k);
        }
        if !seeds.is_empty() {
            self.recalc(&seeds);
        }
        seeds.len()
    }

    pub(crate) fn fill_array(&mut self, k: Key, o: Out) -> Value {
        let (s, a) = k;
        let (h, w) = self.arrays[&k];
        let grid = match o {
            Out::V(v) => Array { rows: 1, cols: 1, data: vec![v] },
            Out::A(x) => x,
        };
        if let Some((ph, pw)) = self.spills.insert(k, (h, w)) {
            for r in a.row..a.row + ph {
                for c in a.col..a.col + pw {
                    let p = (s, Addr { row: r, col: c });
                    if p != k && self.spilled.get(&p) == Some(&k) && (r >= a.row + h || c >= a.col + w) {
                        self.spilled.remove(&p);
                        self.sheets[s].cells.set(p.1, Value::Empty);
                        self.touched.push(p);
                    }
                }
            }
        }
        let mut first = Value::Empty;
        for r in 0..h {
            for c in 0..w {
                let v = grid.pick(r as usize, c as usize);
                let p = (s, Addr { row: a.row + r, col: a.col + c });
                if p == k {
                    first = v;
                    continue;
                }
                self.spilled.insert(p, k);
                if self.sheets[s].cells.get(p.1) != Some(&v) {
                    self.sheets[s].cells.set(p.1, v);
                    self.touched.push(p);
                }
            }
        }
        first
    }

    pub fn set_array(&mut self, sheet: usize, top: Addr, bottom: Addr, raw: &str) -> Result<Effect, EngineError> {
        self.check(sheet, top)?;
        self.check(sheet, bottom)?;
        let t = raw.trim_start();
        if !t.starts_with('=') || t.len() < 2 {
            return Err(EngineError::BadFormula(raw.to_string()));
        }
        let ar = Area { r0: top.row.min(bottom.row), c0: top.col.min(bottom.col), r1: top.row.max(bottom.row), c1: top.col.max(bottom.col) };
        let (h, w) = (ar.r1 - ar.r0 + 1, ar.c1 - ar.c0 + 1);
        if u64::from(h) * u64::from(w) > CELL_LIMIT {
            return Err(EngineError::OutOfRange { row: ar.r1, col: ar.c1 });
        }
        let anchor = Addr { row: ar.r0, col: ar.c0 };
        let k = (sheet, anchor);
        if self.arrays.iter().any(|(ok, d)| ok.0 == sheet && overlaps(area_of(*ok, *d), ar) && !(*ok == k && *d == (h, w))) {
            self.wprot.refusal = PART_MSG.to_string();
            return Err(EngineError::Protected(PART_MSG.to_string()));
        }
        let spots: Vec<(u32, u32)> = if u64::from(h) * u64::from(w) <= 100_000 { (ar.r0..=ar.r1).flat_map(|r| (ar.c0..=ar.c1).map(move |c| (r, c))).collect() } else { vec![(ar.r0, ar.c0), (ar.r1, ar.c1)] };
        if let Err(m) = self.guard_cells(sheet, &spots) {
            self.wprot.refusal.clone_from(&m);
            return Err(EngineError::Protected(m));
        }
        let before: Vec<(Key, (u32, u32))> = self.arrays.get(&k).map(|d| vec![(k, *d)]).unwrap_or_default();
        let mut edits = vec![(anchor, raw.to_string())];
        self.sheets[sheet].cells.for_each_in(Addr { row: ar.r0, col: ar.c0 }, Addr { row: ar.r1, col: ar.c1 }, |a, _| {
            if a != anchor {
                edits.push((a, String::new()));
            }
        });
        for (key, _) in self.formulas.iter().filter(|(key, _)| key.0 == sheet && ar.contains(key.1.row, key.1.col) && key.1 != anchor) {
            if !edits.iter().any(|(a, _)| *a == key.1) {
                edits.push((key.1, String::new()));
            }
        }
        let mark = self.undo.len();
        self.calc.free_arrays = true;
        self.arrays.insert(k, (h, w));
        let res = self.apply(sheet, &edits);
        self.calc.free_arrays = false;
        match res {
            Ok(cells) => {
                self.record(Tx::Arrays { before, after: vec![(k, (h, w))] });
                self.group_since(mark);
                Ok(Effect { cells, ..Effect::default() })
            }
            Err(e) => {
                self.arrays.remove(&k);
                for (bk, d) in before {
                    self.arrays.insert(bk, d);
                }
                Err(e)
            }
        }
    }

    pub(crate) fn guard_arrays(&mut self, sheet: usize, edits: &[(Addr, String)]) -> Result<(), String> {
        if self.arrays.is_empty() || self.calc.free_arrays {
            return Ok(());
        }
        let mut hit: FastMap<Key, (u64, bool)> = FastMap::default();
        for (a, raw) in edits {
            if let Some(k) = self.array_key(sheet, *a) {
                let e = hit.entry(k).or_insert((0, true));
                e.0 += 1;
                e.1 &= raw.is_empty();
            }
        }
        for (k, (n, empty)) in &hit {
            let (h, w) = self.arrays[k];
            if !(*empty && *n >= u64::from(h) * u64::from(w)) {
                return Err(PART_MSG.to_string());
            }
        }
        for (k, _) in hit {
            if let Some(d) = self.arrays.remove(&k) {
                self.calc.removed_arrays.push((k, d));
            }
        }
        Ok(())
    }

    pub(crate) fn flush_array_tx(&mut self) {
        if self.calc.removed_arrays.is_empty() {
            return;
        }
        let before = std::mem::take(&mut self.calc.removed_arrays);
        self.record(Tx::Arrays { before, after: Vec::new() });
    }

    pub(crate) fn replay_arrays(&mut self, before: &[(Key, (u32, u32))], after: &[(Key, (u32, u32))], forward: bool) -> Effect {
        let (from, to) = if forward { (before, after) } else { (after, before) };
        for (k, _) in from {
            self.arrays.remove(k);
        }
        for (k, d) in to {
            self.arrays.insert(*k, *d);
        }
        let mut seeds: Vec<Key> = from.iter().chain(to).map(|(k, _)| *k).filter(|k| self.formulas.contains_key(k)).collect();
        seeds.sort_unstable_by_key(|k| (k.0, k.1.row, k.1.col));
        seeds.dedup();
        let cells = if seeds.is_empty() { Vec::new() } else { self.recalc(&seeds) };
        Effect { cells, ..Effect::default() }
    }

    pub(crate) fn check_shift_arrays(&self, s: Shift) -> Result<(), String> {
        for (k, d) in &self.arrays {
            if k.0 != s.sheet {
                continue;
            }
            let ar = area_of(*k, *d);
            let (lo, hi) = if s.rows { (i64::from(ar.r0), i64::from(ar.r1)) } else { (i64::from(ar.c0), i64::from(ar.c1)) };
            let at = i64::from(s.at);
            let cut = if s.delta >= 0 { at > lo && at <= hi } else { at <= hi && at - s.delta > lo };
            if cut {
                return Err(PART_MSG.to_string());
            }
        }
        Ok(())
    }

    pub(crate) fn shift_arrays(&mut self, s: Shift) {
        let old = std::mem::take(&mut self.arrays);
        for (k, d) in old {
            if k.0 != s.sheet {
                self.arrays.insert(k, d);
                continue;
            }
            if let Some(n) = crate::shift_span_pub(area_of(k, d), s) {
                self.arrays.insert((k.0, Addr { row: n.r0, col: n.c0 }), (n.r1 - n.r0 + 1, n.c1 - n.c0 + 1));
            }
        }
    }

    pub(crate) fn spill_hits_area(&self, sheet: usize, a: Addr, h: u32, w: u32) -> bool {
        let ar = Area { r0: a.row, c0: a.col, r1: a.row.saturating_add(h - 1), c1: a.col.saturating_add(w - 1) };
        self.sheets[sheet].merges.iter().any(|m| overlaps(*m, ar)) || self.tables.iter().any(|t| t.sheet == sheet && overlaps(t.area, ar))
    }

    pub fn spill_at(&self, sheet: usize, a: Addr) -> Option<(Area, bool)> {
        let here = (sheet, a);
        let k = if self.spills.contains_key(&here) { here } else { *self.spilled.get(&here)? };
        let (h, w) = *self.spills.get(&k)?;
        if h * w <= 1 && !self.arrays.contains_key(&k) {
            return None;
        }
        if matches!(self.sheets[k.0].cells.get(k.1), Some(Value::Error(crate::ErrKind::Spill))) {
            return None;
        }
        Some((area_of(k, (h, w)), self.arrays.contains_key(&k)))
    }

    pub fn spill_reason(&self, sheet: usize, a: Addr) -> Option<(String, Option<Addr>)> {
        let k = (sheet, a);
        if !matches!(self.sheets[sheet].cells.get(a), Some(Value::Error(crate::ErrKind::Spill))) || !self.formulas.contains_key(&k) {
            return None;
        }
        let (h, w) = *self.spills.get(&k)?;
        let ar = Area { r0: a.row, c0: a.col, r1: a.row.saturating_add(h - 1), c1: a.col.saturating_add(w - 1) };
        if ar.r1 >= MAX_ROWS || ar.c1 >= MAX_COLS {
            return Some(("The spill range is too big: it extends beyond the edge of the sheet.".to_string(), None));
        }
        if let Some(m) = self.sheets[sheet].merges.iter().find(|m| overlaps(**m, ar)) {
            return Some(("The spill range has merged cells.".to_string(), Some(Addr { row: m.r0, col: m.c0 })));
        }
        if let Some(t) = self.tables.iter().find(|t| t.sheet == sheet && overlaps(t.area, ar)) {
            return Some(("The spill range is in a table.".to_string(), Some(Addr { row: t.area.r0, col: t.area.c0 })));
        }
        let mut blocker = None;
        for r in ar.r0..=ar.r1 {
            for c in ar.c0..=ar.c1 {
                let p = (sheet, Addr { row: r, col: c });
                if p != k && blocker.is_none() && (self.formulas.contains_key(&p) || (self.spilled.get(&p) != Some(&k) && self.sheets[sheet].cells.get(p.1).is_some())) {
                    blocker = Some(p.1);
                }
            }
            if blocker.is_some() {
                break;
            }
        }
        Some(("The spill range is not blank.".to_string(), blocker))
    }

    pub(crate) fn rekey_arrays(&mut self, map: &dyn Fn(usize) -> Option<usize>) {
        let old = std::mem::take(&mut self.arrays);
        for ((s, a), d) in old {
            if let Some(n) = map(s) {
                self.arrays.insert((n, a), d);
            }
        }
        let stale = std::mem::take(&mut self.calc.stale);
        self.calc.stale = stale.into_iter().filter_map(|(s, a)| map(s).map(|n| (n, a))).collect();
        let circ = std::mem::take(&mut self.calc.circular);
        self.calc.circular = circ.into_iter().filter_map(|(s, a)| map(s).map(|n| (n, a))).collect();
        let ignored = std::mem::take(&mut self.calc.ignored);
        self.calc.ignored = ignored.into_iter().filter_map(|(s, r, c, rule)| map(s).map(|n| (n, r, c, rule))).collect();
    }
}
