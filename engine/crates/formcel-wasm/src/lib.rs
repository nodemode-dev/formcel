use formcel_core::{parse_a1, wire, Addr, Dir, Workbook, VERSION};
use std::cell::RefCell;

thread_local! {
    static BOOKS: RefCell<Vec<Option<Workbook>>> = const { RefCell::new(Vec::new()) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn emit(s: &str) -> u32 {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend_from_slice(s.as_bytes());
        o.len() as u32
    })
}

#[no_mangle]
pub extern "C" fn fc_out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn fc_alloc(len: u32) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must come from `fc_alloc` with the same `len`.
#[no_mangle]
pub unsafe extern "C" fn fc_free(ptr: *mut u8, len: u32) {
    drop(Vec::from_raw_parts(ptr, 0, len as usize));
}

#[no_mangle]
pub extern "C" fn fc_version() -> u32 {
    emit(VERSION)
}

#[no_mangle]
pub extern "C" fn fc_workbook_new() -> u32 {
    BOOKS.with(|b| {
        let mut b = b.borrow_mut();
        b.push(Some(Workbook::new()));
        (b.len() - 1) as u32
    })
}

#[no_mangle]
pub extern "C" fn fc_workbook_drop(id: u32) {
    BOOKS.with(|b| {
        if let Some(slot) = b.borrow_mut().get_mut(id as usize) {
            *slot = None;
        }
    })
}

unsafe fn text<'a>(ptr: *const u8, len: u32) -> &'a str {
    std::str::from_utf8(std::slice::from_raw_parts(ptr, len as usize)).unwrap_or("")
}

fn with_book<R>(id: u32, f: impl FnOnce(&mut Workbook) -> R) -> Option<R> {
    BOOKS.with(|b| b.borrow_mut().get_mut(id as usize).and_then(Option::as_mut).map(f))
}

/// Sets a cell from typed input and leaves its display text in the out buffer.
/// Returns the text length, or -1 when the address, sheet or workbook is invalid.
///
/// # Safety
/// `a1` and `raw` must point at `a1_len` and `raw_len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set(id: u32, sheet: u32, a1: *const u8, a1_len: u32, raw: *const u8, raw_len: u32) -> i32 {
    let (a1, raw) = (text(a1, a1_len), text(raw, raw_len));
    let Ok(addr) = parse_a1(a1) else { return -1 };
    match with_book(id, |wb| wb.set_input(sheet as usize, addr, raw)) {
        Some(Ok(v)) => emit(&v.to_string()) as i32,
        _ => -1,
    }
}

/// # Safety
/// `a1` must point at `a1_len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_get(id: u32, sheet: u32, a1: *const u8, a1_len: u32) -> i32 {
    let Ok(addr) = parse_a1(text(a1, a1_len)) else { return -1 };
    match with_book(id, |wb| wb.get(sheet as usize, addr)) {
        Some(Ok(v)) => emit(&v.to_string()) as i32,
        _ => -1,
    }
}

/// Applies `row\tcol\traw` lines as one undoable step; the out buffer gets the changed cells.
///
/// # Safety
/// `edits` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_apply(id: u32, sheet: u32, edits: *const u8, len: u32) -> i32 {
    let Some(edits) = wire::decode_edits(text(edits, len)) else { return -1 };
    match with_book(id, |wb| wb.apply(sheet as usize, &edits).map(|c| wire::encode_changed(&c, &|s, a| wb.meta(s, a)))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::Protected(_))) => -9,
        _ => -1,
    }
}

/// Sets the engine's clock (a serial date in local time) for TODAY and NOW; the window calls it before each request.
#[no_mangle]
pub extern "C" fn fc_set_clock(serial: f64) {
    formcel_core::numfmt::set_clock(serial);
}

/// Sets the spreadsheet locale (en-US, en-GB, de-DE, fr-FR, ja-JP) that decides date order and separators; -1 when unknown.
///
/// # Safety
/// `t` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_locale(t: *const u8, len: u32) -> i32 {
    match formcel_core::locale::Locale::parse(text(t, len)) {
        Some(l) => {
            formcel_core::locale::set(l);
            0
        }
        None => -1,
    }
}

/// Moves the relative references of a formula by `dr` rows and `dc` columns, as filling or pasting does.
///
/// # Safety
/// `src` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_offset(src: *const u8, len: u32, dr: i32, dc: i32) -> i32 {
    emit(&formcel_core::formula::offset_text(text(src, len), i64::from(dr), i64::from(dc))) as i32
}

