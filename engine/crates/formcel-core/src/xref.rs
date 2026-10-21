use crate::eval::Array;
use crate::formula::{self, Area, Expr};
use crate::graph::{FastSet, Key};
use crate::{host, wire, Addr, Effect, EngineError, Value, Workbook};
use std::collections::BTreeMap;

pub const KEY_HEAD: &str = "XREF";
const MAX_CELLS: u64 = 2_000_000;

pub fn split(s: &str) -> Option<(&str, &str, &str)> {
    let close = s.rfind(']')?;
    let open = s[..close].rfind('[')?;
    let (book, sheet) = (&s[open + 1..close], &s[close + 1..]);
    (!book.is_empty() && !sheet.is_empty()).then_some((&s[..open], book, sheet))
}

pub fn is_ext(s: &str) -> bool {
    split(s).is_some()
}

#[derive(Clone, Debug, Default)]
pub struct Book {
    pub path: String,
    pub name: String,
    pub broken: bool,
    pub sheets: Vec<(String, BTreeMap<(u32, u32), Value>)>,
}

impl Book {
    fn is(&self, path: &str, name: &str) -> bool {
        self.path.eq_ignore_ascii_case(path) && self.name.eq_ignore_ascii_case(name)
    }

    fn sheet_mut(&mut self, sheet: &str) -> &mut BTreeMap<(u32, u32), Value> {
        let at = match self.sheets.iter().position(|(n, _)| n.eq_ignore_ascii_case(sheet)) {
            Some(i) => i,
            None => {
                self.sheets.push((sheet.to_string(), BTreeMap::new()));
                self.sheets.len() - 1
            }
        };
        &mut self.sheets[at].1
    }
}

#[derive(Default, Debug)]
pub struct Links {
    pub books: Vec<Book>,
    pub failed: FastSet<String>,
}

pub fn key_of(path: &str, book: &str, sheet: &str, a: Area) -> String {
    let t = |s: &str| host::token(&Value::Text(s.to_string()));
    format!("{KEY_HEAD}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}", t(path), t(book), t(sheet), t(&format!("{},{},{},{}", a.r0, a.c0, a.r1, a.c1)))
}

fn unkey(key: &str) -> Option<(String, String, String, Area)> {
    let mut p = key.split('\u{1f}');
    if p.next()? != KEY_HEAD {
        return None;
    }
    let mut next = || p.next().map(|t| t.strip_prefix("t:").unwrap_or(t).to_string());
    let (path, book, sheet, area) = (next()?, next()?, next()?, next()?);
    let n: Vec<u32> = area.split(',').filter_map(|x| x.parse().ok()).collect();
    if n.len() != 4 {
        return None;
    }
    Some((path, book, sheet, Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] }))
}

fn ext_nodes(e: &Expr, out: &mut Vec<(String, String)>) {
    if let Expr::Ref(Some(s), _) = e {
        if let Some((p, b, _)) = split(s) {
            if !out.iter().any(|(op, ob)| op.eq_ignore_ascii_case(p) && ob.eq_ignore_ascii_case(b)) {
                out.push((p.to_string(), b.to_string()));
            }
        }
    }
    for c in formula::children(e) {
        ext_nodes(c, out);
    }
}

fn raw_of(v: &Value) -> String {
    match v {
        Value::Number(n) => format!("{n}"),
        Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Value::Error(_) => v.to_string(),
        Value::Empty => String::new(),
        Value::Text(s) => {
            if s.starts_with(['\'', '=']) || !matches!(Value::parse_input(s), Value::Text(_)) {
                format!("'{s}")
            } else {
                s.clone()
            }
        }
    }
}

impl Workbook {
    pub(crate) fn ext_values(&self, sheet: &str, area: Area) -> Option<Array> {
        let (path, book, sh) = split(sheet)?;
        let key = key_of(path, book, sh, area);
        if let Some(a) = self.host.results.get(&key) {
            return Some(a.clone());
        }
        if !self.ext.failed.contains(&key) {
            self.host.ask(&key);
        }
        let b = self.ext.books.iter().find(|b| b.is(path, book))?;
        let (_, cells) = b.sheets.iter().find(|(n, _)| n.eq_ignore_ascii_case(sh))?;
        let (h, w) = ((area.r1 - area.r0 + 1) as usize, (area.c1 - area.c0 + 1) as usize);
        if (h as u64) * (w as u64) > MAX_CELLS {
            return None;
        }
        let mut data = vec![Value::Empty; h * w];
        for ((r, c), v) in cells.range((area.r0, 0)..=(area.r1, u32::MAX)) {
            if *c >= area.c0 && *c <= area.c1 {
                data[(*r - area.r0) as usize * w + (*c - area.c0) as usize] = v.clone();
            }
        }
        Some(Array { rows: h, cols: w, data })
    }

