use crate::flash;
use crate::formula::{offset_text, Area};
use crate::wire::{escape, unescape};
use crate::{col_name, Addr, Effect, EngineError, Shift, Tx, Value, Workbook};
use std::collections::{HashMap, HashSet};

mod gotospecial;
mod pastex;
mod series;

type Out = Result<(Effect, String), EngineError>;

fn bad<T>(s: &str) -> Result<T, EngineError> {
    Err(EngineError::BadStyle(s.to_string()))
}

fn area_of(s: &str) -> Option<Area> {
    let n: Vec<u32> = s.split(',').filter_map(|x| x.trim().parse().ok()).collect();
    (n.len() == 4 && n[0] <= n[2] && n[1] <= n[3] && n[2] < crate::MAX_ROWS && n[3] < crate::MAX_COLS).then(|| Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] })
}

fn arg(p: &[String], i: usize) -> &str {
    p.get(i).map_or("", String::as_str)
}

fn flag(p: &[String], i: usize) -> bool {
    arg(p, i) == "1"
}

fn a(row: u32, col: u32) -> Addr {
    Addr { row, col }
}

fn quote(s: &str) -> String {
    if s.starts_with(['=', '\'']) {
        format!("'{s}")
    } else {
        s.to_string()
    }
}

fn say(text: &str) -> String {
    let mut out = String::new();
    escape(text, &mut out);
    out
}

#[derive(Clone, Copy)]
enum Tok {
    Lit(char),
    Any,
    Star,
}

fn tokens(pat: &str, wild: bool) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut it = pat.chars();
    while let Some(c) = it.next() {
        out.push(match c {
            '~' if wild => match it.next() {
                Some(n) => Tok::Lit(n),
                None => Tok::Lit('~'),
            },
            '*' if wild => Tok::Star,
            '?' if wild => Tok::Any,
            c => Tok::Lit(c),
        });
    }
    out
}

fn same_char(x: char, y: char, case: bool) -> bool {
    x == y || (!case && x.to_lowercase().eq(y.to_lowercase()))
}

fn walk(t: &[Tok], h: &[char], case: bool, entire: bool) -> Option<usize> {
    match t.first() {
        None => (!entire || h.is_empty()).then_some(0),
        Some(Tok::Lit(c)) => (h.first().is_some_and(|x| same_char(*x, *c, case))).then(|| walk(&t[1..], &h[1..], case, entire).map(|e| e + 1)).flatten(),
        Some(Tok::Any) => (!h.is_empty()).then(|| walk(&t[1..], &h[1..], case, entire).map(|e| e + 1)).flatten(),
        Some(Tok::Star) => (0..=h.len()).find_map(|k| walk(&t[1..], &h[k..], case, entire).map(|e| e + k)),
    }
}

fn wild_find(hay: &[char], t: &[Tok], case: bool, entire: bool, from: usize) -> Option<(usize, usize)> {
    if t.is_empty() {
        return None;
    }
    if entire {
        return (from == 0).then(|| walk(t, hay, case, true).map(|e| (0, e))).flatten();
    }
    (from..=hay.len()).find_map(|s| walk(t, &hay[s..], case, false).filter(|e| *e > 0).map(|e| (s, s + e)))
}

fn crit_hit(v: &Value, shown: &str, crit: &str) -> bool {
    let c = crit.trim();
    let (op, rest) = [">=", "<=", "<>", ">", "<", "="].iter().find_map(|o| c.strip_prefix(o).map(|r| (*o, r.trim()))).unwrap_or(("", c));
    let blank = matches!(v, Value::Empty) || shown.is_empty();
    if rest.is_empty() {
        return match op {
            "=" => blank,
            "<>" => !blank,
            _ => true,
        };
    }
    let want = Value::parse_input(rest);
    if let (Value::Number(w), Value::Number(x)) = (&want, v) {
        return match op {
            ">" => x > w,
            ">=" => x >= w,
            "<" => x < w,
            "<=" => x <= w,
            "<>" => x != w,
            _ => x == w,
        };
    }
    let hay: Vec<char> = shown.chars().collect();
    match op {
        ">" | ">=" | "<" | "<=" => {
            let (x, w) = (shown.to_lowercase(), rest.to_lowercase());
            !blank && matches!(Value::parse_input(shown), Value::Text(_)) && match op {
                ">" => x > w,
                ">=" => x >= w,
                "<" => x < w,
                _ => x <= w,
            }
        }
        "<>" => wild_find(&hay, &tokens(rest, true), false, true, 0).is_none(),
        "=" => wild_find(&hay, &tokens(rest, true), false, true, 0).is_some(),
        _ => {
            let mut t = tokens(rest, true);
            t.push(Tok::Star);
            wild_find(&hay, &t, false, true, 0).is_some()
        }
    }
}

fn split_text(s: &str, delims: &[char], consecutive: bool, qual: Option<char>) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    let mut quoted = false;
    let mut last_was_delim = false;
    while i < chars.len() {
        let c = chars[i];
        if Some(c) == qual && (quoted || cur.is_empty()) {
            if quoted && chars.get(i + 1) == Some(&c) {
                cur.push(c);
                i += 2;
                continue;
            }
            quoted = !quoted;
            last_was_delim = false;
            i += 1;
            continue;
        }
        if !quoted && delims.contains(&c) {
            if !(consecutive && last_was_delim) {
                out.push(std::mem::take(&mut cur));
            }
            last_was_delim = true;
        } else {
            cur.push(c);
            last_was_delim = false;
        }
        i += 1;
    }
    out.push(cur);
    out
}

fn fixed_text(s: &str, breaks: &[usize]) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut prev = 0;
    for &b in breaks.iter().chain(std::iter::once(&chars.len())) {
        let b = b.min(chars.len());
        if b >= prev {
            out.push(chars[prev..b].iter().collect::<String>().trim_end().to_string());
            prev = b;
        }
    }
    out
}

