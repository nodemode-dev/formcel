use crate::formula::Area;
use crate::wire::{escape, unescape};
use crate::{Workbook, MAX_COLS, MAX_ROWS};
use std::collections::BTreeMap;

pub const ACTIONS: [&str; 15] = [
    "select_locked", "select_unlocked", "format_cells", "format_columns", "format_rows", "insert_columns", "insert_rows", "insert_hyperlinks", "delete_columns", "delete_rows", "sort", "autofilter", "pivot", "objects", "scenarios",
];
const UNLOCKED: u8 = 1;
const HIDDEN: u8 = 2;
const SCAN_LIMIT: u64 = 20_000;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EditRange {
    pub name: String,
    pub area: Area,
    pub users: Vec<String>,
}

impl Default for Area {
    fn default() -> Self {
        Area { r0: 0, c0: 0, r1: 0, c1: 0 }
    }
}

#[derive(Clone, Debug, Default)]
pub struct SheetProt {
    pub on: bool,
    pub hash: String,
    pub legacy: String,
    pub allow: Vec<String>,
    pub cells: BTreeMap<(u32, u32), u8>,
    pub ranges: Vec<EditRange>,
}

#[derive(Clone, Debug, Default)]
pub struct BookProt {
    pub structure: bool,
    pub hash: String,
    pub legacy: String,
    pub is_final: bool,
    pub user: String,
    pub refusal: String,
    pub bypass: bool,
}

impl SheetProt {
    pub fn idle(&self) -> bool {
        !self.on && self.ranges.is_empty()
    }

    fn allows(&self, action: &str) -> bool {
        self.allow.iter().any(|a| a == action)
    }

    pub fn flag(&self, row: u32, col: u32) -> u8 {
        self.cells.get(&(row, col)).copied().unwrap_or(0)
    }

    pub fn shift(&mut self, rows: bool, at: u32, delta: i64) {
        let map = |i: u32| -> Option<u32> {
            let (i, at, d) = (i64::from(i), i64::from(at), delta);
            let n = if d >= 0 {
                if i >= at { i + d } else { i }
            } else if i >= at && i < at - d {
                return None;
            } else if i >= at - d {
                i + d
            } else {
                i
            };
            u32::try_from(n).ok()
        };
        let old = std::mem::take(&mut self.cells);
        for ((r, c), f) in old {
            let moved = if rows { map(r).map(|n| (n, c)) } else { map(c).map(|n| (r, n)) };
            if let Some(k) = moved.filter(|k| k.0 < MAX_ROWS && k.1 < MAX_COLS) {
                self.cells.insert(k, f);
            }
        }
    }

    pub fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.idle() && self.cells.is_empty() {
            return out;
        }
        out.push(format!("S\t{}\t{}\t{}\t{}", u8::from(self.on), self.hash, self.legacy, self.allow.join(",")));
        for ((r, c), f) in &self.cells {
            out.push(format!("C\t{r}\t{c}\t{f}"));
        }
        for g in &self.ranges {
            let mut name = String::new();
            escape(&g.name, &mut name);
            let mut users = String::new();
            escape(&g.users.join(";"), &mut users);
            out.push(format!("R\t{name}\t{},{},{},{}\t{users}", g.area.r0, g.area.c0, g.area.r1, g.area.c1));
        }
        out
    }

    pub fn parse(lines: &[String]) -> SheetProt {
        let mut p = SheetProt::default();
        for l in lines {
            let f: Vec<&str> = l.split('\t').collect();
            match f.first().copied() {
                Some("S") if f.len() >= 5 => {
                    p.on = f[1] == "1";
                    p.hash = f[2].to_string();
                    p.legacy = f[3].to_string();
                    p.allow = f[4].split(',').filter(|a| ACTIONS.contains(a)).map(String::from).collect();
                }
                Some("C") if f.len() >= 4 => {
                    if let (Ok(r), Ok(c), Ok(v)) = (f[1].parse::<u32>(), f[2].parse::<u32>(), f[3].parse::<u8>()) {
                        if r < MAX_ROWS && c < MAX_COLS && v & 3 != 0 {
                            p.cells.insert((r, c), v & 3);
                        }
                    }
                }
                Some("R") if f.len() >= 4 => {
                    let n: Vec<u32> = f[2].split(',').filter_map(|x| x.parse().ok()).collect();
                    if n.len() == 4 && n[0] <= n[2] && n[1] <= n[3] && n[2] < MAX_ROWS && n[3] < MAX_COLS {
                        let users = unescape(f[3]).split(';').map(|u| u.trim().to_string()).filter(|u| !u.is_empty()).collect();
                        p.ranges.push(EditRange { name: unescape(f[1]), area: Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] }, users });
                    }
                }
                _ => {}
            }
        }
        p
    }
}