/// Loads `row\tcol\traw` lines without recording an undo step; returns the count.
///
/// # Safety
/// `edits` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load(id: u32, sheet: u32, edits: *const u8, len: u32) -> i32 {
    let Some(edits) = wire::decode_edits(text(edits, len)) else { return -1 };
    match with_book(id, |wb| wb.load(sheet as usize, &edits)) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_add_sheet(id: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    with_book(id, |wb| wb.add_sheet(&name) as i32).unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn fc_sheet_names(id: u32) -> i32 {
    match with_book(id, |wb| wb.sheet_names()) {
        Some(names) => {
            let mut s = String::new();
            for n in names {
                wire::escape(&n, &mut s);
                s.push('\n');
            }
            emit(&s) as i32
        }
        None => -1,
    }
}

fn history(id: u32, forward: bool) -> i32 {
    let r = with_book(id, |wb| {
        let e = if forward { wb.redo() } else { wb.undo() };
        e.map(|e| wb.encode(&e))
    });
    match r {
        Some(Some(s)) => emit(&s) as i32,
        Some(None) => -2,
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn fc_shift(id: u32, sheet: u32, rows: u32, at: u32, n: u32, insert: u32) -> i32 {
    let r = with_book(id, |wb| if insert != 0 { wb.insert(sheet as usize, rows != 0, at, n) } else { wb.delete(sheet as usize, rows != 0, at, n) });
    match r {
        Some(Ok(s)) => emit(&wire::encode_shift(&s)) as i32,
        _ => -1,
    }
}

#[no_mangle]
pub extern "C" fn fc_delete_sheet(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.delete_sheet(sheet as usize)) {
        Some(Ok(())) => 0,
        _ => -1,
    }
}

#[no_mangle]
pub extern "C" fn fc_move_sheet(id: u32, from: u32, to: u32) -> i32 {
    match with_book(id, |wb| wb.move_sheet(from as usize, to as usize)) {
        Some(Ok(())) => 0,
        _ => -1,
    }
}

/// Defines, replaces or (with empty `refers`) removes a workbook name; the out buffer gets the changed cells.
/// Returns -3 for an invalid name and -4 for a formula that does not parse.
///
/// # Safety
/// `name` and `refers` must point at `name_len` and `refers_len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_define_name(id: u32, name: *const u8, name_len: u32, refers: *const u8, refers_len: u32) -> i32 {
    let (name, refers) = (text(name, name_len).to_string(), text(refers, refers_len).to_string());
    match with_book(id, |wb| wb.define_name(&name, &refers).map(|c| wire::encode_changed(&c, &|s, a| wb.meta(s, a)))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadName(_))) => -3,
        Some(Err(_)) => -4,
        None => -1,
    }
}

/// Sets the number format code of a rectangle as one undo step (empty or General clears it); the out buffer gets the effect.
/// Returns -3 for a code that does not parse.
///
/// # Safety
/// `code` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_format(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32, code: *const u8, len: u32) -> i32 {
    let code = text(code, len).to_string();
    let r = with_book(id, |wb| wb.set_format(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 }, &code).map(|e| wb.encode(&e)));
    match r {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadFormat(_))) => -3,
        _ => -1,
    }
}

/// The number format code of one cell, empty for General.
#[no_mangle]
pub extern "C" fn fc_format_at(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    match with_book(id, |wb| wb.format_code(sheet as usize, Addr { row, col }).unwrap_or_default()) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Loads `row\tcol\tcode` lines without an undo step; returns the count.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_formats(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let Some(cells) = wire::decode_edits(text(lines, len)) else { return -1 };
    match with_book(id, |wb| wb.load_formats(sheet as usize, &cells)) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// Applies `r0\tc0\tr1\tc1\tpatch` lines as one undo step; the out buffer gets the effect.
/// Returns -3 for a patch that does not parse.
///
/// # Safety
/// `ops` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_styles(id: u32, sheet: u32, ops: *const u8, len: u32) -> i32 {
    let mut list = Vec::new();
    for l in text(ops, len).split('\n').filter(|l| !l.is_empty()) {
        let p: Vec<&str> = l.splitn(5, '\t').collect();
        let n = |i: usize| p.get(i).and_then(|s| s.parse::<u32>().ok());
        let (Some(r0), Some(c0), Some(r1), Some(c1)) = (n(0), n(1), n(2), n(3)) else { return -1 };
        list.push((Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 }, wire::unescape(p.get(4).copied().unwrap_or(""))));
    }
    match with_book(id, |wb| wb.set_styles(sheet as usize, &list).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadStyle(_))) => -3,
        _ => -1,
    }
}

/// Styles inside a rectangle as `&\trow\tcol\tstyle` lines.
#[no_mangle]
pub extern "C" fn fc_styles_in(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    let s = sheet as usize;
    match with_book(id, |wb| wb.shown_styles_in(s, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 })) {
        Some(list) => {
            let list: Vec<(usize, Addr, String)> = list.into_iter().map(|(a, t)| (s, a, t)).collect();
            emit(&wire::encode_styles('&', Some(s), &list)) as i32
        }
        None => -1,
    }
}

/// The style of one cell, empty when plain.
#[no_mangle]
pub extern "C" fn fc_style_at(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    match with_book(id, |wb| wb.style_text(sheet as usize, Addr { row, col }).unwrap_or_default()) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Loads `row\tcol\tstyle` lines without an undo step; returns the count.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_styles(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let Some(cells) = wire::decode_edits(text(lines, len)) else { return -1 };
    match with_book(id, |wb| wb.load_styles(sheet as usize, &cells)) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// Merges, merges across, merges and centers, or unmerges a rectangle as one undo step (mode 0 center, 1 across, 2 cells, 3 unmerge).
#[no_mangle]
pub extern "C" fn fc_merge(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32, mode: u32) -> i32 {
    use formcel_core::MergeMode;
    let mode = match mode {
        0 => MergeMode::Center,
        1 => MergeMode::Across,
        2 => MergeMode::Cells,
        _ => MergeMode::Unmerge,
    };
    match with_book(id, |wb| wb.merge(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 }, mode).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        _ => -1,
    }
}

/// The merged areas of a sheet as `r0\tc0\tr1\tc1` lines.
#[no_mangle]
pub extern "C" fn fc_merges(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.merges(sheet as usize)) {
        Some(list) => emit(&list.iter().map(|m| format!("{}\t{}\t{}\t{}\n", m.r0, m.c0, m.r1, m.c1)).collect::<String>()) as i32,
        None => -1,
    }
}

