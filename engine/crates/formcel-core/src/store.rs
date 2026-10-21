use crate::{Addr, Value, MAX_COLS, MAX_ROWS};
use std::collections::BTreeMap;

pub const BLOCK_ROWS: u32 = 32;
pub const BLOCK_COLS: u32 = 32;

#[derive(Default, Debug)]
struct Block {
    cells: Vec<(u16, Value)>,
}

impl Block {
    fn find(&self, i: u16) -> Result<usize, usize> {
        self.cells.binary_search_by_key(&i, |c| c.0)
    }
}

#[derive(Default, Debug)]
pub struct Store {
    blocks: BTreeMap<(u32, u32), Block>,
    len: usize,
}

fn key(a: Addr) -> ((u32, u32), u16) {
    ((a.row / BLOCK_ROWS, a.col / BLOCK_COLS), ((a.row % BLOCK_ROWS) * BLOCK_COLS + a.col % BLOCK_COLS) as u16)
}

fn unkey(rb: u32, cb: u32, i: u16) -> Addr {
    Addr { row: rb * BLOCK_ROWS + u32::from(i) / BLOCK_COLS, col: cb * BLOCK_COLS + u32::from(i) % BLOCK_COLS }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    Up,
    Down,
    Left,
    Right,
}

impl Dir {
    pub fn parse(s: &str) -> Option<Dir> {
        match s {
            "up" => Some(Dir::Up),
            "down" => Some(Dir::Down),
            "left" => Some(Dir::Left),
            "right" => Some(Dir::Right),
            _ => None,
        }
    }

    fn step(self, a: Addr) -> Option<Addr> {
        match self {
            Dir::Up => a.row.checked_sub(1).map(|row| Addr { row, ..a }),
            Dir::Down => (a.row + 1 < MAX_ROWS).then_some(Addr { row: a.row + 1, ..a }),
            Dir::Left => a.col.checked_sub(1).map(|col| Addr { col, ..a }),
            Dir::Right => (a.col + 1 < MAX_COLS).then_some(Addr { col: a.col + 1, ..a }),
        }
    }

    fn limit(self, a: Addr) -> Addr {
        match self {
            Dir::Up => Addr { row: 0, ..a },
            Dir::Down => Addr { row: MAX_ROWS - 1, ..a },
            Dir::Left => Addr { col: 0, ..a },
            Dir::Right => Addr { col: MAX_COLS - 1, ..a },
        }
    }
}

impl Store {
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn get(&self, a: Addr) -> Option<&Value> {
        let (k, i) = key(a);
        let b = self.blocks.get(&k)?;
        b.find(i).ok().map(|p| &b.cells[p].1)
    }

    pub fn is_filled(&self, a: Addr) -> bool {
        self.get(a).is_some()
    }

    pub fn set(&mut self, a: Addr, v: Value) -> Value {
        let (k, i) = key(a);
        if v == Value::Empty {
            let Some(b) = self.blocks.get_mut(&k) else { return Value::Empty };
            return match b.find(i) {
                Ok(p) => {
                    let old = b.cells.remove(p).1;
                    self.len -= 1;
                    if b.cells.is_empty() {
                        self.blocks.remove(&k);
                    }
                    old
                }
                Err(_) => Value::Empty,
            };
        }
        let b = self.blocks.entry(k).or_default();
        match b.find(i) {
            Ok(p) => std::mem::replace(&mut b.cells[p].1, v),
            Err(p) => {
                b.cells.insert(p, (i, v));
                self.len += 1;
                Value::Empty
            }
        }
    }

    pub fn for_each_in(&self, top: Addr, bottom: Addr, mut f: impl FnMut(Addr, &Value)) {
        for rb in top.row / BLOCK_ROWS..=bottom.row / BLOCK_ROWS {
            for (&(rb, cb), b) in self.blocks.range((rb, top.col / BLOCK_COLS)..=(rb, bottom.col / BLOCK_COLS)) {
                for (i, v) in &b.cells {
                    let a = unkey(rb, cb, *i);
                    if a.row >= top.row && a.row <= bottom.row && a.col >= top.col && a.col <= bottom.col {
                        f(a, v);
                    }
                }
            }
        }
    }