impl BookProt {
    pub fn lines(&self) -> Vec<String> {
        if !self.structure && !self.is_final {
            return Vec::new();
        }
        vec![format!("B\t{}\t{}\t{}\t{}", u8::from(self.structure), self.hash, self.legacy, u8::from(self.is_final))]
    }

    pub fn parse(&mut self, lines: &[String]) {
        let user = std::mem::take(&mut self.user);
        *self = BookProt { user, ..BookProt::default() };
        for l in lines {
            let f: Vec<&str> = l.split('\t').collect();
            if f.first() == Some(&"B") && f.len() >= 5 {
                self.structure = f[1] == "1";
                self.hash = f[2].to_string();
                self.legacy = f[3].to_string();
                self.is_final = f[4] == "1";
            }
        }
    }
}

fn rotl(x: u32, n: u32) -> u32 {
    x.rotate_right(n)
}

pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&((data.len() as u64) * 8).to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = rotl(w[i - 15], 7) ^ rotl(w[i - 15], 18) ^ (w[i - 15] >> 3);
            let s1 = rotl(w[i - 2], 17) ^ rotl(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = rotl(v[4], 6) ^ rotl(v[4], 11) ^ rotl(v[4], 25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = rotl(v[0], 2) ^ rotl(v[0], 13) ^ rotl(v[0], 22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

pub fn legacy_hash(password: &str) -> String {
    let mut hash: u16 = 0;
    let chars: Vec<char> = password.chars().take(15).collect();
    for ch in chars.iter().rev() {
        hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
        hash ^= *ch as u32 as u16;
    }
    hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
    hash ^= chars.len() as u16;
    hash ^= 0xCE4B;
    format!("{hash:04X}")
}

fn salted(password: &str) -> String {
    sha256_hex(format!("formcel-protect:{password}").as_bytes())
}

fn password_ok(hash: &str, legacy: &str, given: &str) -> bool {
    if !hash.is_empty() {
        return salted(given) == hash;
    }
    legacy.is_empty() || legacy_hash(given).eq_ignore_ascii_case(legacy)
}

fn area_len(a: Area) -> u64 {
    u64::from(a.r1 - a.r0 + 1) * u64::from(a.c1 - a.c0 + 1)
}

fn overlaps(a: Area, b: Area) -> bool {
    a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1
}

fn covers(outer: Area, inner: Area) -> bool {
    outer.r0 <= inner.r0 && outer.c0 <= inner.c0 && outer.r1 >= inner.r1 && outer.c1 >= inner.c1
}

const FINAL_MSG: &str = "This workbook is marked as final, so it is read-only. Choose Edit anyway in the banner to change it.";

impl Workbook {
    pub fn set_user(&mut self, name: &str) {
        self.wprot.user = name.trim().to_string();
    }

    pub fn take_refusal(&mut self) -> String {
        std::mem::take(&mut self.wprot.refusal)
    }

    pub fn current_user(&self) -> &str {
        &self.wprot.user
    }

    pub fn protection_lines(&self, sheet: Option<usize>) -> Vec<String> {
        match sheet {
            None => self.wprot.lines(),
            Some(s) => self.sheets.get(s).map(|s| s.prot.lines()).unwrap_or_default(),
        }
    }

    pub fn load_protection(&mut self, sheet: Option<usize>, lines: &[String]) -> bool {
        match sheet {
            None => {
                self.wprot.parse(lines);
                true
            }
            Some(s) => match self.sheets.get_mut(s) {
                Some(sh) => {
                    sh.prot = SheetProt::parse(lines);
                    true
                }
                None => false,
            },
        }
    }

    pub fn protect_sheet(&mut self, sheet: usize, on: bool, password: &str, allow: &[String]) -> Result<(), String> {
        let s = self.sheets.get_mut(sheet).ok_or("No such sheet.")?;
        if on {
            s.prot.on = true;
            s.prot.allow = allow.iter().filter(|a| ACTIONS.contains(&a.as_str())).cloned().collect();
            if s.prot.hash.is_empty() && s.prot.legacy.is_empty() || !password.is_empty() {
                s.prot.hash = if password.is_empty() { String::new() } else { salted(password) };
                s.prot.legacy = if password.is_empty() { String::new() } else { legacy_hash(password) };
            }
            Ok(())
        } else {
            if !password_ok(&s.prot.hash, &s.prot.legacy, password) {
                return Err("That password does not unprotect the sheet.".into());
            }
            s.prot.on = false;
            s.prot.hash.clear();
            s.prot.legacy.clear();
            Ok(())
        }
    }

    pub fn protect_book(&mut self, on: bool, password: &str) -> Result<(), String> {
        if on {
            self.wprot.structure = true;
            self.wprot.hash = if password.is_empty() { String::new() } else { salted(password) };
            self.wprot.legacy = if password.is_empty() { String::new() } else { legacy_hash(password) };
            Ok(())
        } else {
            if !password_ok(&self.wprot.hash, &self.wprot.legacy, password) {
                return Err("That password does not unprotect the workbook structure.".into());
            }
            self.wprot.structure = false;
            self.wprot.hash.clear();
            self.wprot.legacy.clear();
            Ok(())
        }
    }

    pub fn mark_final(&mut self, on: bool) {
        self.wprot.is_final = on;
    }

    pub fn is_final(&self) -> bool {
        self.wprot.is_final
    }

    pub fn set_cell_flags(&mut self, sheet: usize, area: Area, unlocked: Option<bool>, hidden: Option<bool>) -> Result<(), String> {
        let s = self.sheets.get_mut(sheet).ok_or("No such sheet.")?;
        if area_len(area) > 1_000_000 {
            return Err("That is too many cells to mark at once.".into());
        }
        for r in area.r0..=area.r1 {
            for c in area.c0..=area.c1 {
                let mut f = s.prot.flag(r, c);
                if let Some(u) = unlocked {
                    f = if u { f | UNLOCKED } else { f & !UNLOCKED };
                }
                if let Some(h) = hidden {
                    f = if h { f | HIDDEN } else { f & !HIDDEN };
                }
                if f == 0 {
                    s.prot.cells.remove(&(r, c));
                } else {
                    s.prot.cells.insert((r, c), f);
                }
            }
        }
        Ok(())
    }

    pub fn cell_flags(&self, sheet: usize, row: u32, col: u32) -> u8 {
        self.sheets.get(sheet).map(|s| s.prot.flag(row, col)).unwrap_or(0)
    }

    pub fn set_edit_ranges(&mut self, sheet: usize, ranges: Vec<EditRange>) -> Result<(), String> {
        self.sheets.get_mut(sheet).ok_or("No such sheet.")?.prot.ranges = ranges;
        Ok(())
    }

    pub fn hides_formula(&self, sheet: usize, row: u32, col: u32) -> bool {
        self.sheets.get(sheet).is_some_and(|s| s.prot.on && s.prot.flag(row, col) & HIDDEN != 0)
    }

    fn user_in(&self, users: &[String]) -> bool {
        let me = self.wprot.user.to_lowercase();
        users.iter().any(|u| u.to_lowercase() == me)
    }

    fn cell_editable(&self, sheet: usize, row: u32, col: u32) -> Result<(), String> {
        let s = &self.sheets[sheet];
        for g in &s.prot.ranges {
            if g.area.contains(row, col) && !self.user_in(&g.users) {
                let who = if g.users.is_empty() { "nobody else".to_string() } else { g.users.join(", ") };
                return Err(format!("The range {} is protected: only {who} can edit it. You are {}.", g.name, if self.wprot.user.is_empty() { "not signed in with a user name".to_string() } else { self.wprot.user.clone() }));
            }
        }
        if s.prot.on && s.prot.flag(row, col) & UNLOCKED == 0 {
            let by_range = s.prot.ranges.iter().any(|g| g.area.contains(row, col) && self.user_in(&g.users));
            if !by_range {
                return Err("The cell you are trying to change is locked on a protected sheet. To edit it, unprotect the sheet (lock button, Unprotect sheet) or unlock the cell.".into());
            }
        }
        Ok(())
    }

    pub fn set_bypass(&mut self, on: bool) {
        self.wprot.bypass = on;
    }

    pub fn guard_cells(&self, sheet: usize, cells: &[(u32, u32)]) -> Result<(), String> {
        if self.wprot.bypass {
            return Ok(());
        }
        if self.wprot.is_final {
            return Err(FINAL_MSG.into());
        }
        let Some(s) = self.sheets.get(sheet) else { return Ok(()) };
        if s.prot.idle() {
            return Ok(());
        }
        for (r, c) in cells {
            self.cell_editable(sheet, *r, *c)?;
        }
        Ok(())
    }

    pub fn guard(&self, op: &str, sheet: usize, area: Area) -> Result<(), String> {
        if self.wprot.is_final && op != "select" {
            return Err(FINAL_MSG.into());
        }
        if op == "structure" {
            if self.wprot.structure {
                return Err("The workbook structure is protected, so sheets cannot be added, deleted, renamed or moved. Choose the lock button, Unprotect workbook structure.".into());
            }
            return Ok(());
        }
        let Some(s) = self.sheets.get(sheet) else { return Ok(()) };
        if s.prot.idle() {
            return Ok(());
        }
        let need = match op {
            "format" => Some(("format_cells", "formatting cells")),
            "format_columns" => Some(("format_columns", "formatting columns")),
            "format_rows" => Some(("format_rows", "formatting rows")),
            "insert_rows" => Some(("insert_rows", "inserting rows")),
            "insert_cols" => Some(("insert_columns", "inserting columns")),
            "delete_rows" => Some(("delete_rows", "deleting rows")),
            "delete_cols" => Some(("delete_columns", "deleting columns")),
            "sort" => Some(("sort", "sorting")),
            "filter" => Some(("autofilter", "filtering")),
            "pivot" => Some(("pivot", "changing PivotTables")),
            _ => None,
        };
        if s.prot.on {
            if let Some((action, what)) = need {
                if !s.prot.allows(action) {
                    return Err(format!("This sheet is protected and {what} is not allowed. Choose the lock button, Unprotect sheet."));
                }
            }
        }
        if matches!(op, "edit" | "sort" | "merge" | "clear" | "delete_rows" | "delete_cols") {
            let n = area_len(area);
            if n <= SCAN_LIMIT {
                for r in area.r0..=area.r1 {
                    for c in area.c0..=area.c1 {
                        self.cell_editable(sheet, r, c)?;
                    }
                }
            } else {
                for g in &s.prot.ranges {
                    if overlaps(g.area, area) && !self.user_in(&g.users) {
                        return Err(format!("The range {} is protected for other people.", g.name));
                    }
                }
                if s.prot.on {
                    let unlocked = s.prot.cells.iter().filter(|((r, c), f)| *f & UNLOCKED != 0 && area.contains(*r, *c)).count() as u64;
                    if unlocked < n && !s.prot.ranges.iter().any(|g| covers(g.area, area) && self.user_in(&g.users)) {
                        return Err("Some of those cells are locked on a protected sheet. Unprotect the sheet to change them.".into());
                    }
                }
            }
        }
        Ok(())
    }
}