/// Replaces a sheet's merged areas from `r0\tc0\tr1\tc1` lines without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_merges(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let mut list = Vec::new();
    for l in text(lines, len).split('\n').filter(|l| !l.is_empty()) {
        let n: Vec<u32> = l.split('\t').filter_map(|p| p.parse().ok()).collect();
        if n.len() != 4 {
            return -1;
        }
        list.push(formcel_core::formula::Area { r0: n[0], c0: n[1], r1: n[2], c1: n[3] });
    }
    match with_book(id, |wb| wb.load_merges(sheet as usize, &list)) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// Sets styles and number formats cell by cell from `row\tcol\tstyle\tcode` lines as one undo step; `~` leaves that part as it is.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_put_formats(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let mut items = Vec::new();
    for l in text(lines, len).split('\n').filter(|l| !l.is_empty()) {
        let p: Vec<&str> = l.splitn(4, '\t').collect();
        let (Some(row), Some(col)) = (p.first().and_then(|s| s.parse().ok()), p.get(1).and_then(|s| s.parse().ok())) else { return -1 };
        let opt = |i: usize| p.get(i).filter(|s| **s != "~").map(|s| wire::unescape(s));
        items.push((Addr { row, col }, opt(2), opt(3)));
    }
    match with_book(id, |wb| wb.put_formats(sheet as usize, &items).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        _ => -1,
    }
}

fn effect_or(r: Option<Result<String, formcel_core::EngineError>>) -> i32 {
    match r {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadStyle(_))) => -3,
        Some(Err(formcel_core::EngineError::BadFormat(_))) => -4,
        _ => -1,
    }
}

/// The workbook theme as `name;dk1,lt1,dk2,lt2,accent1..6;heading font;body font`, then the built-in theme names, one per line.
#[no_mangle]
pub extern "C" fn fc_theme(id: u32) -> i32 {
    match with_book(id, |wb| format!("{}\n{}\n", wb.theme_text(), Workbook::theme_names().join("\n"))) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Sets the theme by built-in name or full theme text as one undo step.
///
/// # Safety
/// `t` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_theme(id: u32, t: *const u8, len: u32) -> i32 {
    let t = text(t, len).to_string();
    effect_or(with_book(id, |wb| wb.set_theme(&t).map(|e| wb.encode(&e))))
}

/// Loads theme text without an undo step.
///
/// # Safety
/// `t` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_theme(id: u32, t: *const u8, len: u32) -> i32 {
    let t = text(t, len).to_string();
    match with_book(id, |wb| wb.load_theme(&t)) {
        Some(true) => 0,
        _ => -1,
    }
}

/// The named cell styles as `name\tstyle\tcode\tparts\tbuiltin` lines.
#[no_mangle]
pub extern "C" fn fc_named(id: u32) -> i32 {
    match with_book(id, |wb| wb.named_lines().join("\n")) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Replaces the named cell styles from lines like `fc_named` gives, without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_named(id: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    match with_book(id, |wb| wb.load_named(&list)) {
        Some(()) => 0,
        None => -1,
    }
}

/// Creates or updates a named style from one cell's formatting; `parts` lists n a f b p for number, alignment, font, border and fill.
///
/// # Safety
/// `name` and `parts` must point at readable bytes of their lengths.
#[no_mangle]
pub unsafe extern "C" fn fc_define_style(id: u32, sheet: u32, row: u32, col: u32, name: *const u8, name_len: u32, parts: *const u8, parts_len: u32) -> i32 {
    let (name, parts) = (text(name, name_len).to_string(), text(parts, parts_len).to_string());
    effect_or(with_book(id, |wb| wb.define_style(&name, sheet as usize, Addr { row, col }, &parts).map(|e| wb.encode(&e))))
}

/// Deletes a named style and removes it from every cell that uses it.
///
/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_delete_style(id: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    effect_or(with_book(id, |wb| wb.delete_style(&name).map(|e| wb.encode(&e))))
}

/// Sorts the rows of a rectangle as one undo step; `keys` is `col:a` or `col:d` items joined by commas, columns absolute.
///
/// # Safety
/// `keys` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_sort(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32, keys: *const u8, len: u32, header: u32, case: u32) -> i32 {
    let keys: Vec<formcel_core::sort::SortKey> = text(keys, len)
        .split(',')
        .filter_map(|k| {
            let (c, d) = k.split_once(':')?;
            Some(formcel_core::sort::SortKey { col: c.parse().ok()?, descending: d == "d" })
        })
        .collect();
    let area = formcel_core::formula::Area { r0, c0, r1, c1 };
    match with_book(id, |wb| wb.sort(sheet as usize, area, &keys, header != 0, case != 0).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadStyle(_))) => -3,
        _ => -1,
    }
}

/// The data region around a cell, as `r0,c0,r1,c1,h` where `h` is 1 when its first row looks like headers.
#[no_mangle]
pub extern "C" fn fc_region(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    match with_book(id, |wb| wb.region(sheet as usize, Addr { row, col }).map(|a| (a, wb.guess_header(sheet as usize, a)))) {
        Some(Ok((a, h))) => emit(&format!("{},{},{},{},{}", a.r0, a.c0, a.r1, a.c1, u8::from(h))) as i32,
        _ => -1,
    }
}

