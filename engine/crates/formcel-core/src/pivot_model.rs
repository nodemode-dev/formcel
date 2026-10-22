use super::*;
use crate::dax::{self, Flt, D};
use crate::datamodel::{key_of, CONN_NAME};
use std::collections::HashSet;

pub(super) const MARK: &str = "@model";

pub(super) fn is_model(p: &Pivot) -> bool {
    p.table.starts_with(MARK)
}

fn refused(msg: &str) -> EngineError {
    EngineError::BadStyle(msg.to_string())
}

fn mdx_key(s: &str) -> String {
    s.replace(']', "]]")
}

fn q(s: &str) -> String {
    s.replace('"', "\"\"")
}

fn a1(row: u32, col: u32, abs_row: bool, abs_col: bool) -> String {
    format!("{}{}{}{}", if abs_col { "$" } else { "" }, crate::col_name(col), if abs_row { "$" } else { "" }, row + 1)
}

impl Workbook {
    pub(super) fn model_fields_line(&self) -> String {
        let mut out = format!("0\t0,0,0,0\t{MARK}");
        for (n, num) in self.model.fields() {
            out.push('\t');
            out.push(if num { 'n' } else { 't' });
            escape(&n, &mut out);
        }
        out
    }

    fn model_split(&self, field: &str) -> Option<(usize, usize)> {
        for (ti, t) in self.model.tables.iter().enumerate() {
            if let Some(rest) = field.strip_prefix(&format!("{}.", t.name)) {
                if let Some(ci) = self.model.cidx(ti, rest) {
                    return Some((ti, ci));
                }
            }
        }
        None
    }

    fn model_tables_of(&self, p: &Pivot) -> Vec<usize> {
        let mut out: Vec<usize> = Vec::new();
        let mut push = |t: usize| {
            if !out.contains(&t) {
                out.push(t);
            }
        };
        for f in p.rows.iter().chain(&p.cols).chain(p.filters.iter().map(|x| &x.0)) {
            if let Some((t, _)) = self.model_split(f) {
                push(t);
            }
        }
        for v in &p.values {
            if let Some((t, _)) = self.model_split(&v.field) {
                push(t);
            } else if let Some(m) = v.field.strip_prefix('[').and_then(|x| x.strip_suffix(']')).and_then(|n| self.model.midx(n)) {
                let mut refs = Vec::new();
                if let Some(a) = &self.model.measures[m].ast {
                    dax::refs(a, &mut refs);
                }
                for (t, _) in refs {
                    if let Some(ti) = t.and_then(|n| self.model.tidx(&n)) {
                        push(ti);
                    }
                }
                if let Some(ti) = self.model.tidx(&self.model.measures[m].table) {
                    push(ti);
                }
            }
        }
        out
    }

    fn model_base(&self, p: &Pivot) -> Result<usize, EngineError> {
        if let Some(name) = p.table.strip_prefix(&format!("{MARK}:")) {
            if let Some(t) = self.model.tidx(name) {
                return Ok(t);
            }
        }
        let used = self.model_tables_of(p);
        if self.model.tables.is_empty() {
            return Err(refused("The Data Model has no tables yet. Add a table to the Data Model first."));
        }
        let act: Vec<bool> = self.model.rels.iter().map(|r| r.active).collect();
        let order: Vec<usize> = used.iter().copied().chain(0..self.model.tables.len()).collect();
        order
            .into_iter()
            .find(|&t| used.iter().all(|&u| self.model.reaches(t, u, &act, 0)))
            .ok_or_else(|| refused("Relationships between the tables may be needed. Create or activate a relationship in the Data Model."))
    }