    pub(crate) fn ext_store(&mut self, key: &str, data: Option<&str>) {
        let Some((path, book, sheet, area)) = unkey(key) else { return };
        let at = match self.ext.books.iter().position(|b| b.is(&path, &book)) {
            Some(i) => i,
            None => {
                self.ext.books.push(Book { path: path.clone(), name: book.clone(), ..Book::default() });
                self.ext.books.len() - 1
            }
        };
        match data {
            None => {
                self.host.results.remove(key);
                self.ext.failed.remove(key);
            }
            Some(d) if d.starts_with("e:") => {
                self.ext.failed.insert(key.to_string());
                self.ext.books[at].broken = true;
            }
            Some(d) => {
                let arr = host::decode(d);
                self.ext.failed.remove(key);
                self.ext.books[at].broken = false;
                let cells = self.ext.books[at].sheet_mut(&sheet);
                for r in 0..arr.rows {
                    for c in 0..arr.cols {
                        let k = (area.r0 + r as u32, area.c0 + c as u32);
                        match &arr.data[r * arr.cols + c] {
                            Value::Empty => {
                                cells.remove(&k);
                            }
                            v => {
                                cells.insert(k, v.clone());
                            }
                        }
                    }
                }
                self.host.results.insert(key.to_string(), arr);
            }
        }
    }