/// 1 when the first row of a rectangle looks like headers, else 0.
#[no_mangle]
pub extern "C" fn fc_guess_header(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    with_book(id, |wb| i32::from(wb.guess_header(sheet as usize, formcel_core::formula::Area { r0, c0, r1, c1 }))).unwrap_or(0)
}

/// Every table in the workbook, one line each.
#[no_mangle]
pub extern "C" fn fc_tables(id: u32) -> i32 {
    match with_book(id, |wb| wb.tables().join("\n")) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Loads the workbook's tables without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_tables(id: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    with_book(id, |wb| wb.load_tables(&list) as i32).unwrap_or(-1)
}

/// Makes a table from a rectangle, with or without its own header row, as one undo step; -3 when it cannot.
#[no_mangle]
pub extern "C" fn fc_create_table(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32, header: u32) -> i32 {
    let area = formcel_core::formula::Area { r0, c0, r1, c1 };
    match with_book(id, |wb| wb.create_table(sheet as usize, area, header != 0).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadStyle(_) | formcel_core::EngineError::BadName(_))) => -3,
        _ => -1,
    }
}

/// Changes a table's name, style, options, size or total row from a table line without its sheet; -3 when refused.
///
/// # Safety
/// `name` and `t` must point at readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_table(id: u32, name: *const u8, name_len: u32, t: *const u8, len: u32) -> i32 {
    let (name, t) = (text(name, name_len).to_string(), text(t, len).to_string());
    match with_book(id, |wb| wb.set_table(&name, &t).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadStyle(_) | formcel_core::EngineError::BadName(_))) => -3,
        _ => -1,
    }
}

/// Turns a table back into a range; references to it become cell references.
///
/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_remove_table(id: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    effect_or(with_book(id, |wb| wb.remove_table(&name).map(|e| wb.encode(&e))))
}

thread_local! {
    static PIVOT_ERR: RefCell<String> = const { RefCell::new(String::new()) };
}

fn pivot_text(r: Option<Result<String, formcel_core::EngineError>>) -> i32 {
    match r {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(e)) => {
            PIVOT_ERR.with(|p| *p.borrow_mut() = e.to_string());
            -3
        }
        None => -1,
    }
}

/// The message of the last PivotTable call that was refused.
#[no_mangle]
pub extern "C" fn fc_pivot_error() -> i32 {
    PIVOT_ERR.with(|p| emit(&p.borrow()) as i32)
}

/// Every PivotTable in the workbook, one line each.
#[no_mangle]
pub extern "C" fn fc_pivots(id: u32) -> i32 {
    match with_book(id, |wb| wb.pivots().join("\n")) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Loads the workbook's PivotTables without an undo step or any change to the cells.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_pivots(id: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    with_book(id, |wb| wb.load_pivots(&list) as i32).unwrap_or(-1)
}

/// The sheet, area, table and typed field names of a PivotTable source typed as a range or table name.
///
/// # Safety
/// `src` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_pivot_source(id: u32, sheet: u32, src: *const u8, len: u32) -> i32 {
    let src = text(src, len).to_string();
    pivot_text(with_book(id, |wb| wb.pivot_source(sheet as usize, &src)))
}

/// The same description for an existing PivotTable's own source.
///
/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_pivot_fields(id: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    pivot_text(with_book(id, |wb| wb.pivot_fields(&name)))
}

/// The items of one field of a PivotTable's source, sorted, one escaped line each.
///
/// # Safety
/// `name` and `field` must point at readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_pivot_items(id: u32, name: *const u8, name_len: u32, field: *const u8, field_len: u32) -> i32 {
    let (name, field) = (text(name, name_len).to_string(), text(field, field_len).to_string());
    pivot_text(with_book(id, |wb| {
        wb.pivot_items(&name, &field).map(|v| {
            v.iter()
                .map(|s| {
                    let mut o = String::new();
                    wire::escape(s, &mut o);
                    o
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
    }))
}

/// Suggested PivotTable layouts for a source, one PivotTable line each.
///
/// # Safety
/// `src` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_pivot_suggest(id: u32, sheet: u32, src: *const u8, len: u32) -> i32 {
    let src = text(src, len).to_string();
    pivot_text(with_book(id, |wb| wb.pivot_suggest(sheet as usize, &src).map(|v| v.join("\n"))))
}

/// Builds a PivotTable from a line as one undo step; -3 when refused, with the reason in fc_pivot_error.
///
/// # Safety
/// `line` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_create_pivot(id: u32, line: *const u8, len: u32) -> i32 {
    let line = text(line, len).to_string();
    pivot_text(with_book(id, |wb| wb.create_pivot(&line).map(|e| wb.encode(&e))))
}

/// Replaces a PivotTable's definition and redraws it.
///
/// # Safety
/// `name` and `line` must point at readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_pivot(id: u32, name: *const u8, name_len: u32, line: *const u8, len: u32) -> i32 {
    let (name, line) = (text(name, name_len).to_string(), text(line, len).to_string());
    pivot_text(with_book(id, |wb| wb.set_pivot(&name, &line).map(|e| wb.encode(&e))))
}

/// Recomputes one PivotTable from its current source, or every PivotTable when the name is empty.
///
/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_refresh_pivot(id: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    pivot_text(with_book(id, |wb| wb.refresh_pivot(&name).map(|e| wb.encode(&e))))
}

/// Removes a PivotTable and clears the cells it drew.
///
/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_remove_pivot(id: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    pivot_text(with_book(id, |wb| wb.remove_pivot(&name).map(|e| wb.encode(&e))))
}