    pub(super) fn model_data(&self, p: &Pivot) -> Result<Data, EngineError> {
        let base = self.model_base(p)?;
        let m = &self.model;
        let n = m.tables[base].rows;
        let mut maps: Vec<(usize, Vec<Option<usize>>)> = vec![(base, (0..n).map(Some).collect())];
        loop {
            let mut grew = false;
            for (ri, r) in m.rels.iter().enumerate() {
                if !r.active || r.err.is_some() || maps.iter().any(|x| x.0 == r.ti) {
                    continue;
                }
                let Some(from) = maps.iter().find(|x| x.0 == r.fi) else { continue };
                let map: Vec<Option<usize>> = from.1.iter().map(|o| o.and_then(|row| m.links[ri][row].map(|k| k as usize))).collect();
                maps.push((r.ti, map));
                grew = true;
            }
            if !grew {
                break;
            }
        }
        let mut names = Vec::new();
        let mut cols: Vec<(usize, usize)> = Vec::new();
        for (t, _) in &maps {
            for (c, col) in m.tables[*t].cols.iter().enumerate() {
                names.push(format!("{}.{}", m.tables[*t].name, col.name));
                cols.push((*t, c));
            }
        }
        let mut vals = Vec::with_capacity(n);
        let mut txt = Vec::with_capacity(n);
        for r in 0..n {
            let mut row = Vec::with_capacity(cols.len());
            let mut tx = Vec::with_capacity(cols.len());
            for (t, c) in &cols {
                let at = maps.iter().find(|x| x.0 == *t).and_then(|x| x.1[r]);
                match at {
                    Some(k) => {
                        row.push(m.tables[*t].cols[*c].data[k].clone());
                        tx.push(m.display(*t, *c, k));
                    }
                    None => {
                        row.push(Value::Empty);
                        tx.push(String::new());
                    }
                }
            }
            vals.push(row);
            txt.push(tx);
        }
        Ok(Data { names, vals, txt })
    }

