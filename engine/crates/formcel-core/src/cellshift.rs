use crate::formula::{shift_index, shift_span, walk_mut, Area, Expr, RefKind};
use crate::{ErrKind, MAX_COLS, MAX_ROWS};

#[derive(Clone, Copy)]
pub struct Block {
    pub area: Area,
    pub vertical: bool,
    pub insert: bool,
}

impl Block {
    fn at(&self) -> u32 {
        if self.vertical { self.area.r0 } else { self.area.c0 }
    }

    fn delta(&self) -> i64 {
        let n = if self.vertical { self.area.r1 - self.area.r0 + 1 } else { self.area.c1 - self.area.c0 + 1 };
        if self.insert { i64::from(n) } else { -i64::from(n) }
    }

    fn limit(&self) -> u32 {
        if self.vertical { MAX_ROWS } else { MAX_COLS }
    }

    fn band(&self) -> (u32, u32) {
        if self.vertical { (self.area.c0, self.area.c1) } else { (self.area.r0, self.area.r1) }
    }
}

pub fn remap(e: &mut Expr, own: &str, target: &str, b: Block) -> bool {
    let mut changed = false;
    let (at, delta, limit) = (b.at(), b.delta(), b.limit());
    let (b0, b1) = b.band();
    walk_mut(e, &mut |node| {
        let Expr::Ref(sheet, kind) = node else { return };
        if !sheet.as_deref().unwrap_or(own).eq_ignore_ascii_case(target) {
            return;
        }
        let before = *kind;
        let next: Option<RefKind> = match *kind {
            RefKind::Cell(c) => {
                let (main, cross) = if b.vertical { (c.row, c.col) } else { (c.col, c.row) };
                if cross < b0 || cross > b1 {
                    Some(before)
                } else {
                    shift_index(main, at, delta, limit).map(|n| {
                        let mut c = c;
                        if b.vertical {
                            c.row = n;
                        } else {
                            c.col = n;
                        }
                        RefKind::Cell(c)
                    })
                }
            }
            RefKind::Area(mut x, mut y) => {
                let (cl, ch) = if b.vertical { (x.col.min(y.col), x.col.max(y.col)) } else { (x.row.min(y.row), x.row.max(y.row)) };
                if cl < b0 || ch > b1 {
                    Some(before)
                } else {
                    let (pa, pb) = if b.vertical { (x.row, y.row) } else { (x.col, y.col) };
                    shift_span(pa.min(pb), pa.max(pb), at, delta, limit).map(|(lo, hi)| {
                        let (first, second) = if pa <= pb { (&mut x, &mut y) } else { (&mut y, &mut x) };
                        if b.vertical {
                            first.row = lo;
                            second.row = hi;
                        } else {
                            first.col = lo;
                            second.col = hi;
                        }
                        RefKind::Area(x, y)
                    })
                }
            }
            k => Some(k),
        };
        match next {
            Some(k) => {
                if k != before {
                    *kind = k;
                    changed = true;
                }
            }
            None => {
                *node = Expr::Err(ErrKind::Ref);
                changed = true;
            }
        }
    });
    changed
}