/// A sheet's data validation rules, one line each.
#[no_mangle]
pub extern "C" fn fc_validations(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.validations(sheet as usize).join("\n")) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Gives a rectangle one validation rule (the line without its area), or none when empty, as one undo step; -3 when the line does not parse.
///
/// # Safety
/// `t` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_validation(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32, t: *const u8, len: u32) -> i32 {
    let t = text(t, len).to_string();
    let area = formcel_core::formula::Area { r0, c0, r1, c1 };
    match with_book(id, |wb| wb.set_validation(sheet as usize, area, &t).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadStyle(_))) => -3,
        _ => -1,
    }
}

/// Loads a sheet's validation rules without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_validations(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    match with_book(id, |wb| wb.load_validations(sheet as usize, &list)) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// A sheet's floating object anchors, one line each.
#[no_mangle]
pub extern "C" fn fc_objects(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.objects(sheet as usize).join("\n")) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Loads a sheet's floating object anchors without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_objects(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    match with_book(id, |wb| wb.load_objects(sheet as usize, &list)) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// Replaces a sheet's floating object anchors as one undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_objects(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    match with_book(id, |wb| wb.set_objects(sheet as usize, &list).map(|e| wb.encode(&e))) {
        Some(Ok(s)) => emit(&s) as i32,
        _ => -1,
    }
}

/// The validation rule over a cell, as a line, or empty.
#[no_mangle]
pub extern "C" fn fc_validation_at(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    match with_book(id, |wb| wb.validation_at(sheet as usize, Addr { row, col }).map(|v| v.line()).unwrap_or_default()) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// The rule an input would break in a cell, as a line, or empty when the input is allowed.
///
/// # Safety
/// `raw` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_check_input(id: u32, sheet: u32, row: u32, col: u32, raw: *const u8, len: u32) -> i32 {
    let raw = text(raw, len).to_string();
    match with_book(id, |wb| wb.check_input(sheet as usize, Addr { row, col }, &raw).map(|v| v.line()).unwrap_or_default()) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// The entries of a cell's dropdown list, one escaped line each.
#[no_mangle]
pub extern "C" fn fc_list_items(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    match with_book(id, |wb| wb.list_items(sheet as usize, Addr { row, col })) {
        Some(items) => {
            let mut s = String::new();
            for i in items {
                wire::escape(&i, &mut s);
                s.push('\n');
            }
            emit(&s) as i32
        }
        None => -1,
    }
}

/// Cells in a rectangle whose values break their validation rule, as `row\tcol` lines.
#[no_mangle]
pub extern "C" fn fc_invalid_in(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    match with_book(id, |wb| wb.invalid_in(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 })) {
        Some(list) => emit(&list.iter().map(|a| format!("{}\t{}\n", a.row, a.col)).collect::<String>()) as i32,
        None => -1,
    }
}

/// A sheet's filter as `area`, `col` and `hidden` lines; empty when the sheet has none.
#[no_mangle]
pub extern "C" fn fc_filter(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.filter_text(sheet as usize)) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Sets, changes or (with empty text) removes a sheet's filter as one undo step; -3 when the text does not parse.
///
/// # Safety
/// `t` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_filter(id: u32, sheet: u32, t: *const u8, len: u32) -> i32 {
    let t = text(t, len).to_string();
    effect_or(with_book(id, |wb| wb.set_filter(sheet as usize, &t).map(|e| wb.encode(&e))))
}

/// Loads a sheet's filter, hidden rows included, without an undo step.
///
/// # Safety
/// `t` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_filter(id: u32, sheet: u32, t: *const u8, len: u32) -> i32 {
    let t = text(t, len).to_string();
    match with_book(id, |wb| wb.load_filter(sheet as usize, &t)) {
        Some(Ok(b)) => i32::from(b),
        _ => -1,
    }
}

/// Runs one data tool (dedupe, text to columns, subtotal, flash fill, find and replace and the rest) as one undo step; the result is the escaped report line, then the encoded effect. A refusal comes back as `ERR` and the reason.
///
/// # Safety
/// `cmd` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_tool(id: u32, sheet: u32, cmd: *const u8, len: u32) -> i32 {
    let cmd = text(cmd, len).to_string();
    match with_book(id, |wb| wb.tool(sheet as usize, &cmd).map(|(e, msg)| wb.tool_encode(&e, &msg))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(e)) => emit(&format!("ERR\t{e}")) as i32,
        None => -1,
    }
}

/// Runs the filter again over current values, taking in rows added below it.
#[no_mangle]
pub extern "C" fn fc_reapply_filter(id: u32, sheet: u32) -> i32 {
    effect_or(with_book(id, |wb| wb.reapply_filter(sheet as usize).map(|e| wb.encode(&e))))
}

/// The list a column's filter offers: `v` lines of shown text, a `b` line when blanks exist, `m` when the list stopped at its limit, then `f` and `t` lines for fill and font colours.
#[no_mangle]
pub extern "C" fn fc_filter_values(id: u32, sheet: u32, col: u32) -> i32 {
    match with_book(id, |wb| (wb.filter_values(sheet as usize, col), wb.filter_colors(sheet as usize, col))) {
        Some(((values, blanks, more), (fills, fonts))) => {
            let mut s = String::new();
            for v in values {
                s.push_str("v\t");
                wire::escape(&v, &mut s);
                s.push('\n');
            }
            if blanks {
                s.push_str("b\n");
            }
            if more {
                s.push_str("m\n");
            }
            for f in fills {
                s.push_str(&format!("f\t{f}\n"));
            }
            for f in fonts {
                s.push_str(&format!("t\t{f}\n"));
            }
            emit(&s) as i32
        }
        None => -1,
    }
}

