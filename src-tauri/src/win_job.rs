use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::sync::OnceLock;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

static JOB: OnceLock<usize> = OnceLock::new();

fn create() -> usize {
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return 0;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            std::ptr::addr_of!(limits).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if set == 0 {
            CloseHandle(handle);
            return 0;
        }
        handle as usize
    }
}

fn job() -> Option<HANDLE> {
    let raw = *JOB.get_or_init(create);
    (raw != 0).then_some(raw as HANDLE)
}

pub fn hold(child: &Child) -> bool {
    match job() {
        Some(handle) => unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) != 0 },
        None => false,
    }
}

pub fn end() -> bool {
    match JOB.get().copied() {
        Some(raw) if raw != 0 => unsafe { TerminateJobObject(raw as HANDLE, 1) != 0 },
        _ => false,
    }
}