    pub fn ext_lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (i, b) in self.ext.books.iter().enumerate() {
            let mut line = String::from("book\t");
            wire::escape(&b.path, &mut line);
            line.push('\t');
            wire::escape(&b.name, &mut line);
            line.push_str(&format!("\t{}", u8::from(b.broken)));
            out.push(line);
            for (sheet, cells) in &b.sheets {
                let mut head = format!("sheet\t{i}\t");
                wire::escape(sheet, &mut head);
                out.push(head);
                for ((r, c), v) in cells {
                    let mut l = format!("cell\t{i}\t");
                    wire::escape(sheet, &mut l);
                    l.push_str(&format!("\t{r}\t{c}\t"));
                    wire::escape(&host::token(v), &mut l);
                    out.push(l);
                }
            }
        }
        out
    }

    pub fn load_ext(&mut self, lines: &[String]) {
        let mut books: Vec<Book> = Vec::new();
        for l in lines {
            let p: Vec<&str> = l.split('\t').collect();
            match p.as_slice() {
                ["book", path, name, broken] => books.push(Book { path: wire::unescape(path), name: wire::unescape(name), broken: *broken == "1", sheets: Vec::new() }),
                ["sheet", i, name] => {
                    if let Some(b) = i.parse::<usize>().ok().and_then(|i| books.get_mut(i)) {
                        b.sheet_mut(&wire::unescape(name));
                    }
                }
                ["cell", i, name, r, c, tok] => {
                    let (Ok(i), Ok(r), Ok(c)) = (i.parse::<usize>(), r.parse::<u32>(), c.parse::<u32>()) else { continue };
                    if let Some(b) = books.get_mut(i) {
                        let v = host::decode(&wire::unescape(tok));
                        if let Some(v) = v.data.into_iter().next() {
                            b.sheet_mut(&wire::unescape(name)).insert((r, c), v);
                        }
                    }
                }
                _ => {}
            }
        }
        self.ext = Links { books, failed: FastSet::default() };
        self.host_recalc_ext();
    }

    fn host_recalc_ext(&mut self) {
        let seeds = self.ext_formulas(None);
        if !seeds.is_empty() {
            self.recalc(&seeds);
        }
    }

    pub(crate) fn ext_formulas(&self, only: Option<(&str, &str)>) -> Vec<Key> {
        let mut out: Vec<Key> = self
            .formulas
            .iter()
            .filter_map(|(k, f)| {
                let e = f.ast.as_ref()?;
                let mut books = Vec::new();
                ext_nodes(e, &mut books);
                let hit = match only {
                    None => !books.is_empty(),
                    Some((p, n)) => books.iter().any(|(bp, bn)| bp.eq_ignore_ascii_case(p) && bn.eq_ignore_ascii_case(n)),
                };
                hit.then_some(*k)
            })
            .collect();
        out.sort_unstable_by_key(|k| (k.0, k.1.row, k.1.col));
        out
    }

    pub fn ext_list(&self) -> Vec<String> {
        let mut found: Vec<(String, String)> = self.ext.books.iter().map(|b| (b.path.clone(), b.name.clone())).collect();
        for k in self.ext_formulas(None) {
            if let Some(e) = self.formulas.get(&k).and_then(|f| f.ast.as_ref()) {
                let mut b = Vec::new();
                ext_nodes(e, &mut b);
                for x in b {
                    if !found.iter().any(|(p, n)| p.eq_ignore_ascii_case(&x.0) && n.eq_ignore_ascii_case(&x.1)) {
                        found.push(x);
                    }
                }
            }
        }
        found
            .into_iter()
            .map(|(p, n)| {
                let used = self.ext_formulas(Some((&p, &n))).len();
                let book = self.ext.books.iter().find(|b| b.is(&p, &n));
                let cached = book.map_or(0, |b| b.sheets.iter().map(|s| s.1.len()).sum());
                let state = match book {
                    None => "pending",
                    Some(b) if b.broken => "broken",
                    Some(_) => "ok",
                };
                let mut line = String::new();
                wire::escape(&p, &mut line);
                line.push('\t');
                wire::escape(&n, &mut line);
                line.push_str(&format!("\t{state}\t{used}\t{cached}"));
                line
            })
            .collect()
    }

    pub fn ext_refresh(&mut self, only: Option<(&str, &str)>) -> usize {
        let drop: Vec<String> = self
            .host
            .results
            .keys()
            .filter(|k| match (unkey(k), only) {
                (Some((p, b, _, _)), Some((op, ob))) => p.eq_ignore_ascii_case(op) && b.eq_ignore_ascii_case(ob),
                (Some(_), None) => true,
                _ => false,
            })
            .cloned()
            .collect();
        for k in drop {
            self.host.results.remove(&k);
        }
        self.ext.failed.clear();
        let seeds = self.ext_formulas(only);
        if !seeds.is_empty() {
            self.recalc(&seeds);
        }
        self.host.want.lock().map_or(0, |w| w.len())
    }

    pub(crate) fn ext_drop_results(&mut self) {
        self.host.results.retain(|k, _| !k.starts_with(KEY_HEAD));
        self.ext.failed.clear();
    }

    pub fn ext_change(&mut self, old: (&str, &str), new_path: &str, new_name: &str) -> Result<Effect, EngineError> {
        if new_name.trim().is_empty() {
            return Err(EngineError::BadName(new_name.to_string()));
        }
        let mark = self.undo.len();
        let mut fx = Effect::default();
        let mut by_sheet: BTreeMap<usize, Vec<(Addr, String)>> = BTreeMap::new();
        for k in self.ext_formulas(Some(old)) {
            let Some(mut e) = self.formulas.get(&k).and_then(|f| f.ast.clone()) else { continue };
            formula::walk_mut(&mut e, &mut |n| {
                if let Expr::Ref(Some(s), _) = n {
                    if let Some((p, b, sh)) = split(s) {
                        if p.eq_ignore_ascii_case(old.0) && b.eq_ignore_ascii_case(old.1) {
                            *s = format!("{new_path}[{new_name}]{sh}");
                        }
                    }
                }
            });
            by_sheet.entry(k.0).or_default().push((k.1, format!("={}", formula::to_text(&e))));
        }
        let moved = self.ext.books.iter().position(|b| b.is(old.0, old.1));
        if let Some(i) = moved {
            let mut b = self.ext.books.remove(i);
            b.path = new_path.to_string();
            b.name = new_name.to_string();
            b.broken = false;
            self.ext.books.retain(|x| !x.is(new_path, new_name));
            self.ext.books.push(b);
        }
        self.host.results.retain(|k, _| !matches!(unkey(k), Some((p, b, _, _)) if p.eq_ignore_ascii_case(old.0) && b.eq_ignore_ascii_case(old.1)));
        self.ext.failed.clear();
        for (sheet, edits) in by_sheet {
            fx.cells.extend(self.apply(sheet, &edits)?);
        }
        self.group_since(mark);
        Ok(fx)
    }

    pub fn ext_break(&mut self, only: (&str, &str)) -> Result<Effect, EngineError> {
        let mark = self.undo.len();
        let mut fx = Effect::default();
        let mut by_sheet: BTreeMap<usize, Vec<(Addr, String)>> = BTreeMap::new();
        for k in self.ext_formulas(Some(only)) {
            let v = self.sheets[k.0].cells.get(k.1).cloned().unwrap_or(Value::Empty);
            by_sheet.entry(k.0).or_default().push((k.1, raw_of(&v)));
        }
        for (sheet, edits) in by_sheet {
            fx.cells.extend(self.apply(sheet, &edits)?);
        }
        self.ext.books.retain(|b| !b.is(only.0, only.1));
        self.host.results.retain(|k, _| !matches!(unkey(k), Some((p, b, _, _)) if p.eq_ignore_ascii_case(only.0) && b.eq_ignore_ascii_case(only.1)));
        self.group_since(mark);
        Ok(fx)
    }
}