/// Applies a named style to a rectangle as one undo step.
///
/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_apply_style(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    effect_or(with_book(id, |wb| wb.apply_style(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 }, &name).map(|e| wb.encode(&e))))
}

/// Stored values inside a rectangle as `row\tcol\tvalue` lines, text prefixed with an apostrophe so it reads back as text.
#[no_mangle]
pub extern "C" fn fc_values_in(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    match with_book(id, |wb| wb.values_in(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 })) {
        Some(list) => {
            let mut s = String::new();
            for (a, v) in list {
                s.push_str(&format!("{}\t{}\t", a.row, a.col));
                wire::escape(&v, &mut s);
                s.push('\n');
            }
            emit(&s) as i32
        }
        None => -1,
    }
}

/// A sheet's conditional formatting rules, one line each, highest precedence first.
#[no_mangle]
pub extern "C" fn fc_rules(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.rule_lines(sheet as usize).join("\n")) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Replaces a sheet's rules as one undo step; -3 when a line does not parse.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_rules(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    effect_or(with_book(id, |wb| wb.set_rules(sheet as usize, &list).map(|e| wb.encode(&e))))
}

/// Loads a sheet's rules without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_rules(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    match with_book(id, |wb| wb.load_rules(sheet as usize, &list)) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// What conditional formatting paints inside a rectangle, as `row\tcol\tstyle\tbar\ticon` lines.
#[no_mangle]
pub extern "C" fn fc_cf_in(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    match with_book(id, |wb| wb.cf_in(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 })) {
        Some(list) => {
            let mut s = String::new();
            for (a, p) in list {
                let bar = p.bar.map(|(f, t, c)| format!("{f:.4},{t:.4},{c:06x}")).unwrap_or_default();
                let icon = p.icon.map(|(set, i)| format!("{set}:{i}")).unwrap_or_default();
                s.push_str(&format!("{}\t{}\t", a.row, a.col));
                wire::escape(&p.style.map(|st| st.text()).unwrap_or_default(), &mut s);
                s.push_str(&format!("\t{bar}\t{icon}\n"));
            }
            emit(&s) as i32
        }
        None => -1,
    }
}

/// The link of one cell, from the cell or from a HYPERLINK formula; empty when there is none.
#[no_mangle]
pub extern "C" fn fc_link_at(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    match with_book(id, |wb| wb.link_at(sheet as usize, Addr { row, col }).unwrap_or_default()) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Links one cell, and sets its text when `display` is given (`has_display` 1), as one undo step; -3 for a target FormCel does not link.
///
/// # Safety
/// `target` and `display` must point at readable bytes of their lengths.
#[no_mangle]
pub unsafe extern "C" fn fc_set_link(id: u32, sheet: u32, row: u32, col: u32, target: *const u8, target_len: u32, display: *const u8, display_len: u32, has_display: u32) -> i32 {
    let target = text(target, target_len).to_string();
    let display = text(display, display_len).to_string();
    effect_or(with_book(id, |wb| wb.set_link(sheet as usize, Addr { row, col }, &target, (has_display == 1).then_some(display.as_str())).map(|e| wb.encode(&e))))
}

/// Removes the links of a rectangle and keeps the text, as one undo step.
#[no_mangle]
pub extern "C" fn fc_remove_links(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    effect_or(with_book(id, |wb| wb.remove_links(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 }).map(|e| wb.encode(&e))))
}

/// Link changes since the last call, as `sheet\trow\tcol\ttarget` lines (empty target: removed).
#[no_mangle]
pub extern "C" fn fc_take_links(id: u32) -> i32 {
    match with_book(id, |wb| {
        let mut s = String::new();
        for (sh, a, t) in wb.take_link_changes() {
            s.push_str(&format!("{sh}\t{}\t{}\t", a.row, a.col));
            wire::escape(&t, &mut s);
            s.push('\n');
        }
        s
    }) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Loads `row\tcol\ttarget` lines without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_links(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let Some(cells) = wire::decode_edits(text(lines, len)) else { return -1 };
    match with_book(id, |wb| {
        let n = wb.load_links(sheet as usize, &cells);
        wb.take_link_changes();
        n
    }) {
        Some(Ok(n)) => n as i32,
        _ => -1,
    }
}

/// The current length of the undo history, to pass to `fc_undo_group` later.
#[no_mangle]
pub extern "C" fn fc_undo_mark(id: u32) -> i32 {
    with_book(id, |wb| wb.undo_mark() as i32).unwrap_or(-1)
}

/// Joins every undo step made since `mark` into one.
#[no_mangle]
pub extern "C" fn fc_undo_group(id: u32, mark: u32) -> i32 {
    match with_book(id, |wb| wb.undo_group(mark as usize)) {
        Some(()) => 0,
        None => -1,
    }
}

/// Number format codes inside a rectangle as `%\trow\tcol\tcode` lines.
#[no_mangle]
pub extern "C" fn fc_formats_in(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    let s = sheet as usize;
    match with_book(id, |wb| wb.formats_in(s, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 })) {
        Some(list) => {
            let list: Vec<(usize, Addr, String)> = list.into_iter().map(|(a, t)| (s, a, t)).collect();
            emit(&wire::encode_styles('%', Some(s), &list)) as i32
        }
        None => -1,
    }
}

