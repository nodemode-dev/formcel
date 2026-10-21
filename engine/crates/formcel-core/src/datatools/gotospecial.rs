use super::*;

const LIMIT: usize = 2000;

fn ranges_of(mut cells: Vec<Addr>) -> Vec<Area> {
    cells.sort_by_key(|c| (c.row, c.col));
    cells.dedup();
    let mut spans: Vec<Area> = Vec::new();
    for c in cells {
        match spans.last_mut() {
            Some(s) if s.r0 == c.row && s.r1 == c.row && s.c1 + 1 == c.col => s.c1 = c.col,
            _ => spans.push(Area { r0: c.row, c0: c.col, r1: c.row, c1: c.col }),
        }
    }
    let mut out: Vec<Area> = Vec::new();
    for s in spans {
        match out.iter_mut().rev().take_while(|o| o.r1 + 1 >= s.r0).find(|o| o.c0 == s.c0 && o.c1 == s.c1 && o.r1 + 1 == s.r0) {
            Some(o) => o.r1 = s.r0,
            None => out.push(s),
        }
    }
    out.sort_by_key(|o| (o.r0, o.c0));
    out
}

impl Workbook {
    fn occupied(&self, sheet: usize, r: u32, c: u32) -> bool {
        !matches!(self.cell_val(sheet, a(r, c)), Value::Empty) || self.formulas.contains_key(&(sheet, a(r, c)))
    }

    fn region_of(&self, sheet: usize, at: Addr) -> Area {
        let mut g = Area { r0: at.row, c0: at.col, r1: at.row, c1: at.col };
        loop {
            let mut grew = false;
            let (r0, r1, c0, c1) = (g.r0.saturating_sub(1), (g.r1 + 1).min(crate::MAX_ROWS - 1), g.c0.saturating_sub(1), (g.c1 + 1).min(crate::MAX_COLS - 1));
            let reach = |rows: std::ops::RangeInclusive<u32>, cols: std::ops::RangeInclusive<u32>| rows.into_iter().any(|r| cols.clone().any(|c| self.occupied(sheet, r, c)));
            if g.r0 > 0 && reach(r0..=r0, c0..=c1) {
                g.r0 -= 1;
                grew = true;
            }
            if g.r1 + 1 < crate::MAX_ROWS && reach(r1..=r1, c0..=c1) {
                g.r1 += 1;
                grew = true;
            }
            let (r0, r1) = (g.r0, g.r1);
            if g.c0 > 0 && reach(r0..=r1, c0..=c0) {
                g.c0 -= 1;
                grew = true;
            }
            if g.c1 + 1 < crate::MAX_COLS && reach(r0..=r1, c1..=c1) {
                g.c1 += 1;
                grew = true;
            }
            if !grew {
                return g;
            }
        }
    }