fn collapse(s: &str) -> String {
    s.replace('\u{a0}', " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

const SUBS: [(&str, u8, &str); 11] = [("sum", 9, "Total"), ("count", 3, "Count"), ("countnums", 2, "Count"), ("average", 1, "Average"), ("max", 4, "Max"), ("min", 5, "Min"), ("product", 6, "Product"), ("stdev", 7, "StdDev"), ("stdevp", 8, "StdDevP"), ("var", 10, "Var"), ("varp", 11, "VarP")];

fn range_of(s: &str) -> Option<(usize, Area)> {
    let n: Vec<u32> = s.split(',').filter_map(|x| x.trim().parse().ok()).collect();
    (n.len() == 5 && n[1] <= n[3] && n[2] <= n[4]).then(|| (n[0] as usize, Area { r0: n[1], c0: n[2], r1: n[3], c1: n[4] }))
}

fn fold(func: &str, vals: &[f64], filled: usize) -> Option<f64> {
    match func {
        "count" => Some(filled as f64),
        _ if vals.is_empty() => None,
        "countnums" => Some(vals.len() as f64),
        "average" => Some(vals.iter().sum::<f64>() / vals.len() as f64),
        "max" => vals.iter().copied().reduce(f64::max),
        "min" => vals.iter().copied().reduce(f64::min),
        _ => Some(vals.iter().sum()),
    }
}

impl Workbook {
    fn txt(&self, sheet: usize, ad: Addr) -> String {
        let v = self.sheets[sheet].cells.get(ad).cloned().unwrap_or(Value::Empty);
        self.shown(sheet, ad, v).to_string()
    }

    fn cell_val(&self, sheet: usize, ad: Addr) -> Value {
        self.sheets[sheet].cells.get(ad).cloned().unwrap_or(Value::Empty)
    }

    fn plain(&self, sheet: usize, ad: Addr) -> String {
        match self.cell_val(sheet, ad) {
            Value::Text(s) => quote(&s),
            v => v.to_string(),
        }
    }

    fn last_row(&self, sheet: usize) -> u32 {
        self.sheets[sheet].cells.extent().map_or(0, |e| e.row)
    }

    fn relocate(&mut self, sheet: usize, moves: &[(Addr, Addr)], clears: &[Addr], offset: bool) -> Result<Effect, EngineError> {
        let mut edits = Vec::new();
        let mut formats = Vec::new();
        for (from, to) in moves {
            let raw = self.input(sheet, *from);
            let raw = if offset && raw.starts_with('=') { offset_text(&raw, i64::from(to.row) - i64::from(from.row), i64::from(to.col) - i64::from(from.col)) } else { raw };
            edits.push((*to, raw));
            let style = self.styles.get(&(sheet, *from)).map(|s| s.0.clone()).unwrap_or_default();
            let code = self.codes.get(&(sheet, *from)).map(|c| c.0.clone()).unwrap_or_default();
            formats.push((*to, Some(style), Some(code)));
        }
        let landed: HashSet<Addr> = moves.iter().map(|m| m.1).collect();
        for c in clears {
            if !landed.contains(c) {
                edits.push((*c, String::new()));
                formats.push((*c, Some(String::new()), Some(String::new())));
            }
        }
        let mut out = Effect { cells: self.apply(sheet, &edits)?, ..Effect::default() };
        out = out.join(self.put_formats(sheet, &formats)?);
        Ok(out)
    }

    fn rewrite_block_refs(&mut self, sheet: usize, b: crate::cellshift::Block) -> Result<Effect, EngineError> {
        let names = self.sheet_names();
        let target = names[sheet].clone();
        let mut per: Vec<Vec<(Addr, String)>> = vec![Vec::new(); names.len()];
        for ((sh, ad), f) in &self.formulas {
            if let Some(mut ast) = f.ast.clone() {
                if crate::cellshift::remap(&mut ast, &names[*sh], &target, b) {
                    per[*sh].push((*ad, format!("={}", crate::formula::to_text(&ast))));
                }
            }
        }
        let mut out = Effect::default();
        for (sh, edits) in per.into_iter().enumerate() {
            if !edits.is_empty() {
                out.cells.extend(self.apply(sh, &edits)?);
            }
        }
        Ok(out)
    }

    pub fn tool(&mut self, sheet: usize, cmd: &str) -> Out {
        if sheet >= self.sheets.len() {
            return Err(EngineError::NoSheet(sheet));
        }
        let p: Vec<String> = cmd.split('\t').map(unescape).collect();
        let mark = self.undo_mark();
        let r = match p[0].as_str() {
            "dedupe" => self.t_dedupe(sheet, &p),
            "textcols" => self.t_textcols(sheet, &p),
            "trim" => self.t_trim(sheet, &p),
            "cleanscan" => self.t_cleanscan(sheet, &p),
            "cleanup" => self.t_cleanup(sheet, &p),
            "consolidate" => self.t_consolidate(sheet, &p),
            "subtotal" => self.t_subtotal(sheet, &p),
            "unsubtotal" => self.t_unsubtotal(sheet, &p),
            "advfilter" => self.t_advfilter(sheet, &p),
            "flash" => self.t_flash(sheet, &p),
            "find" => self.t_find(sheet, &p),
            "shiftcells" => self.t_shiftcells(sheet, &p),
            "checkbox" => self.t_checkbox(sheet, &p),
            "pastespecial" => self.t_paste(sheet, &p),
            "tabletype" => self.t_tabletype(sheet, &p),
            "typecheck" => self.t_typecheck(sheet, &p),
            "complete" => self.t_complete(sheet, &p),
            "mirror" => self.t_mirror(sheet, &p),
            "series" => self.t_series(sheet, &p),
            "pastelayers" => self.t_pastelayers(sheet, &p),
            "gotospecial" => self.t_gotospecial(sheet, &p),
            _ => bad("unknown tool"),
        };
        self.undo_group(mark);
        r
    }

    fn t_dedupe(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let first = area.r0 + u32::from(flag(p, 2));
        let cols: Vec<u32> = arg(p, 3).split(',').filter_map(|x| x.parse().ok()).filter(|c| (area.c0..=area.c1).contains(c)).collect();
        if cols.is_empty() || first > area.r1 {
            return bad("choose at least one column");
        }
        let mut seen = HashSet::new();
        let mut keep = Vec::new();
        for r in first..=area.r1 {
            let key: Vec<String> = cols.iter().map(|c| self.txt(sheet, a(r, *c)).to_lowercase()).collect();
            if seen.insert(key) {
                keep.push(r);
            }
        }
        let total = (area.r1 - first + 1) as usize;
        let removed = total - keep.len();
        if removed == 0 {
            return Ok((Effect::default(), say(&format!("No duplicate values found.\n0\t{total}"))));
        }
        let mut moves = Vec::new();
        for (i, src) in keep.iter().enumerate() {
            let dst = first + i as u32;
            if *src != dst {
                for c in area.c0..=area.c1 {
                    moves.push((a(*src, c), a(dst, c)));
                }
            }
        }
        let mut clears = Vec::new();
        for r in first + keep.len() as u32..=area.r1 {
            for c in area.c0..=area.c1 {
                clears.push(a(r, c));
            }
        }
        let e = self.relocate(sheet, &moves, &clears, true)?;
        Ok((e, say(&format!("{removed} duplicate values found and removed; {} unique values remain.\n{removed}\t{}", keep.len(), keep.len()))))
    }

    fn t_textcols(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        if area.c0 != area.c1 {
            return bad("split one column at a time");
        }
        let fixed = arg(p, 2) == "f";
        let breaks: Vec<usize> = arg(p, 3).split(',').filter_map(|x| x.trim().parse().ok()).collect();
        let delims: Vec<char> = arg(p, 3).chars().collect();
        let consecutive = flag(p, 4);
        let qual = arg(p, 5).chars().next();
        let dest: Vec<u32> = arg(p, 6).split(',').filter_map(|x| x.parse().ok()).collect();
        let (dr, dc) = if dest.len() == 2 { (dest[0], dest[1]) } else { (area.r0, area.c0 + 1) };
        if !fixed && delims.is_empty() {
            return bad("choose a delimiter");
        }
        let mut edits = Vec::new();
        let mut width = 0;
        for r in area.r0..=area.r1 {
            let s = self.txt(sheet, a(r, area.c0));
            if s.is_empty() {
                continue;
            }
            let parts = if fixed { fixed_text(&s, &breaks) } else { split_text(&s, &delims, consecutive, qual) };
            width = width.max(parts.len());
            for (i, part) in parts.into_iter().enumerate() {
                let col = dc + i as u32;
                if col >= crate::MAX_COLS {
                    return bad("the split runs past the last column");
                }
                edits.push((a(dr + (r - area.r0), col), quote(part.trim_start_matches(|c| fixed && c == '\u{0}'))));
            }
        }
        let n = edits.len();
        let cells = self.apply(sheet, &edits)?;
        Ok((Effect { cells, ..Effect::default() }, say(&format!("Split into {width} columns ({n} cells written)."))))
    }

    fn t_trim(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let mut edits = Vec::new();
        let last = area.r1.min(self.last_row(sheet));
        self.sheets[sheet].cells.for_each_in(a(area.r0, area.c0), a(last, area.c1), |ad, v| {
            if let Value::Text(s) = v {
                let t = collapse(s);
                if &t != s {
                    edits.push((ad, t));
                }
            }
        });
        edits.retain(|(ad, _)| !self.formulas.contains_key(&(sheet, *ad)));
        let n = edits.len();
        let edits: Vec<(Addr, String)> = edits.into_iter().map(|(ad, t)| (ad, quote(&t))).collect();
        let cells = self.apply(sheet, &edits)?;
        Ok((Effect { cells, ..Effect::default() }, say(&format!("Trimmed {n} cells."))))
    }

    fn text_cells(&self, sheet: usize, area: Area) -> Vec<(Addr, String)> {
        let mut out = Vec::new();
        let last = area.r1.min(self.last_row(sheet));
        self.sheets[sheet].cells.for_each_in(a(area.r0, area.c0), a(last, area.c1), |ad, v| {
            if let Value::Text(s) = v {
                out.push((ad, s.clone()));
            }
        });
        out.retain(|(ad, _)| !self.formulas.contains_key(&(sheet, *ad)));
        out.sort_by_key(|(ad, _)| (ad.col, ad.row));
        out
    }

    fn case_fixes(&self, sheet: usize, area: Area, first: u32) -> Vec<(Addr, String)> {
        let mut by_col: HashMap<u32, Vec<(Addr, String)>> = HashMap::new();
        for (ad, s) in self.text_cells(sheet, area) {
            if ad.row >= first {
                by_col.entry(ad.col).or_default().push((ad, s));
            }
        }
        let mut out = Vec::new();
        for list in by_col.values() {
            let mut groups: HashMap<String, Vec<&(Addr, String)>> = HashMap::new();
            for item in list {
                groups.entry(collapse(&item.1).to_lowercase()).or_default().push(item);
            }
            for g in groups.values() {
                let mut counts: Vec<(String, usize)> = Vec::new();
                for item in g {
                    match counts.iter_mut().find(|(s, _)| *s == item.1) {
                        Some(c) => c.1 += 1,
                        None => counts.push((item.1.clone(), 1)),
                    }
                }
                if counts.len() < 2 {
                    continue;
                }
                let best = counts.iter().fold(&counts[0], |b, c| if c.1 > b.1 { c } else { b }).0.clone();
                for item in g {
                    if item.1 != best {
                        out.push((item.0, best.clone()));
                    }
                }
            }
        }
        out.sort_by_key(|(ad, _)| (ad.col, ad.row));
        out
    }

    fn t_cleanscan(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let first = area.r0 + u32::from(flag(p, 2));
        let cells = self.text_cells(sheet, area);
        let spaces = cells.iter().filter(|(ad, s)| ad.row >= first && collapse(s) != *s).count();
        let numtext = cells.iter().filter(|(ad, s)| ad.row >= first && matches!(Value::parse_input(s.trim()), Value::Number(_)) && !s.trim().is_empty()).count();
        let case = self.case_fixes(sheet, area, first).len();
        let mut seen = HashSet::new();
        let mut dups = 0;
        for r in first..=area.r1.min(self.last_row(sheet)) {
            let key: Vec<String> = (area.c0..=area.c1).map(|c| self.txt(sheet, a(r, c)).to_lowercase()).collect();
            if key.iter().all(String::is_empty) {
                continue;
            }
            if !seen.insert(key) {
                dups += 1;
            }
        }
        Ok((Effect::default(), say(&format!("scan\ntrim\t{spaces}\ncase\t{case}\nnumtext\t{numtext}\ndups\t{dups}"))))
    }

    fn t_cleanup(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let header = flag(p, 2);
        let first = area.r0 + u32::from(header);
        let mut out = Effect::default();
        let mut notes = Vec::new();
        if flag(p, 3) {
            let (e, _) = self.t_trim(sheet, &["trim".into(), arg(p, 1).into()])?;
            notes.push(format!("{} cells trimmed", e.cells.len()));
            out = out.join(e);
        }
        if flag(p, 5) {
            let fixes = self.case_fixes(sheet, area, first);
            let n = fixes.len();
            let cells = self.apply(sheet, &fixes.into_iter().map(|(ad, s)| (ad, quote(&s))).collect::<Vec<_>>())?;
            out = out.join(Effect { cells, ..Effect::default() });
            notes.push(format!("{n} cells given consistent case"));
        }
        if flag(p, 6) {
            let nums: Vec<(Addr, String)> = self.text_cells(sheet, area).into_iter().filter(|(ad, s)| ad.row >= first && matches!(Value::parse_input(s.trim()), Value::Number(_))).map(|(ad, s)| (ad, s.trim().to_string())).collect();
            let n = nums.len();
            let cells = self.apply(sheet, &nums)?;
            out = out.join(Effect { cells, ..Effect::default() });
            notes.push(format!("{n} text numbers converted"));
        }
        if flag(p, 4) {
            let cols: Vec<String> = (area.c0..=area.c1).map(|c| c.to_string()).collect();
            let (e, msg) = self.t_dedupe(sheet, &["dedupe".into(), arg(p, 1).into(), if header { "1" } else { "0" }.into(), cols.join(",")])?;
            out = out.join(e);
            notes.push(unescape(msg.lines().next().unwrap_or("")).trim_end_matches('.').to_string());
        }
        let text = if notes.is_empty() { "Nothing to clean up.".to_string() } else { format!("{}.", notes.join("; ")) };
        Ok((out, say(&text)))
    }

    fn t_consolidate(&mut self, sheet: usize, p: &[String]) -> Out {
        let func = arg(p, 1).to_string();
        let by_label = arg(p, 2) == "labels";
        let (top, left) = (flag(p, 3), flag(p, 4));
        let (dr, dc): (u32, u32) = (arg(p, 5).parse().unwrap_or(0), arg(p, 6).parse().unwrap_or(0));
        let ranges: Vec<(usize, Area)> = arg(p, 7).split(';').filter_map(range_of).collect();
        if ranges.is_empty() {
            return bad("add at least one range");
        }
        for (s, _) in &ranges {
            if *s >= self.sheets.len() {
                return Err(EngineError::NoSheet(*s));
            }
        }
        let mut edits = Vec::new();
        let num = |wb: &Workbook, s: usize, ad: Addr| -> (Option<f64>, bool) {
            match wb.cell_val(s, ad) {
                Value::Number(n) => (Some(n), true),
                Value::Empty => (None, false),
                _ => (None, true),
            }
        };
        if !by_label {
            let (_, f) = ranges[0];
            for r in 0..=(f.r1 - f.r0) {
                for c in 0..=(f.c1 - f.c0) {
                    let mut vals = Vec::new();
                    let mut filled = 0;
                    for (s, ar) in &ranges {
                        if ar.r0 + r <= ar.r1 && ar.c0 + c <= ar.c1 {
                            let (n, fl) = num(self, *s, a(ar.r0 + r, ar.c0 + c));
                            vals.extend(n);
                            filled += usize::from(fl);
                        }
                    }
                    if let Some(v) = fold(&func, &vals, filled) {
                        edits.push((a(dr + r, dc + c), Value::Number(v).to_string()));
                    }
                }
            }
        } else {
            let mut rows: Vec<String> = Vec::new();
            let mut cols: Vec<String> = Vec::new();
            let mut cellvals: HashMap<(usize, usize), (Vec<f64>, usize)> = HashMap::new();
            for (s, ar) in &ranges {
                let (r0, c0) = (ar.r0 + u32::from(top), ar.c0 + u32::from(left));
                for r in r0..=ar.r1 {
                    let rl = if left { self.txt(*s, a(r, ar.c0)) } else { format!("#{}", r - r0) };
                    let ri = rows.iter().position(|x| x.eq_ignore_ascii_case(&rl)).unwrap_or_else(|| {
                        rows.push(rl.clone());
                        rows.len() - 1
                    });
                    for c in c0..=ar.c1 {
                        let cl = if top { self.txt(*s, a(ar.r0, c)) } else { format!("#{}", c - c0) };
                        let ci = cols.iter().position(|x| x.eq_ignore_ascii_case(&cl)).unwrap_or_else(|| {
                            cols.push(cl.clone());
                            cols.len() - 1
                        });
                        let (n, fl) = num(self, *s, a(r, c));
                        let e = cellvals.entry((ri, ci)).or_default();
                        e.0.extend(n);
                        e.1 += usize::from(fl);
                    }
                }
            }
            let (ro, co) = (u32::from(top), u32::from(left));
            if top {
                for (j, l) in cols.iter().enumerate() {
                    edits.push((a(dr, dc + co + j as u32), quote(l)));
                }
            }
            for (i, l) in rows.iter().enumerate() {
                if left {
                    edits.push((a(dr + ro + i as u32, dc), quote(l)));
                }
                for j in 0..cols.len() {
                    if let Some((vals, filled)) = cellvals.get(&(i, j)) {
                        if let Some(v) = fold(&func, vals, *filled) {
                            edits.push((a(dr + ro + i as u32, dc + co + j as u32), Value::Number(v).to_string()));
                        }
                    }
                }
            }
        }
        let n = edits.len();
        let cells = self.apply(sheet, &edits)?;
        Ok((Effect { cells, ..Effect::default() }, say(&format!("Consolidated {} ranges into {n} cells.", ranges.len()))))
    }

    fn strip_subtotals(&mut self, sheet: usize, area: Area, header: bool, gc: u32, shifts: &mut Vec<Shift>) -> Result<u32, EngineError> {
        let first = area.r0 + u32::from(header);
        let mut removed = 0;
        for r in (first..=area.r1).rev() {
            let label = self.txt(sheet, a(r, gc));
            let tagged = label.ends_with(" Total") || label == "Grand Total" || SUBS.iter().any(|s| label.ends_with(&format!(" {}", s.2)));
            let has = (area.c0..=area.c1).any(|c| self.formula_text(sheet, a(r, c)).is_some_and(|f| f.to_uppercase().starts_with("=SUBTOTAL(")));
            if tagged && has {
                shifts.push(self.delete(sheet, true, r, 1)?);
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn with_shifts(mut out: Effect, shifts: Vec<Shift>) -> Effect {
        let mut it = shifts;
        out.shift = it.pop();
        out.more = it;
        out
    }

    fn t_unsubtotal(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let mut shifts = Vec::new();
        let n = self.strip_subtotals(sheet, area, flag(p, 2), arg(p, 3).parse().unwrap_or(area.c0), &mut shifts)?;
        let first = area.r0 + u32::from(flag(p, 2));
        Ok((Self::with_shifts(Effect::default(), shifts), say(&format!("Removed {n} subtotal rows.\nclear\t{first}\t{}", area.r1.saturating_sub(n)))))
    }

    fn t_subtotal(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(mut area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let header = flag(p, 2);
        let Ok(gc) = arg(p, 3).parse::<u32>() else { return bad("choose a column to group by") };
        let Some(&(_, fnum, word)) = SUBS.iter().find(|s| s.0 == arg(p, 4)) else { return bad("unknown function") };
        let cols: Vec<u32> = arg(p, 5).split(',').filter_map(|x| x.parse().ok()).collect();
        if cols.is_empty() || gc < area.c0 || gc > area.c1 {
            return bad("choose the columns to subtotal");
        }
        let mut shifts = Vec::new();
        if flag(p, 6) {
            let n = self.strip_subtotals(sheet, area, header, gc, &mut shifts)?;
            area.r1 = area.r1.saturating_sub(n);
        }
        let first = area.r0 + u32::from(header);
        if first > area.r1 {
            return bad("no data rows");
        }
        let mut groups: Vec<(u32, u32, String)> = Vec::new();
        for r in first..=area.r1 {
            let t = self.txt(sheet, a(r, gc));
            match groups.last_mut() {
                Some(g) if g.2 == t => g.1 = r,
                _ => groups.push((r, r, t)),
            }
        }
        let g = groups.len() as u32;
        for (j, grp) in groups.iter().enumerate().rev() {
            let n = if j + 1 == groups.len() { 2 } else { 1 };
            shifts.push(self.insert(sheet, true, grp.1 + 1, n)?);
        }
        let mut edits = Vec::new();
        let mut lines = Vec::new();
        let label = |s: &str| if s.is_empty() { "Total".to_string() } else { s.to_string() };
        for (j, (s, e, v)) in groups.iter().enumerate() {
            let j = j as u32;
            let (sf, ef, tr) = (s + j, e + j, e + 1 + j);
            edits.push((a(tr, gc), format!("{} {word}", label(v))));
            for c in &cols {
                let cn = col_name(*c);
                edits.push((a(tr, *c), format!("=SUBTOTAL({fnum},{cn}{}:{cn}{})", sf + 1, ef + 1)));
            }
            lines.push(format!("g\t{sf}\t{ef}"));
        }
        let grand = area.r1 + g + 1;
        edits.push((a(grand, gc), format!("Grand {word}")));
        for c in &cols {
            let cn = col_name(*c);
            edits.push((a(grand, *c), format!("=SUBTOTAL({fnum},{cn}{}:{cn}{})", first + 1, grand)));
        }
        let cells = self.apply(sheet, &edits)?;
        let out = Self::with_shifts(Effect { cells, ..Effect::default() }, shifts);
        Ok((out, say(&format!("Added {} subtotals and a grand total.\nclear\t{first}\t{}\n{}", g, grand, lines.join("\n")))))
    }

    fn t_advfilter(&mut self, sheet: usize, p: &[String]) -> Out {
        let (Some(list), Some(crit)) = (area_of(arg(p, 1)), area_of(arg(p, 2))) else { return bad("bad range") };
        let copy = arg(p, 3) == "copy";
        let unique = flag(p, 5);
        let headers: Vec<String> = (list.c0..=list.c1).map(|c| self.txt(sheet, a(list.r0, c)).to_lowercase()).collect();
        let mut maps: Vec<Option<u32>> = Vec::new();
        for c in crit.c0..=crit.c1 {
            let h = self.txt(sheet, a(crit.r0, c)).to_lowercase();
            maps.push(headers.iter().position(|x| *x == h).map(|i| list.c0 + i as u32).filter(|_| !h.is_empty()));
        }
        let mut hits = Vec::new();
        let mut seen = HashSet::new();
        for r in list.r0 + 1..=list.r1 {
            let ok = crit.r1 == crit.r0
                || (crit.r0 + 1..=crit.r1).any(|cr| {
                    (crit.c0..=crit.c1).all(|cc| {
                        let text = self.txt(sheet, a(cr, cc));
                        let Some(col) = maps[(cc - crit.c0) as usize] else { return true };
                        text.trim().is_empty() || crit_hit(&self.cell_val(sheet, a(r, col)), &self.txt(sheet, a(r, col)), &text)
                    })
                });
            if !ok {
                continue;
            }
            if unique {
                let key: Vec<String> = (list.c0..=list.c1).map(|c| self.txt(sheet, a(r, c)).to_lowercase()).collect();
                if !seen.insert(key) {
                    continue;
                }
            }
            hits.push(r);
        }
        if copy {
            let dest: Vec<u32> = arg(p, 4).split(',').filter_map(|x| x.parse().ok()).collect();
            if dest.len() != 2 {
                return bad("choose where to copy the results");
            }
            let mut edits = Vec::new();
            let rows: Vec<u32> = std::iter::once(list.r0).chain(hits.iter().copied()).collect();
            for (i, r) in rows.iter().enumerate() {
                for c in list.c0..=list.c1 {
                    let raw = self.plain(sheet, a(*r, c));
                    if !raw.is_empty() {
                        edits.push((a(dest[0] + i as u32, dest[1] + (c - list.c0)), raw));
                    }
                }
            }
            let cells = self.apply(sheet, &edits)?;
            return Ok((Effect { cells, ..Effect::default() }, say(&format!("Copied {} records.", hits.len()))));
        }
        let keep: HashSet<u32> = hits.iter().copied().collect();
        let hidden: Vec<u32> = (list.r0 + 1..=list.r1).filter(|r| !keep.contains(r)).collect();
        let after = Some(crate::filter::Filter { area: list, cols: Vec::new(), hidden });
        let before = std::mem::replace(&mut self.sheets[sheet].filter, after.clone());
        if before != after {
            self.record(Tx::Filter { sheet, before, after });
        }
        Ok((Effect { filter: Some(sheet), ..Effect::default() }, say(&format!("{} of {} records found.", hits.len(), list.r1 - list.r0))))
    }

    fn t_flash(&mut self, sheet: usize, p: &[String]) -> Out {
        let (Ok(row), Ok(col)) = (arg(p, 1).parse::<u32>(), arg(p, 2).parse::<u32>()) else { return bad("bad cell") };
        let side = |range: Vec<u32>| -> Vec<u32> { range.into_iter().filter(|c| *c < crate::MAX_COLS).collect() };
        let left: Vec<u32> = side((col.saturating_sub(5)..col).collect());
        let right: Vec<u32> = side((col + 1..=col + 5).collect());
        let last = self.last_row(sheet);
        let has = |wb: &Workbook, cols: &[u32], r: u32| cols.iter().any(|c| !matches!(wb.cell_val(sheet, a(r, *c)), Value::Empty));
        let srcs = if left.iter().any(|c| !matches!(self.cell_val(sheet, a(row, *c)), Value::Empty)) || row > last { left } else { right };
        let mut r0 = row;
        while r0 > 0 && has(self, &srcs, r0 - 1) {
            r0 -= 1;
        }
        let mut r1 = row;
        while r1 < last && has(self, &srcs, r1 + 1) {
            r1 += 1;
        }
        let sources = |wb: &Workbook, r: u32| -> Vec<(usize, String)> { srcs.iter().map(|c| (*c as usize, wb.txt(sheet, a(r, *c)))).filter(|(_, s)| !s.is_empty()).collect() };
        let mut examples = Vec::new();
        for r in r0..=r1 {
            let want = self.txt(sheet, a(r, col));
            if !want.is_empty() {
                examples.push((sources(self, r), want));
            }
        }
        if examples.is_empty() {
            return bad("type an example of the result in the cell first");
        }
        let Some(prog) = flash::infer(&examples) else { return bad("Flash Fill could not find a pattern in your examples") };
        let mut edits = Vec::new();
        for r in r0..=r1 {
            if matches!(self.cell_val(sheet, a(r, col)), Value::Empty) {
                if let Some(v) = prog.run(&sources(self, r)) {
                    edits.push((a(r, col), quote(&v)));
                }
            }
        }
        let n = edits.len();
        let cells = self.apply(sheet, &edits)?;
        Ok((Effect { cells, ..Effect::default() }, say(&format!("Flash Fill filled {n} cells."))))
    }

    fn t_find(&mut self, sheet: usize, p: &[String]) -> Out {
        let (query, repl) = (arg(p, 1).to_string(), arg(p, 2).to_string());
        let (case, entire, formulas, book) = (flag(p, 3), flag(p, 4), flag(p, 5), flag(p, 6));
        let mode = arg(p, 7).to_string();
        let within = area_of(arg(p, 8));
        let only: Option<(usize, u32, u32)> = {
            let n: Vec<u32> = arg(p, 9).split(',').filter_map(|x| x.parse().ok()).collect();
            (n.len() == 3).then(|| (n[0] as usize, n[1], n[2]))
        };
        if query.is_empty() {
            return bad("type something to find");
        }
        let t = tokens(&query, true);
        let sheets: Vec<usize> = if book { (0..self.sheets.len()).collect() } else { vec![sheet] };
        let mut found: Vec<(usize, Addr)> = Vec::new();
        for s in sheets {
            let Some(end) = self.sheets[s].cells.extent() else { continue };
            let (top, bottom) = within.filter(|_| s == sheet).map_or((a(0, 0), end), |w| (a(w.r0, w.c0), a(w.r1.min(end.row), w.c1.min(end.col))));
            let mut cells = Vec::new();
            self.sheets[s].cells.for_each_in(top, bottom, |ad, _| cells.push(ad));
            cells.sort_by_key(|ad| (ad.row, ad.col));
            for ad in cells {
                let text = if formulas { self.input(s, ad) } else { self.txt(s, ad) };
                let hay: Vec<char> = text.chars().collect();
                if wild_find(&hay, &t, case, entire, 0).is_some() {
                    found.push((s, ad));
                }
            }
        }
        if mode == "find" {
            let lines: Vec<String> = found.iter().map(|(s, ad)| format!("{s}\t{}\t{}\t{}", ad.row, ad.col, say(&if formulas { self.input(*s, *ad) } else { self.txt(*s, *ad) }))).collect();
            return Ok((Effect::default(), say(&format!("{} found\n{}", lines.len(), lines.join("\n")))));
        }
        let targets: Vec<(usize, Addr)> = match only {
            Some((s, r, c)) if mode == "replace" => found.into_iter().filter(|(fs, ad)| *fs == s && ad.row == r && ad.col == c).collect(),
            _ => found,
        };
        let mut by_sheet: Vec<(usize, Vec<(Addr, String)>)> = Vec::new();
        let mut count = 0;
        for (s, ad) in targets {
            if !formulas && self.formulas.contains_key(&(s, ad)) {
                continue;
            }
            let text = if formulas { self.input(s, ad) } else { self.txt(s, ad) };
            let hay: Vec<char> = text.chars().collect();
            let mut out = String::new();
            let mut pos = 0;
            if entire {
                out = repl.clone();
                count += 1;
            } else {
                while let Some((st, en)) = wild_find(&hay, &t, case, false, pos) {
                    out.extend(&hay[pos..st]);
                    out.push_str(&repl);
                    pos = en;
                    count += 1;
                }
                out.extend(&hay[pos..]);
            }
            let raw = if formulas { out } else { quote(&out) };
            match by_sheet.iter_mut().find(|e| e.0 == s) {
                Some(e) => e.1.push((ad, raw)),
                None => by_sheet.push((s, vec![(ad, raw)])),
            }
        }
        let mut out = Effect::default();
        for (s, edits) in by_sheet {
            out.cells.extend(self.apply(s, &edits)?);
        }
        Ok((out, say(&format!("Replaced {count} occurrences."))))
    }

    fn t_shiftcells(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let dir = arg(p, 2).to_string();
        let insert = flag(p, 3);
        let Some(end) = self.sheets[sheet].cells.extent() else { return Ok((Effect::default(), say("Nothing to shift."))) };
        let (h, w) = (area.r1 - area.r0 + 1, area.c1 - area.c0 + 1);
        let vertical = dir == "down" || dir == "up";
        let mut cells: Vec<Addr> = Vec::new();
        let (top, bottom) = if vertical { (a(area.r0, area.c0), a(end.row.max(area.r1), area.c1)) } else { (a(area.r0, area.c0), a(area.r1, end.col.max(area.c1))) };
        self.sheets[sheet].cells.for_each_in(top, bottom, |ad, _| cells.push(ad));
        let (mut moves, mut clears) = (Vec::new(), Vec::new());
        let max_r = crate::MAX_ROWS;
        let max_c = crate::MAX_COLS;
        for ad in cells {
            let to = match (dir.as_str(), insert) {
                ("down", true) if ad.row >= area.r0 => Some(a(ad.row + h, ad.col)),
                ("right", true) if ad.col >= area.c0 => Some(a(ad.row, ad.col + w)),
                ("up", false) if ad.row > area.r1 => Some(a(ad.row - h, ad.col)),
                ("left", false) if ad.col > area.c1 => Some(a(ad.row, ad.col - w)),
                _ => None,
            };
            let inside = ad.row >= area.r0 && ad.row <= area.r1 && ad.col >= area.c0 && ad.col <= area.c1;
            match to {
                Some(t) if t.row < max_r && t.col < max_c => {
                    moves.push((ad, t));
                    clears.push(ad);
                }
                Some(_) => clears.push(ad),
                None if !insert && inside => clears.push(ad),
                None => {}
            }
        }
        if insert {
            for r in area.r0..=area.r1 {
                for c in area.c0..=area.c1 {
                    clears.push(a(r, c));
                }
            }
        }
        let mut e = self.relocate(sheet, &moves, &clears, false)?;
        e = e.join(self.rewrite_block_refs(sheet, crate::cellshift::Block { area, vertical, insert })?);
        Ok((e, say(&format!("Shifted {} cells.", moves.len()))))
    }

    fn t_checkbox(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let on = flag(p, 2);
        let mut out = self.set_validation(sheet, area, if on { "checkbox\t\t\t\tb\tstop" } else { "" })?;
        if on {
            let mut edits = Vec::new();
            let last = area.r1.min(area.r0 + 20_000);
            for r in area.r0..=last {
                for c in area.c0..=area.c1 {
                    if matches!(self.cell_val(sheet, a(r, c)), Value::Empty) {
                        edits.push((a(r, c), "FALSE".to_string()));
                    }
                }
            }
            out.cells.extend(self.apply(sheet, &edits)?);
        }
        Ok((out, say(if on { "Checkboxes inserted." } else { "Checkboxes removed." })))
    }

    fn t_paste(&mut self, sheet: usize, p: &[String]) -> Out {
        let (Some(src), Ok(dr), Ok(dc)) = (area_of(arg(p, 1)), arg(p, 2).parse::<u32>(), arg(p, 3).parse::<u32>()) else { return bad("bad range") };
        let what = arg(p, 4).to_string();
        let op = arg(p, 5).to_string();
        let skip = flag(p, 6);
        let transpose = flag(p, 7);
        let ss = arg(p, 8).parse::<usize>().ok().filter(|s| *s < self.sheets.len()).unwrap_or(sheet);
        let (h, w) = (src.r1 - src.r0 + 1, src.c1 - src.c0 + 1);
        let mut edits = Vec::new();
        let mut formats = Vec::new();
        for r in 0..h {
            for c in 0..w {
                let from = a(src.r0 + r, src.c0 + c);
                let to = if transpose { a(dr + c, dc + r) } else { a(dr + r, dc + c) };
                if to.row >= crate::MAX_ROWS || to.col >= crate::MAX_COLS {
                    continue;
                }
                let src_empty = matches!(self.cell_val(ss, from), Value::Empty);
                if skip && src_empty {
                    continue;
                }
                if matches!(what.as_str(), "all" | "values" | "formulas" | "validation" | "comments") || what.is_empty() {
                    let mut raw = match what.as_str() {
                        "values" => self.plain(ss, from),
                        _ => {
                            let r0 = self.input(ss, from);
                            if r0.starts_with('=') && !transpose { offset_text(&r0, i64::from(to.row) - i64::from(from.row), i64::from(to.col) - i64::from(from.col)) } else { r0 }
                        }
                    };
                    if !op.is_empty() && op != "none" {
                        let a0 = match self.cell_val(sheet, to) {
                            Value::Number(n) => Some(n),
                            Value::Empty => Some(0.0),
                            _ => None,
                        };
                        let b0 = match self.cell_val(ss, from) {
                            Value::Number(n) => Some(n),
                            Value::Empty => Some(0.0),
                            _ => None,
                        };
                        if let (Some(x), Some(y)) = (a0, b0) {
                            let v = match op.as_str() {
                                "add" => x + y,
                                "subtract" => x - y,
                                "multiply" => x * y,
                                "divide" => {
                                    if y == 0.0 {
                                        f64::NAN
                                    } else {
                                        x / y
                                    }
                                }
                                _ => y,
                            };
                            raw = if v.is_nan() { "#DIV/0!".into() } else { Value::Number(v).to_string() };
                        } else {
                            continue;
                        }
                    }
                    edits.push((to, raw));
                }
                if matches!(what.as_str(), "all" | "formats" | "") {
                    let style = self.styles.get(&(ss, from)).map(|s| s.0.clone()).unwrap_or_default();
                    let code = self.codes.get(&(ss, from)).map(|c| c.0.clone()).unwrap_or_default();
                    formats.push((to, Some(style), Some(code)));
                }
            }
        }
        let mut out = Effect { cells: self.apply(sheet, &edits)?, ..Effect::default() };
        if !formats.is_empty() {
            out = out.join(self.put_formats(sheet, &formats)?);
        }
        Ok((out, say(&format!("Pasted {} cells.", edits.len().max(formats.len())))))
    }

    fn t_tabletype(&mut self, _sheet: usize, p: &[String]) -> Out {
        let name = arg(p, 1);
        let Some(i) = self.tables.iter().position(|t| t.name.eq_ignore_ascii_case(name)) else { return Err(EngineError::BadName(name.into())) };
        let Ok(col) = arg(p, 2).parse::<usize>() else { return bad("bad column") };
        let kind = arg(p, 3).to_string();
        let mut t = self.tables[i].clone();
        if col >= t.cols.len() {
            return bad("bad column");
        }
        t.types.resize(t.cols.len(), String::new());
        t.types[col] = kind.clone();
        let line = t.line();
        let line = line.splitn(2, '\t').nth(1).unwrap_or("").to_string();
        let sheet = t.sheet;
        let (d0, d1) = t.data();
        let ca = Area { r0: d0, c0: t.area.c0 + col as u32, r1: d1, c1: t.area.c0 + col as u32 };
        let mark = self.undo_mark();
        let mut out = self.set_table(name, &line)?;
        let (base, rest) = kind.split_once(':').unwrap_or((kind.as_str(), ""));
        let rule = match base {
            "checkbox" => Some("checkbox\t\t\t\tb\tstop".to_string()),
            "dropdown" => Some(format!("list\t\t{}\t\tbd\tstop", rest.replace('|', ","))),
            "" | "text" | "number" | "date" => Some(String::new()),
            _ => None,
        };
        if let Some(r) = rule {
            out = out.join(self.set_validation(sheet, ca, &r)?);
        }
        if base == "checkbox" {
            let mut edits = Vec::new();
            for r in d0..=d1 {
                if matches!(self.cell_val(sheet, a(r, ca.c0)), Value::Empty) {
                    edits.push((a(r, ca.c0), "FALSE".to_string()));
                }
            }
            out.cells.extend(self.apply(sheet, &edits)?);
        }
        self.undo_group(mark);
        Ok((out, say("Column type set.")))
    }

    fn t_typecheck(&mut self, sheet: usize, p: &[String]) -> Out {
        let (Ok(row), Ok(col)) = (arg(p, 1).parse::<u32>(), arg(p, 2).parse::<u32>()) else { return bad("bad cell") };
        let raw = arg(p, 3);
        let ok = Ok((Effect::default(), String::new()));
        let Some(t) = self.table_at(sheet, a(row, col)) else { return ok };
        let (d0, d1) = t.data();
        if row < d0 || row > d1 || raw.is_empty() {
            return ok;
        }
        let kind = t.types.get((col - t.area.c0) as usize).cloned().unwrap_or_default();
        let head = t.cols.get((col - t.area.c0) as usize).cloned().unwrap_or_default();
        if raw.starts_with('=') {
            return ok;
        }
        let (v, fmt) = Value::parse_with_fmt(raw);
        let fits = match kind.split(':').next().unwrap_or("") {
            "number" => matches!(v, Value::Number(_)) && !fmt.is_some_and(|f| f.is_date()),
            "date" => matches!(v, Value::Number(_)) && fmt.is_some_and(|f| f.is_date()),
            "checkbox" => matches!(v, Value::Bool(_)),
            _ => true,
        };
        let msg = if fits { String::new() } else { format!("Column {head} expects a {} value.", kind.split(':').next().unwrap_or("")) };
        Ok((Effect::default(), say(&msg)))
    }

    fn t_complete(&mut self, sheet: usize, p: &[String]) -> Out {
        let (Ok(row), Ok(col)) = (arg(p, 1).parse::<u32>(), arg(p, 2).parse::<u32>()) else { return bad("bad cell") };
        let typed = arg(p, 3);
        if typed.is_empty() || typed.starts_with(['=', '\'']) || !matches!(Value::parse_input(typed), Value::Text(_)) {
            return Ok((Effect::default(), String::new()));
        }
        let lower = typed.to_lowercase();
        let end = self.last_row(sheet);
        let mut best: Option<(u32, String)> = None;
        let mut cells = Vec::new();
        self.sheets[sheet].cells.for_each_in(a(0, col), a(end, col), |ad, v| {
            if let Value::Text(s) = v {
                cells.push((ad.row, s.clone()));
            }
        });
        for (r, s) in cells {
            if r == row || s.chars().count() <= typed.chars().count() || self.formulas.contains_key(&(sheet, a(r, col))) {
                continue;
            }
            if s.to_lowercase().starts_with(&lower) && best.as_ref().is_none_or(|b| (row.abs_diff(r)) < row.abs_diff(b.0)) {
                best = Some((r, s));
            }
        }
        Ok((Effect::default(), say(&best.map(|b| b.1).unwrap_or_default())))
    }

    fn t_mirror(&mut self, _sheet: usize, p: &[String]) -> Out {
        let targets: Vec<usize> = arg(p, 1).split(',').filter_map(|x| x.parse().ok()).collect();
        let items: Vec<(Addr, String)> = arg(p, 2)
            .split('\n')
            .filter_map(|l| {
                let mut q = l.splitn(3, ',');
                Some((a(q.next()?.parse().ok()?, q.next()?.parse().ok()?), unescape(q.next().unwrap_or(""))))
            })
            .collect();
        let mut out = Effect::default();
        for s in targets {
            if s < self.sheets.len() {
                out.cells.extend(self.apply(s, &items)?);
            }
        }
        Ok((out, String::new()))
    }

    pub fn tool_encode(&self, e: &Effect, msg: &str) -> String {
        format!("{msg}\n{}", self.encode(e))
    }
}