/// Lists workbook names as `name\t=formula` lines.
#[no_mangle]
pub extern "C" fn fc_names(id: u32) -> i32 {
    match with_book(id, |wb| wb.names()) {
        Some(names) => {
            let mut s = String::new();
            for (n, f) in names {
                wire::escape(&n, &mut s);
                s.push('\t');
                wire::escape(&f, &mut s);
                s.push('\n');
            }
            emit(&s) as i32
        }
        None => -1,
    }
}

/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_rename_sheet(id: u32, sheet: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    match with_book(id, |wb| wb.rename_sheet(sheet as usize, &name)) {
        Some(Ok(())) => 0,
        _ => -1,
    }
}

#[no_mangle]
pub extern "C" fn fc_undo(id: u32) -> i32 {
    history(id, false)
}

#[no_mangle]
pub extern "C" fn fc_redo(id: u32) -> i32 {
    history(id, true)
}

#[no_mangle]
pub extern "C" fn fc_history(id: u32) -> i32 {
    with_book(id, |wb| i32::from(wb.can_undo()) | (i32::from(wb.can_redo()) << 1)).unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn fc_read(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    let (top, bottom) = (Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 });
    match with_book(id, |wb| wb.read(sheet as usize, top, bottom).map(|cells| wire::encode_cells(sheet as usize, &cells, &|s, a| wb.meta(s, a)))) {
        Some(Ok(s)) => emit(&s) as i32,
        _ => -1,
    }
}

/// Runs one what-if or analysis request (goal seek, data table, scenario, solver, forecast, report); the out buffer gets the reply text, a unit separator, then the encoded effect.
///
/// # Safety
/// `cmd` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_whatif(id: u32, cmd: *const u8, len: u32) -> i32 {
    let cmd = text(cmd, len).to_string();
    match with_book(id, |wb| {
        let (reply, fx) = wb.whatif_run(&cmd);
        format!("{reply}\u{1f}{}", wb.encode(&fx))
    }) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Loads the workbook's what-if definitions (data tables, scenarios, solver models) without an undo step.
///
/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_load_whatif(id: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    with_book(id, |wb| {
        wb.load_whatif(&list);
        list.len() as i32
    })
    .unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn fc_extent(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.extent(sheet as usize)) {
        Some(Ok(Some(a))) => emit(&format!("{}\t{}", a.row, a.col)) as i32,
        Some(Ok(None)) => emit("") as i32,
        _ => -1,
    }
}

/// Trace Precedents (`dependents` 0) or Trace Dependents (1) arrows for one cell, as `fromSheet\tr0\tc0\tr1\tc1\ttoSheet\trow\tcol\tlevel` lines.
#[no_mangle]
pub extern "C" fn fc_trace(id: u32, sheet: u32, row: u32, col: u32, dependents: u32, levels: u32) -> i32 {
    let at = Addr { row, col };
    match with_book(id, |wb| formcel_core::audit::encode_arrows(&if dependents == 0 { wb.precedent_arrows(sheet as usize, at, levels) } else { wb.dependent_arrows(sheet as usize, at, levels) })) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// The Evaluate Formula states of a formula cell as `before\tevaluating\tafter` lines.
#[no_mangle]
pub extern "C" fn fc_eval_steps(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    match with_book(id, |wb| {
        let mut out = String::new();
        for [b, c, a] in wb.evaluate_steps(sheet as usize, Addr { row, col }) {
            wire::escape(&b, &mut out);
            out.push('\t');
            wire::escape(&c, &mut out);
            out.push('\t');
            wire::escape(&a, &mut out);
            out.push('\n');
        }
        out
    }) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn fc_edge(id: u32, sheet: u32, row: u32, col: u32, dir: u32) -> i32 {
    let d = match dir {
        0 => Dir::Up,
        1 => Dir::Down,
        2 => Dir::Left,
        _ => Dir::Right,
    };
    match with_book(id, |wb| wb.edge(sheet as usize, Addr { row, col }, d)) {
        Some(Ok(a)) => emit(&format!("{}\t{}", a.row, a.col)) as i32,
        _ => -1,
    }
}

fn prot_sheet(sheet: u32) -> Option<usize> {
    if sheet == u32::MAX {
        None
    } else {
        Some(sheet as usize)
    }
}

fn verdict(r: Option<Result<(), String>>) -> i32 {
    match r {
        Some(Ok(())) => emit("") as i32,
        Some(Err(m)) => emit(&m) as i32,
        None => emit("No such workbook.") as i32,
    }
}

/// A sheet's protection state as lines (sheet 4294967295 for the workbook's).
#[no_mangle]
pub extern "C" fn fc_protect_text(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.protection_lines(prot_sheet(sheet)).join("\n")) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_protect_load(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    match with_book(id, |wb| wb.load_protection(prot_sheet(sheet), &list)) {
        Some(true) => 0,
        _ => -1,
    }
}

/// Protects or unprotects a sheet; the out text is empty on success or the reason it was refused.
///
/// # Safety
/// `pw` and `allow` must point at readable bytes of their lengths.
#[no_mangle]
pub unsafe extern "C" fn fc_protect_sheet(id: u32, sheet: u32, on: u32, pw: *const u8, pw_len: u32, allow: *const u8, allow_len: u32) -> i32 {
    let (pw, allow) = (text(pw, pw_len).to_string(), text(allow, allow_len).to_string());
    let list: Vec<String> = allow.split(',').filter(|a| !a.is_empty()).map(String::from).collect();
    verdict(with_book(id, |wb| wb.protect_sheet(sheet as usize, on != 0, &pw, &list)))
}

/// # Safety
/// `pw` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_protect_book(id: u32, on: u32, pw: *const u8, len: u32) -> i32 {
    let pw = text(pw, len).to_string();
    verdict(with_book(id, |wb| wb.protect_book(on != 0, &pw)))
}

#[no_mangle]
pub extern "C" fn fc_mark_final(id: u32, on: u32) -> i32 {
    verdict(with_book(id, |wb| {
        wb.mark_final(on != 0);
        Ok(())
    }))
}

/// Marks a rectangle locked or unlocked and hidden or shown (2 leaves a flag as it is).
#[no_mangle]
pub extern "C" fn fc_set_flags(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32, unlocked: u32, hidden: u32) -> i32 {
    let area = formcel_core::formula::Area { r0: r0.min(r1), c0: c0.min(c1), r1: r0.max(r1), c1: c0.max(c1) };
    let pick = |v: u32| if v > 1 { None } else { Some(v == 1) };
    verdict(with_book(id, |wb| wb.set_cell_flags(sheet as usize, area, pick(unlocked), pick(hidden))))
}

/// The flags of a cell: 1 unlocked, 2 hidden formula.
#[no_mangle]
pub extern "C" fn fc_cell_flags(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    with_book(id, |wb| i32::from(wb.cell_flags(sheet as usize, row, col))).unwrap_or(-1)
}

/// # Safety
/// `lines` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_edit_ranges(id: u32, sheet: u32, lines: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(lines, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    let ranges = formcel_core::protect::SheetProt::parse(&list).ranges;
    verdict(with_book(id, |wb| wb.set_edit_ranges(sheet as usize, ranges)))
}