    pub(super) fn t_gotospecial(&mut self, sheet: usize, p: &[String]) -> Out {
        let kind = arg(p, 1).to_string();
        let Some(scope) = area_of(arg(p, 2)) else { return bad("bad range") };
        let at: Vec<u32> = arg(p, 3).split(',').filter_map(|x| x.parse().ok()).collect();
        let at = if at.len() == 2 { a(at[0], at[1]) } else { a(scope.r0, scope.c0) };
        let flags: Vec<&str> = arg(p, 4).split(',').filter(|f| !f.is_empty()).collect();
        let has = |f: &str| flags.contains(&f);
        let single = scope.r0 == scope.r1 && scope.c0 == scope.c1;
        let end = self.sheets[sheet].cells.extent();
        let used = Area { r0: 0, c0: 0, r1: end.map_or(0, |e| e.row), c1: end.map_or(0, |e| e.col) };
        let area = if single { used } else { scope };
        let mut cells: Vec<Addr> = Vec::new();
        let mut found: Vec<Area> = Vec::new();
        match kind.as_str() {
            "blanks" => {
                let area = if single { used } else { Area { r1: scope.r1.min(used.r1.max(scope.r0)), ..scope } };
                for r in area.r0..=area.r1 {
                    for c in area.c0..=area.c1 {
                        if !self.occupied(sheet, r, c) {
                            cells.push(a(r, c));
                        }
                    }
                }
            }
            "constants" | "formulas" => {
                let want = |v: &Value| match v {
                    Value::Number(_) => has("n"),
                    Value::Text(_) => has("t"),
                    Value::Bool(_) => has("l"),
                    Value::Error(_) => has("e"),
                    Value::Empty => false,
                };
                let formulas = kind == "formulas";
                let last = area.r1.min(used.r1);
                let mut all: Vec<(Addr, Value)> = Vec::new();
                self.sheets[sheet].cells.for_each_in(a(area.r0, area.c0), a(last, area.c1), |ad, v| all.push((ad, v.clone())));
                for (ad, v) in all {
                    let is_formula = self.formulas.contains_key(&(sheet, ad));
                    if is_formula == formulas && (want(&v) || (!has("n") && !has("t") && !has("l") && !has("e"))) {
                        cells.push(ad);
                    }
                }
                if formulas {
                    for (k, _) in self.formulas.iter() {
                        if k.0 == sheet && area.contains(k.1.row, k.1.col) && matches!(self.cell_val(sheet, k.1), Value::Empty) && (has("t") || (!has("n") && !has("l") && !has("e"))) {
                            cells.push(k.1);
                        }
                    }
                }
            }
            "region" => found.push(self.region_of(sheet, at)),
            "array" => {
                let hit = self.spills.iter().find(|(k, (h, w))| k.0 == sheet && (k.1.row..k.1.row + h).contains(&at.row) && (k.1.col..k.1.col + w).contains(&at.col));
                if let Some((k, (h, w))) = hit {
                    found.push(Area { r0: k.1.row, c0: k.1.col, r1: k.1.row + h - 1, c1: k.1.col + w - 1 });
                } else if self.formulas.contains_key(&(sheet, at)) {
                    found.push(Area { r0: at.row, c0: at.col, r1: at.row, c1: at.col });
                }
            }
            "lastcell" => {
                if end.is_some() {
                    found.push(Area { r0: used.r1, c0: used.c1, r1: used.r1, c1: used.c1 });
                }
            }
            "rowdiff" | "coldiff" => {
                let by_row = kind == "rowdiff";
                for r in scope.r0..=scope.r1 {
                    for c in scope.c0..=scope.c1 {
                        let base = if by_row { a(r, at.col) } else { a(at.row, c) };
                        let (x, y) = (self.cell_val(sheet, a(r, c)), self.cell_val(sheet, base));
                        if x != y {
                            cells.push(a(r, c));
                        }
                    }
                }
            }
            "precedents" | "dependents" => {
                let levels = if has("direct") { 1 } else { 100 };
                if kind == "precedents" {
                    for ar in self.precedent_arrows(sheet, at, levels) {
                        if ar.from_sheet == sheet {
                            found.push(ar.from);
                        }
                    }
                } else {
                    for ar in self.dependent_arrows(sheet, at, levels) {
                        if ar.to_sheet == sheet {
                            cells.push(ar.to);
                        }
                    }
                }
            }
            "cf" | "validation" => {
                let same = has("same");
                let areas: Vec<Area> = if kind == "cf" {
                    let here: Vec<&crate::cf::Rule> = self.sheets[sheet].rules.iter().filter(|r| r.area.contains(at.row, at.col)).collect();
                    self.sheets[sheet].rules.iter().filter(|r| !same || here.iter().any(|h| h.kind == r.kind && h.style == r.style)).map(|r| r.area).collect()
                } else {
                    let here: Vec<&crate::valid::Validation> = self.sheets[sheet].valid.iter().filter(|v| v.area.contains(at.row, at.col)).collect();
                    self.sheets[sheet].valid.iter().filter(|v| !same || here.iter().any(|h| h.kind == v.kind && h.op == v.op && h.a == v.a && h.b == v.b)).map(|v| v.area).collect()
                };
                found.extend(areas);
            }
            _ => return bad("unknown Go To Special choice"),
        }
        let mut all = found;
        all.extend(ranges_of(cells));
        all.sort_by_key(|o| (o.r0, o.c0));
        all.dedup();
        let count: u64 = all.iter().map(|o| u64::from(o.r1 - o.r0 + 1) * u64::from(o.c1 - o.c0 + 1)).sum();
        if all.is_empty() {
            return Ok((Effect::default(), say("No cells were found.")));
        }
        let lines: Vec<String> = all.iter().take(LIMIT).map(|o| format!("{}\t{}\t{}\t{}", o.r0, o.c0, o.r1, o.c1)).collect();
        Ok((Effect::default(), say(&format!("Found {count} cells in {} ranges.\n{}", all.len(), lines.join("\n")))))
    }
}
