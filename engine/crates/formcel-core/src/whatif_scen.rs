use super::*;
use crate::pivot::{Func, Pivot, Show, ValueField};

impl Workbook {
    pub(super) fn sc_pivot(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let dst = self.sheet_of(&a[0])?;
        let src = self.sheet_of(&a[1])?;
        let scenarios: Vec<Scenario> = self.whatif.scenarios.iter().filter(|s| s.sheet == src).cloned().collect();
        if scenarios.is_empty() {
            return Err("This sheet has no scenarios yet.".to_string());
        }
        let mut results: Vec<Addr> = Vec::new();
        for r in a[2].split(',').filter(|s| !s.trim().is_empty()) {
            let (_, ar) = self.resolve(r, src)?;
            results.extend(cells_of(ar));
        }
        if results.is_empty() {
            return Err("Give at least one result cell.".to_string());
        }
        let mut heads: Vec<String> = Vec::new();
        for c in &results {
            let mut name = self.cell_name((src, *c));
            if name.trim().is_empty() {
                name = to_a1(*c);
            }
            let base = name.clone();
            let mut k = 2;
            while heads.iter().any(|h| h.eq_ignore_ascii_case(&name)) || name.eq_ignore_ascii_case("Scenario") {
                name = format!("{base} {k}");
                k += 1;
            }
            heads.push(name);
        }
        let mut table: Vec<Vec<String>> = vec![std::iter::once("Scenario".to_string()).chain(heads.iter().cloned()).collect()];
        table.push(std::iter::once("Current Values".to_string()).chain(results.iter().map(|c| value_raw(&self.val((src, *c))))).collect());
        for s in &scenarios {
            let sets: Vec<(Key, String)> = s.cells.iter().map(|(ad, raw)| ((src, *ad), raw.clone())).collect();
            let orig: Vec<(Key, String)> = s.cells.iter().map(|(ad, _)| ((src, *ad), self.input(src, *ad))).collect();
            self.temp(&sets);
            table.push(std::iter::once(s.name.clone()).chain(results.iter().map(|c| value_raw(&self.val((src, *c))))).collect());
            self.temp(&orig);
        }
        let mut out = Vec::new();
        for (r, row) in table.iter().enumerate() {
            for (c, text) in row.iter().enumerate() {
                let raw = if r > 0 && c == 0 && !matches!(Value::parse_input(text), Value::Text(_)) { format!("'{text}") } else { text.clone() };
                put(&mut out, r as u32, c as u32, raw);
            }
        }
        self.put_all(dst, &out, fx)?;
        let width = table[0].len() as u32;
        let area = Area { r0: 0, c0: 0, r1: table.len() as u32 - 1, c1: width - 1 };
        let p = Pivot {
            name: String::new(),
            sheet: dst,
            row: table.len() as u32 + 2,
            col: 0,
            src_sheet: dst,
            src: area,
            table: String::new(),
            grand_rows: false,
            grand_cols: false,
            subtotals: false,
            auto: true,
            out: None,
            rows: vec!["Scenario".to_string()],
            cols: Vec::new(),
            values: heads.iter().map(|h| ValueField { field: h.clone(), func: Func::Sum, show: Show::Normal, name: h.clone(), base_field: String::new(), base_item: String::new() }).collect(),
            filters: Vec::new(),
            calc: Vec::new(),
            groups: Vec::new(),
        };
        let e = self.create_pivot(&p.line()).map_err(|e| e.to_string())?;
        *fx = std::mem::take(fx).join(e);
        Ok(format!("ok\t{}", scenarios.len()))
    }
}