    pub(super) fn model_meas(&self, field: &str, func: Func) -> Result<(D, String), EngineError> {
        if let Some(name) = field.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            let i = self.model.midx(name).ok_or_else(|| EngineError::BadName(field.to_string()))?;
            return Ok((D::Col(None, self.model.measures[i].name.clone()), self.model.measures[i].name.clone()));
        }
        let (t, c) = self.model_split(field).ok_or_else(|| EngineError::BadName(format!("{field} is not a field of the Data Model")))?;
        let f = match func {
            Func::Sum => "SUM",
            Func::Count => "COUNTA",
            Func::CountNums => "COUNT",
            Func::Average => "AVERAGE",
            Func::Max => "MAX",
            Func::Min => "MIN",
            _ => return Err(refused("Data Model PivotTables summarize with Sum, Count, Average, Max or Min; use a measure for anything else.")),
        };
        let cn = self.model.tables[t].cols[c].name.clone();
        Ok((D::Call(f.into(), vec![D::Col(Some(self.model.tables[t].name.clone()), cn.clone())]), format!("{} of {}", func.label(), cn)))
    }

    fn model_flt(&self, field: &str, texts: &[String]) -> Option<Flt> {
        let (t, c) = self.model_split(field)?;
        let want: HashSet<String> = texts.iter().map(|x| x.to_lowercase()).collect();
        let col = &self.model.tables[t].cols[c].data;
        let keys: HashSet<String> = col.iter().enumerate().filter(|(r, _)| want.contains(&self.model.display(t, c, *r).to_lowercase())).map(|(_, v)| key_of(v)).collect();
        Some(Flt { t, c, keys: keys.into_iter().collect() })
    }

    pub(super) fn model_cell(&self, d: &D, cons: &[(String, Vec<String>)]) -> Result<Option<f64>, ()> {
        let flts: Vec<Flt> = cons.iter().filter_map(|(f, t)| self.model_flt(f, t)).collect();
        match dax::expr(&self.model, d, &flts) {
            Ok(Value::Number(n)) => Ok(Some(n)),
            Ok(Value::Bool(b)) => Ok(Some(f64::from(u8::from(b)))),
            Ok(Value::Empty | Value::Text(_)) => Ok(None),
            _ => Err(()),
        }
    }

    pub(super) fn model_cons(&self, data: &Data, rf: &[usize], rd: &Dim, rpath: &[usize], cf: &[usize], cd: &Dim, cpath: &[usize], filters: &[(String, Vec<String>)]) -> Vec<(String, Vec<String>)> {
        let mut out = Vec::new();
        for (lv, id) in rpath.iter().enumerate() {
            out.push((data.names[rf[lv]].clone(), vec![rd.items[lv][*id].clone()]));
        }
        for (lv, id) in cpath.iter().enumerate() {
            out.push((data.names[cf[lv]].clone(), vec![cd.items[lv][*id].clone()]));
        }
        for (f, items) in filters {
            if !items.is_empty() {
                out.push((f.clone(), items.iter().map(|i| if i == "(blank)" { String::new() } else { i.clone() }).collect()));
            }
        }
        out
    }

    pub(super) fn model_items(&self, field: &str) -> Vec<String> {
        let Some((t, c)) = self.model_split(field) else { return Vec::new() };
        let mut seen = HashSet::new();
        let mut vals: Vec<Value> = Vec::new();
        for v in &self.model.tables[t].cols[c].data {
            if seen.insert(key_of(v)) {
                vals.push(v.clone());
            }
        }
        vals.sort_by(|a, b| match (a == &Value::Empty, b == &Value::Empty) {
            (true, true) => std::cmp::Ordering::Equal,
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => compare(a, b),
        });
        vals.iter().map(|v| shown_label(&v.to_string())).collect()
    }

    fn cube_member(&self, field: &str, item: &str) -> String {
        match self.model_split(field) {
            Some((t, c)) => {
                let (tn, cn) = (&self.model.tables[t].name, &self.model.tables[t].cols[c].name);
                format!("[{}].[{}].&[{}]", mdx_key(tn), mdx_key(cn), mdx_key(if item == "(blank)" { "" } else { item }))
            }
            None => String::new(),
        }
    }

    fn cube_all(&self, field: &str) -> String {
        match self.model_split(field) {
            Some((t, c)) => format!("[{}].[{}].[All]", mdx_key(&self.model.tables[t].name), mdx_key(&self.model.tables[t].cols[c].name)),
            None => String::new(),
        }
    }

    fn cube_formula(&self, f: &str, args: &[String]) -> String {
        let mut out = format!("={f}(\"{CONN_NAME}\"");
        for a in args {
            out.push(',');
            out.push_str(a);
        }
        out.push(')');
        out
    }

    fn lit(&self, s: &str) -> String {
        format!("\"{}\"", q(s))
    }

    fn render_cube(&self, p: &Pivot) -> Result<Vec<Vec<Cl>>, EngineError> {
        let data = self.model_data(p)?;
        let find = |name: &str| data.names.iter().position(|f| f.eq_ignore_ascii_case(name)).ok_or_else(|| EngineError::BadName(format!("{name} is not a field in the Data Model")));
        let rf: Vec<usize> = p.rows.iter().map(|n| find(n)).collect::<Result<_, _>>()?;
        let cf: Vec<usize> = p.cols.iter().map(|n| find(n)).collect::<Result<_, _>>()?;
        let mut meas: Vec<String> = Vec::new();
        for v in &p.values {
            let (_, label_) = self.model_meas(&v.field, v.func)?;
            let caption = if v.name.trim().is_empty() { label_ } else { v.name.trim().to_string() };
            let uname = match v.field.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
                Some(_) => caption.clone(),
                None => self.model_meas(&v.field, v.func)?.1,
            };
            meas.push(uname);
        }
        let keep: Vec<usize> = (0..data.vals.len())
            .filter(|&r| {
                p.filters.iter().all(|(f, items)| {
                    let Ok(fi) = find(f) else { return true };
                    items.is_empty() || items.iter().any(|i| *i == shown_label(&data.txt[r][fi]))
                })
            })
            .collect();
        let rd = dim(&data, &rf, &keep);
        let cd = dim(&data, &cf, &keep);
        let rl = lines(&rd, &keep, p.subtotals, p.grand_rows);
        let cl_ = lines(&cd, &keep, p.subtotals, p.grand_cols);
        let (kr, kc, nv) = (rd.k, cd.k, meas.len());
        let nvc = nv.max(1);
        let width = kr + cl_.len() * nvc;
        let mut out: Vec<Vec<Cl>> = Vec::new();
        let r0 = p.row;
        let c0 = p.col;
        let mut filter_cells: Vec<String> = Vec::new();
        for (f, items) in &p.filters {
            let fi = find(f)?;
            let at = out.len() as u32;
            let short = f.split_once('.').map_or(f.as_str(), |x| x.1).to_string();
            let formula = match items.len() {
                0 => self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_all(f)), self.lit("(All)")]),
                1 => self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_member(f, &items[0]))]),
                _ => {
                    let set = format!("{{{}}}", items.iter().map(|i| self.cube_member(f, i)).collect::<Vec<_>>().join(","));
                    self.cube_formula("CUBESET", &[self.lit(&set), self.lit("(Multiple Items)")])
                }
            };
            let _ = fi;
            out.push(vec![cl(label(&short), 3), cl(formula, 0)]);
            filter_cells.push(a1(r0 + at, c0 + 1, true, true));
        }
        if !p.filters.is_empty() {
            out.push(Vec::new());
        }
        let hrows = if kc > 0 { 1 + kc + usize::from(nv > 1) } else { 1 };
        let h0 = out.len();
        let mut head: Vec<Vec<Cl>> = (0..hrows).map(|_| (0..width).map(|_| cl("", 1)).collect()).collect();
        let last = hrows - 1;
        for (i, &f) in rf.iter().enumerate() {
            head[last][i] = cl(label(data.names[f].split_once('.').map_or(data.names[f].as_str(), |x| x.1)), 1);
        }
        let meas_member = |i: usize| self.cube_formula("CUBEMEMBER", &[self.lit(&format!("[Measures].[{}]", mdx_key(&meas[i])))]);
        let mut corner: Option<String> = None;
        let mut meas_ref_row: Option<u32> = None;
        if kc == 0 {
            meas_ref_row = Some(r0 + h0 as u32);
            for (ci, _) in cl_.iter().enumerate() {
                for v in 0..nv {
                    head[0][kr + ci * nvc + v] = cl(meas_member(v), 1);
                }
            }
        } else {
            if nv == 1 && width > 0 {
                head[0][0] = cl(meas_member(0), 1);
                corner = Some(a1(r0 + h0 as u32, c0, true, true));
            }
            for (ci, (path, kind)) in cl_.iter().enumerate() {
                let x0 = kr + ci * nvc;
                for lv in 0..kc {
                    let f = &data.names[cf[lv]];
                    let put = match kind {
                        K::Grand => (lv == 0).then(|| self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_all(f)), self.lit("Grand Total")])),
                        K::Sub => (lv + 1 == path.len()).then(|| self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_member(f, &cd.items[lv][path[lv]])), self.lit(&format!("{} Total", shown_label(&cd.items[lv][path[lv]])))])),
                        K::Leaf => Some(self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_member(f, &cd.items[lv][path[lv]]))])),
                    };
                    if let Some(t) = put {
                        for v in 0..nvc {
                            head[1 + lv][x0 + v] = cl(t.clone(), 1);
                        }
                    }
                }
                if nv > 1 {
                    for v in 0..nv {
                        head[1 + kc][x0 + v] = cl(meas_member(v), 1);
                    }
                }
            }
            if nv > 1 {
                meas_ref_row = Some(r0 + (h0 + 1 + kc) as u32);
            }
        }
        out.extend(head);
        let first_data = out.len();
        for (ri, (rpath, rkind)) in rl.iter().enumerate() {
            let row_abs = r0 + (first_data + ri) as u32;
            let rtot = *rkind != K::Leaf && rd.k > 0;
            let mut row: Vec<Cl> = (0..kr).map(|_| cl("", if rtot { 2 } else { 0 })).collect();
            let mut row_refs: Vec<String> = Vec::new();
            match rkind {
                K::Grand => {
                    if kr > 0 {
                        row[0] = cl(self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_all(&data.names[rf[0]])), self.lit("Grand Total")]), 2);
                        row_refs.push(a1(row_abs, c0, false, true));
                    }
                }
                K::Sub => {
                    let lv = rpath.len() - 1;
                    let f = &data.names[rf[lv]];
                    row[lv] = cl(self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_member(f, &rd.items[lv][rpath[lv]])), self.lit(&format!("{} Total", shown_label(&rd.items[lv][rpath[lv]])))]), 2);
                    row_refs.push(a1(row_abs, c0 + lv as u32, false, true));
                }
                K::Leaf => {
                    for lv in 0..kr {
                        let f = &data.names[rf[lv]];
                        row[lv] = cl(self.cube_formula("CUBEMEMBER", &[self.lit(&self.cube_member(f, &rd.items[lv][rpath[lv]]))]), 0);
                        row_refs.push(a1(row_abs, c0 + lv as u32, false, true));
                    }
                }
            }
            for (ci, (cpath, ckind)) in cl_.iter().enumerate() {
                let st = if rtot || (*ckind != K::Leaf && cd.k > 0) { 2 } else { 0 };
                if nv == 0 {
                    row.push(cl("", st));
                }
                for v in 0..nv {
                    let x = kr + ci * nvc + v;
                    let col_abs = c0 + x as u32;
                    let mut args: Vec<String> = row_refs.clone();
                    let levels: Vec<usize> = if kc == 0 {
                        Vec::new()
                    } else {
                        match ckind {
                            K::Sub => vec![cpath.len() - 1],
                            K::Grand => vec![0],
                            K::Leaf => (0..kc).collect(),
                        }
                    };
                    for lv in levels {
                        args.push(a1(r0 + (h0 + 1 + lv) as u32, col_abs, true, false));
                    }
                    match (kc, nv) {
                        (0, _) => args.push(a1(meas_ref_row.unwrap_or(r0), col_abs, true, false)),
                        (_, 1) => args.push(corner.clone().unwrap_or_default()),
                        _ => args.push(a1(meas_ref_row.unwrap_or(r0), col_abs, true, false)),
                    }
                    for fc in &filter_cells {
                        args.push(fc.clone());
                    }
                    row.push(Cl { raw: self.cube_formula("CUBEVALUE", &args), st, pct: false, dec: false });
                }
            }
            out.push(row);
        }
        Ok(out)
    }

    pub fn model_pivot_to_formulas(&mut self, name: &str) -> Result<Effect, EngineError> {
        let i = self.find_pivot(name)?;
        let p = self.pivots[i].clone();
        if !is_model(&p) {
            return Err(refused("Convert to Formulas works on PivotTables built from the Data Model."));
        }
        let grid = self.render_cube(&p)?;
        let width = grid.iter().map(Vec::len).max().unwrap_or(1) as u32;
        let height = grid.len() as u32;
        self.check(p.sheet, Addr { row: p.row.saturating_add(height - 1), col: p.col.saturating_add(width - 1) })?;
        let area = Area { r0: p.row, c0: p.col, r1: p.row + height - 1, c1: p.col + width - 1 };
        let before = self.pivots.clone();
        let mark = self.undo_mark();
        let mut out = Effect::default();
        let mut edits: Vec<(Addr, String)> = Vec::new();
        let mut fmts: Vec<(Addr, Option<String>, Option<String>)> = Vec::new();
        if let Some((os, oa)) = p.out {
            if os < self.sheets.len() {
                let mut gone = self.clear_edits(os, oa);
                if os == p.sheet {
                    edits.append(&mut gone);
                } else {
                    self.table_quiet = true;
                    let r = self.apply(os, &gone);
                    self.table_quiet = false;
                    out.cells.extend(r?);
                }
            }
        }
        for (ri, row) in grid.iter().enumerate() {
            for c in 0..width as usize {
                let a = Addr { row: area.r0 + ri as u32, col: area.c0 + c as u32 };
                let (raw, st) = row.get(c).map_or((String::new(), 0), |x| (x.raw.clone(), x.st));
                edits.push((a, raw));
                let style = match st {
                    1 => "b;bg:d9e1f2",
                    2 => "b;bg:f2f2f2",
                    3 => "b",
                    _ => "",
                };
                fmts.push((a, Some(style.to_string()), Some(String::new())));
            }
        }
        self.table_quiet = true;
        let r = self.apply(p.sheet, &edits);
        self.table_quiet = false;
        out.cells.extend(r?);
        for (a, _, f) in fmts.iter_mut() {
            if let Some(crate::Value::Number(n)) = self.sheets[p.sheet].cells.get(*a) {
                if n.fract() != 0.0 {
                    *f = Some("0.00".to_string());
                }
            }
        }
        out = out.join(self.put_formats(p.sheet, &fmts)?);
        self.pivots.remove(i);
        self.record(Tx::Pivots { before, after: self.pivots.clone() });
        self.undo_group(mark);
        out.tables = true;
        Ok(out)
    }
}
