use crate::formula::Area;
use crate::Addr;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

pub type Key = (usize, Addr);

#[derive(Default, Clone, Copy)]
pub struct Fx(u64);

impl Hasher for Fx {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(u64::from(b));
        }
    }

    fn write_u32(&mut self, n: u32) {
        self.write_u64(u64::from(n));
    }

    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }

    fn write_u64(&mut self, n: u64) {
        self.0 = (self.0.rotate_left(5) ^ n).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
}

pub type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<Fx>>;
pub type FastSet<K> = HashSet<K, BuildHasherDefault<Fx>>;

const BUCKET_ROWS: u32 = 64;
const BUCKET_COLS: u32 = 16;
const MAX_BUCKETS: u64 = 256;

#[derive(Default, Debug)]
pub struct Graph {
    pub built: bool,
    areas: FastMap<Key, Vec<(usize, Area)>>,
    by_cell: FastMap<Key, Vec<Key>>,
    buckets: FastMap<(usize, u32, u32), Vec<Key>>,
    big: FastSet<Key>,
}

fn single(ar: &Area) -> Option<Addr> {
    (ar.r0 == ar.r1 && ar.c0 == ar.c1).then_some(Addr { row: ar.r0, col: ar.c0 })
}

fn buckets_of(ar: &Area) -> Option<(u32, u32, u32, u32)> {
    let (r0, r1, c0, c1) = (ar.r0 / BUCKET_ROWS, ar.r1 / BUCKET_ROWS, ar.c0 / BUCKET_COLS, ar.c1 / BUCKET_COLS);
    (u64::from(r1 - r0 + 1) * u64::from(c1 - c0 + 1) <= MAX_BUCKETS).then_some((r0, r1, c0, c1))
}

impl Graph {
    pub fn clear(&mut self) {
        *self = Graph::default();
    }

    pub fn areas(&self, k: &Key) -> &[(usize, Area)] {
        self.areas.get(k).map(Vec::as_slice).unwrap_or(&[])
    }

    pub fn insert(&mut self, k: Key, areas: Vec<(usize, Area)>) {
        self.remove(&k);
        for (s, ar) in &areas {
            if let Some(a) = single(ar) {
                self.by_cell.entry((*s, a)).or_default().push(k);
            } else if let Some((r0, r1, c0, c1)) = buckets_of(ar) {
                for r in r0..=r1 {
                    for c in c0..=c1 {
                        self.buckets.entry((*s, r, c)).or_default().push(k);
                    }
                }
            } else {
                self.big.insert(k);
            }
        }
        self.areas.insert(k, areas);
    }

    pub fn remove(&mut self, k: &Key) {
        let Some(areas) = self.areas.remove(k) else { return };
        for (s, ar) in &areas {
            if let Some(a) = single(ar) {
                if let Some(v) = self.by_cell.get_mut(&(*s, a)) {
                    v.retain(|x| x != k);
                    if v.is_empty() {
                        self.by_cell.remove(&(*s, a));
                    }
                }
            } else if let Some((r0, r1, c0, c1)) = buckets_of(ar) {
                for r in r0..=r1 {
                    for c in c0..=c1 {
                        if let Some(v) = self.buckets.get_mut(&(*s, r, c)) {
                            v.retain(|x| x != k);
                            if v.is_empty() {
                                self.buckets.remove(&(*s, r, c));
                            }
                        }
                    }
                }
            }
        }
        self.big.remove(k);
    }

    fn reads(&self, x: &Key, k: &Key) -> bool {
        self.areas(x).iter().any(|(s, ar)| *s == k.0 && ar.contains(k.1.row, k.1.col))
    }

    pub fn dependents(&self, k: &Key, out: &mut dyn FnMut(Key)) {
        if let Some(v) = self.by_cell.get(k) {
            for x in v {
                out(*x);
            }
        }
        if let Some(v) = self.buckets.get(&(k.0, k.1.row / BUCKET_ROWS, k.1.col / BUCKET_COLS)) {
            for x in v {
                if self.reads(x, k) {
                    out(*x);
                }
            }
        }
        for x in &self.big {
            if self.reads(x, k) {
                out(*x);
            }
        }
    }
}
