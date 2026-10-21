use super::*;
use crate::formula::refs;

impl Workbook {
    pub(super) fn t_autooutline(&mut self, sheet: usize, _p: &[String]) -> Out {
        let own = self.sheets[sheet].name.clone();
        let mut rows: Vec<(u32, u32)> = Vec::new();
        let mut cols: Vec<(u32, u32)> = Vec::new();
        for ((sh, at), f) in &self.formulas {
            if *sh != sheet {
                continue;
            }
            let Some(ast) = &f.ast else { continue };
            refs(ast, &mut |s, ar| {
                if !s.is_none_or(|n| n.eq_ignore_ascii_case(&own)) {
                    return;
                }
                if ar.c0 <= at.col && at.col <= ar.c1 && ar.r0 < ar.r1 {
                    if ar.r1 + 1 == at.row || ar.r0 == at.row + 1 {
                        rows.push((ar.r0, ar.r1));
                    }
                }
                if ar.r0 <= at.row && at.row <= ar.r1 && ar.c0 < ar.c1 {
                    if ar.c1 + 1 == at.col || ar.c0 == at.col + 1 {
                        cols.push((ar.c0, ar.c1));
                    }
                }
            });
        }
        for list in [&mut rows, &mut cols] {
            list.sort_unstable();
            list.dedup();
        }
        if rows.is_empty() && cols.is_empty() {
            return Ok((Effect::default(), say("No summary formulas with detail rows or columns next to them were found.")));
        }
        let mut lines: Vec<String> = rows.iter().map(|(x, y)| format!("r\t{x}\t{y}")).collect();
        lines.extend(cols.iter().map(|(x, y)| format!("c\t{x}\t{y}")));
        Ok((Effect::default(), say(&format!("Found {} row groups and {} column groups.\n{}", rows.len(), cols.len(), lines.join("\n")))))
    }
}