/// # Safety
/// `name` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_set_user(id: u32, name: *const u8, len: u32) -> i32 {
    let name = text(name, len).to_string();
    with_book(id, |wb| wb.set_user(&name)).map_or(-1, |()| 0)
}

/// Asks whether an operation may run on a rectangle; the out text is empty when it may, else the reason.
///
/// # Safety
/// `op` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_guard(id: u32, sheet: u32, op: *const u8, len: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    let op = text(op, len).to_string();
    let area = formcel_core::formula::Area { r0: r0.min(r1), c0: c0.min(c1), r1: r0.max(r1), c1: c0.max(c1) };
    verdict(with_book(id, |wb| wb.guard(&op, sheet as usize, area)))
}

#[no_mangle]
pub extern "C" fn fc_hides_formula(id: u32, sheet: u32, row: u32, col: u32) -> i32 {
    with_book(id, |wb| i32::from(wb.hides_formula(sheet as usize, row, col))).unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn fc_bypass(id: u32, on: u32) -> i32 {
    with_book(id, |wb| wb.set_bypass(on != 0)).map_or(-1, |()| 0)
}

#[no_mangle]
pub extern "C" fn fc_is_final(id: u32) -> i32 {
    with_book(id, |wb| i32::from(wb.is_final())).unwrap_or(-1)
}

/// The message of the last refused edit, for the window to show.
#[no_mangle]
pub extern "C" fn fc_last_refusal(id: u32) -> i32 {
    emit(&with_book(id, |wb| wb.take_refusal()).unwrap_or_default()) as i32
}

/// Keys of host calls (web functions, custom functions) the engine is waiting on, one per line; `all` lists the cached ones instead.
#[no_mangle]
pub extern "C" fn fc_host_keys(id: u32, all: u32) -> i32 {
    let mut s = String::new();
    let Some(keys) = with_book(id, |wb| if all != 0 { wb.host_keys() } else { wb.host_pending() }) else { return -1 };
    for k in keys {
        wire::escape(&k, &mut s);
        s.push('\n');
    }
    emit(&s) as i32
}

/// Stores the result of one host call (rows split by newline, cells by tab, each `n:`, `t:`, `b:`, `e:` or `z:`); `has` 0 forgets it. The out buffer gets the changed cells.
///
/// # Safety
/// `key` and `data` must point at `key_len` and `data_len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_host_set(id: u32, key: *const u8, key_len: u32, data: *const u8, data_len: u32, has: u32) -> i32 {
    let (key, data) = (wire::unescape(text(key, key_len)), text(data, data_len).to_string());
    match with_book(id, |wb| {
        let c = wb.host_set(&key, if has != 0 { Some(&data) } else { None });
        wire::encode_changed(&c, &|s, a| wb.meta(s, a))
    }) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Registers the names of custom functions the window computes; the out buffer gets the changed cells.
///
/// # Safety
/// `names` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn fc_host_custom(id: u32, names: *const u8, len: u32) -> i32 {
    let list: Vec<String> = text(names, len).split('\n').filter(|l| !l.is_empty()).map(String::from).collect();
    match with_book(id, |wb| {
        let c = wb.host_custom(&list);
        wire::encode_changed(&c, &|s, a| wb.meta(s, a))
    }) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}

/// Forgets every cached host result and recalculates; the out buffer gets the changed cells.
#[no_mangle]
pub extern "C" fn fc_host_clear(id: u32) -> i32 {
    match with_book(id, |wb| {
        let c = wb.host_clear();
        wire::encode_changed(&c, &|s, a| wb.meta(s, a))
    }) {
        Some(s) => emit(&s) as i32,
        None => -1,
    }
}
