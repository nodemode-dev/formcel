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
        _ => -1,
    }
}

/// Sets the engine's clock (a serial date in local time) for TODAY and NOW; the window calls it before each request.
#[no_mangle]
pub extern "C" fn fc_set_clock(serial: f64) {
    formcel_core::numfmt::set_clock(serial);
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
        e.map(|e| wire::encode_effect(&e, &|s, a| wb.meta(s, a)))
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
    let r = with_book(id, |wb| wb.set_format(sheet as usize, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 }, &code).map(|e| wire::encode_effect(&e, &|s, a| wb.meta(s, a))));
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
    match with_book(id, |wb| wb.set_styles(sheet as usize, &list).map(|e| wire::encode_effect(&e, &|s, a| wb.meta(s, a)))) {
        Some(Ok(s)) => emit(&s) as i32,
        Some(Err(formcel_core::EngineError::BadStyle(_))) => -3,
        _ => -1,
    }
}

/// Styles inside a rectangle as `&\trow\tcol\tstyle` lines.
#[no_mangle]
pub extern "C" fn fc_styles_in(id: u32, sheet: u32, r0: u32, c0: u32, r1: u32, c1: u32) -> i32 {
    let s = sheet as usize;
    match with_book(id, |wb| wb.styles_in(s, Addr { row: r0, col: c0 }, Addr { row: r1, col: c1 })) {
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

#[no_mangle]
pub extern "C" fn fc_extent(id: u32, sheet: u32) -> i32 {
    match with_book(id, |wb| wb.extent(sheet as usize)) {
        Some(Ok(Some(a))) => emit(&format!("{}\t{}", a.row, a.col)) as i32,
        Some(Ok(None)) => emit("") as i32,
        _ => -1,
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
