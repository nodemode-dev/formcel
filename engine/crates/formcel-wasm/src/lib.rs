use formcel_core::{parse_a1, Workbook, VERSION};
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
