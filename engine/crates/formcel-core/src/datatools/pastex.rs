use super::*;
use crate::{cf, valid, Tx};

fn clip(m: Area, src: Area) -> Option<Area> {
    let (r0, r1, c0, c1) = (m.r0.max(src.r0), m.r1.min(src.r1), m.c0.max(src.c0), m.c1.min(src.c1));
    (r0 <= r1 && c0 <= c1).then_some(Area { r0, c0, r1, c1 })
}

fn landing(piece: Area, src: Area, dr: u32, dc: u32, transpose: bool) -> Area {
    let (r0, c0) = (piece.r0 - src.r0, piece.c0 - src.c0);
    let (h, w) = (piece.r1 - piece.r0, piece.c1 - piece.c0);
    if transpose {
        Area { r0: dr + c0, c0: dc + r0, r1: dr + c0 + w, c1: dc + r0 + h }
    } else {
        Area { r0: dr + r0, c0: dc + c0, r1: dr + r0 + h, c1: dc + c0 + w }
    }
}

fn sheet_prefix(name: &str) -> String {
    if name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

impl Workbook {
    pub(super) fn t_pastelayers(&mut self, sheet: usize, p: &[String]) -> Out {
        let (Some(src), Ok(dr), Ok(dc)) = (area_of(arg(p, 1)), arg(p, 2).parse::<u32>(), arg(p, 3).parse::<u32>()) else { return bad("bad range") };
        let transpose = flag(p, 4);
        let ss = arg(p, 5).parse::<usize>().ok().filter(|s| *s < self.sheets.len()).unwrap_or(sheet);
        let layers: Vec<&str> = arg(p, 6).split(',').collect();
        let (h, w) = (src.r1 - src.r0 + 1, src.c1 - src.c0 + 1);
        let dest = if transpose { Area { r0: dr, c0: dc, r1: dr + w - 1, c1: dc + h - 1 } } else { Area { r0: dr, c0: dc, r1: dr + h - 1, c1: dc + w - 1 } };
        if dest.r1 >= crate::MAX_ROWS || dest.c1 >= crate::MAX_COLS {
            return bad("The paste runs past the last row or column.");
        }
        let mut out = Effect::default();
        let mut said = Vec::new();
        if layers.contains(&"validation") {
            let before = self.sheets[sheet].valid.clone();
            let mut after: Vec<valid::Validation> = Vec::new();
            for v in &before {
                for piece in valid::carve(v.area, dest) {
                    after.push(valid::Validation { area: piece, ..v.clone() });
                }
            }
            let mut n = 0;
            let from: Vec<valid::Validation> = self.sheets[ss].valid.clone();
            for v in &from {
                if let Some(piece) = clip(v.area, src) {
                    after.push(valid::Validation { area: landing(piece, src, dr, dc, transpose), ..v.clone() });
                    n += 1;
                }
            }
            if before != after {
                self.sheets[sheet].valid = after.clone();
                self.record(Tx::Valid { sheet, before, after });
            }
            out.valid = Some(sheet);
            said.push(format!("{n} validation rules"));
        }
        if layers.contains(&"cf") {
            let before = self.sheets[sheet].rules.clone();
            let mut after = before.clone();
            let mut n = 0;
            let from: Vec<cf::Rule> = self.sheets[ss].rules.clone();
            for r in &from {
                if let Some(piece) = clip(r.area, src) {
                    let mut moved = r.clone();
                    moved.area = landing(piece, src, dr, dc, transpose);
                    if let cf::Kind::Formula(f) = &moved.kind {
                        if !transpose {
                            moved.kind = cf::Kind::Formula(offset_text(&format!("={f}"), i64::from(dr) - i64::from(src.r0), i64::from(dc) - i64::from(src.c0)).trim_start_matches('=').to_string());
                        }
                    }
                    after.push(moved);
                    n += 1;
                }
            }
            if before != after {
                self.sheets[sheet].rules = after.clone();
                self.record(Tx::Rules { sheet, before, after });
            }
            out.rules = Some(sheet);
            said.push(format!("{n} conditional formats"));
        }
        if layers.contains(&"link") {
            let names = self.sheet_names();
            let prefix = if ss == sheet { String::new() } else { format!("{}!", sheet_prefix(&names[ss])) };
            let mut edits = Vec::new();
            for r in 0..h {
                for c in 0..w {
                    let to = if transpose { a(dr + c, dc + r) } else { a(dr + r, dc + c) };
                    edits.push((to, format!("={prefix}{}{}", col_name(src.c0 + c), src.r0 + r + 1)));
                }
            }
            let n = edits.len();
            out.cells = self.apply(sheet, &edits)?;
            said.push(format!("{n} links"));
        }
        Ok((out, say(&format!("Pasted {}.", said.join(", ")))))
    }
}
