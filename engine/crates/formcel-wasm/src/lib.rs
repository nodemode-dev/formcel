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
    match with_book(id, |wb| wb.apply(sheet as usize, &edits)) {
        Some(Ok(c)) => emit(&wire::encode_changed(&c)) as i32,
        _ => -1,
    }
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
    match with_book(id, |wb| if forward { wb.redo() } else { wb.undo() }) {
        Some(Some(e)) => emit(&wire::encode_effect(&e)) as i32,
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
    match with_book(id, |wb| wb.read(sheet as usize, top, bottom)) {
        Some(Ok(cells)) => emit(&wire::encode_cells(&cells)) as i32,
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