    pub fn extent(&self) -> Option<Addr> {
        let mut out: Option<Addr> = None;
        for (&(rb, cb), b) in &self.blocks {
            for (i, _) in &b.cells {
                let a = unkey(rb, cb, *i);
                let m = out.get_or_insert(a);
                m.row = m.row.max(a.row);
                m.col = m.col.max(a.col);
            }
        }
        out
    }

    fn next_filled(&self, from: Addr, dir: Dir) -> Option<Addr> {
        let mut cur = dir.step(from)?;
        loop {
            let (k, _) = key(cur);
            if let Some(b) = self.blocks.get(&k) {
                let mut best: Option<Addr> = None;
                for (i, _) in &b.cells {
                    let a = unkey(k.0, k.1, *i);
                    let ahead = match dir {
                        Dir::Down => a.col == cur.col && a.row >= cur.row,
                        Dir::Up => a.col == cur.col && a.row <= cur.row,
                        Dir::Right => a.row == cur.row && a.col >= cur.col,
                        Dir::Left => a.row == cur.row && a.col <= cur.col,
                    };
                    if !ahead {
                        continue;
                    }
                    let closer = match (best, dir) {
                        (None, _) => true,
                        (Some(x), Dir::Down) => a.row < x.row,
                        (Some(x), Dir::Up) => a.row > x.row,
                        (Some(x), Dir::Right) => a.col < x.col,
                        (Some(x), Dir::Left) => a.col > x.col,
                    };
                    if closer {
                        best = Some(a);
                    }
                }
                if best.is_some() {
                    return best;
                }
            }
            let next = match dir {
                Dir::Down => ((k.0 + 1) * BLOCK_ROWS < MAX_ROWS).then(|| Addr { row: (k.0 + 1) * BLOCK_ROWS, ..cur }),
                Dir::Up => (k.0 > 0).then(|| Addr { row: k.0 * BLOCK_ROWS - 1, ..cur }),
                Dir::Right => ((k.1 + 1) * BLOCK_COLS < MAX_COLS).then(|| Addr { col: (k.1 + 1) * BLOCK_COLS, ..cur }),
                Dir::Left => (k.1 > 0).then(|| Addr { col: k.1 * BLOCK_COLS - 1, ..cur }),
            };
            cur = next?;
        }
    }

    pub fn take_all(&mut self) -> Vec<(Addr, Value)> {
        let blocks = std::mem::take(&mut self.blocks);
        self.len = 0;
        let mut out = Vec::new();
        for ((rb, cb), b) in blocks {
            for (i, v) in b.cells {
                out.push((unkey(rb, cb, i), v));
            }
        }
        out
    }

    pub fn shift(&mut self, rows: bool, at: u32, delta: i64) -> Vec<(Addr, Value)> {
        let mut dropped = Vec::new();
        let limit = i64::from(if rows { MAX_ROWS } else { MAX_COLS });
        let at64 = i64::from(at);
        for (a, v) in self.take_all() {
            let c = i64::from(if rows { a.row } else { a.col });
            let moved = if delta >= 0 {
                if c >= at64 { c + delta } else { c }
            } else if c >= at64 && c < at64 - delta {
                dropped.push((a, v));
                continue;
            } else if c >= at64 - delta {
                c + delta
            } else {
                c
            };
            if moved >= limit {
                dropped.push((a, v));
                continue;
            }
            let b = if rows { Addr { row: moved as u32, ..a } } else { Addr { col: moved as u32, ..a } };
            self.set(b, v);
        }
        dropped
    }

    pub fn edge(&self, from: Addr, dir: Dir) -> Addr {
        let Some(n) = dir.step(from) else { return from };
        if self.is_filled(from) && self.is_filled(n) {
            let mut cur = n;
            while let Some(m) = dir.step(cur) {
                if !self.is_filled(m) {
                    break;
                }
                cur = m;
            }
            return cur;
        }
        self.next_filled(from, dir).unwrap_or_else(|| dir.limit(from))
    }
}
