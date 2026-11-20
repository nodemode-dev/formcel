use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const APP: &str = "FormCel";
pub const SHELL_ENV: &str = "FORMCEL_PARENT_PID";
pub const ADDRESS_WAIT: Duration = Duration::from_secs(90);
pub const KEY_WAIT: Duration = Duration::from_secs(10);
pub const EXIT_WAIT: Duration = Duration::from_secs(1);
pub const EXIT_STEP: Duration = Duration::from_millis(50);
pub const SHOW_WAIT: Duration = Duration::from_secs(2);
pub const BUSY_CODE: i32 = 2;
pub const FAILURE_LABEL: &str = "failure";
pub const FAILURE_PAGE: &str = "failure.html";
pub const FAILURE_SIZE: (f64, f64) = (560.0, 420.0);
pub const FAILURE_DARK: (u8, u8, u8) = (17, 17, 17);
pub const FAILURE_LIGHT: (u8, u8, u8) = (236, 235, 230);
const DATA_NAME: &str = "FormCel";
const DATA_ENV: &str = "FORMCEL_DATA_DIR";
const LOG_NAME: &str = "formcel-engine.log";
const KEY_MARK: &str = "window-key";
const TAIL_LINES: usize = 12;
const LINE_CHARS: usize = 300;
const NOTHING: &str = "The engine wrote nothing before that.";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Wait {
    Address,
    Key,
}

impl Wait {
    pub fn limit(self) -> Duration {
        match self {
            Wait::Address => ADDRESS_WAIT,
            Wait::Key => KEY_WAIT,
        }
    }

    pub fn what(self) -> &'static str {
        match self {
            Wait::Address => "its engine to say which address it serves on",
            Wait::Key => "its engine to hand over the key for the window",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Failure {
    Missing,
    NotStarted(String),
    Stopped(Option<i32>),
    TimedOut(Wait),
    Window,
}

pub enum Heard {
    Port(u16),
    Key(String),
}

#[derive(Default)]
pub struct Tail(VecDeque<String>);

impl Tail {
    pub fn push(&mut self, line: &str) {
        if line.contains(KEY_MARK) {
            return;
        }
        let clean: String = line.chars().filter(|c| !c.is_control()).take(LINE_CHARS).collect();
        if clean.trim().is_empty() {
            return;
        }
        if self.0.len() == TAIL_LINES {
            self.0.pop_front();
        }
        self.0.push_back(clean);
    }

    pub fn lines(&self) -> Vec<String> {
        self.0.iter().cloned().collect()
    }
}

pub fn heard_within(rx: &mpsc::Receiver<Heard>, address: Duration, key_after: Duration) -> Result<(u16, String), Failure> {
    let started = Instant::now();
    let mut port: Option<u16> = None;
    let mut key: Option<String> = None;
    let mut port_at: Option<Instant> = None;
    loop {
        if let (Some(found), Some(value)) = (port, key.as_ref()) {
            return Ok((found, value.clone()));
        }
        let (waiting, deadline) = match port_at {
            Some(at) => (Wait::Key, at + key_after),
            None => (Wait::Address, started + address),
        };
        let now = Instant::now();
        if now >= deadline {
            return Err(Failure::TimedOut(waiting));
        }
        match rx.recv_timeout(deadline - now) {
            Ok(Heard::Port(found)) if port.is_none() => {
                port = Some(found);
                port_at = Some(Instant::now());
            }
            Ok(Heard::Key(found)) if key.is_none() => key = Some(found),
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => return Err(Failure::TimedOut(waiting)),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(Failure::Stopped(None)),
        }
    }
}

pub fn heard(rx: &mpsc::Receiver<Heard>) -> Result<(u16, String), Failure> {
    heard_within(rx, ADDRESS_WAIT, KEY_WAIT)
}

pub fn sentence(failure: &Failure) -> String {
    match failure {
        Failure::Missing => format!("{APP} could not start: its engine program is missing from the install. Installing {APP} again puts it back."),
        Failure::NotStarted(reason) => format!("{APP} could not start its engine: {reason}"),
        Failure::Stopped(Some(BUSY_CODE)) => format!("{APP} could not start: another copy of its engine holds its data folder."),
        Failure::Stopped(Some(code)) => format!("{APP} could not start: its engine stopped with code {code} before the window could open."),
        Failure::Stopped(None) => format!("{APP} could not start: its engine stopped before the window could open."),
        Failure::TimedOut(wait) => format!("{APP} could not start: it waited {} seconds for {} and that did not happen.", wait.limit().as_secs(), wait.what()),
        Failure::Window => format!("{APP} could not open its window."),
    }
}

fn nothing_written(failure: &Failure, tail: &[String]) -> bool {
    tail.is_empty() && matches!(failure, Failure::Stopped(_) | Failure::TimedOut(_))
}

fn exit_code(failure: &Failure) -> Option<i32> {
    match failure {
        Failure::Stopped(code) => *code,
        _ => None,
    }
}

pub fn message(failure: &Failure, tail: &[String], log: Option<&Path>) -> String {
    let mut text = sentence(failure);
    if !tail.is_empty() {
        text.push_str("\n\nThe engine's last lines:\n");
        text.push_str(&tail.join("\n"));
    } else if nothing_written(failure, tail) {
        text.push_str("\n\n");
        text.push_str(NOTHING);
    }
    if let Some(code) = exit_code(failure) {
        text.push_str(&format!("\n\nThe engine's exit code: {code}"));
    }
    if let Some(path) = log {
        text.push_str("\n\nThe engine's log: ");
        text.push_str(&path.to_string_lossy());
    }
    text
}

pub fn page_data(failure: &Failure, tail: &[String], log: Option<&Path>) -> String {
    serde_json::json!({
        "sentence": sentence(failure),
        "lines": tail,
        "note": nothing_written(failure, tail).then_some(NOTHING),
        "code": exit_code(failure),
        "log": log.map(|path| path.to_string_lossy().into_owned()),
    })
    .to_string()
}

pub fn page_script(failure: &Failure, tail: &[String], log: Option<&Path>) -> String {
    format!("window.__FORMCEL_FAILURE = {};", page_data(failure, tail, log))
}

pub fn data_folder(var: &dyn Fn(&str) -> Option<String>, home: Option<&Path>) -> Option<PathBuf> {
    if let Some(raw) = var(DATA_ENV) {
        return match (raw.strip_prefix('~'), home) {
            (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\') => {
                Some(home.join(rest.trim_start_matches(['/', '\\'])))
            }
            _ => Some(PathBuf::from(raw)),
        };
    }
    Some(home?.join(DATA_NAME))
}

pub fn log_path(var: &dyn Fn(&str) -> Option<String>, home: Option<&Path>) -> Option<PathBuf> {
    data_folder(var, home).map(|folder| folder.join("Logs").join(LOG_NAME))
}

pub fn engine_log() -> Option<PathBuf> {
    log_path(&|name| std::env::var(name).ok(), std::env::home_dir().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn only(name: &'static str, value: &'static str) -> impl Fn(&str) -> Option<String> {
        move |asked| (asked == name).then(|| value.to_string())
    }

    #[test]
    fn the_tail_keeps_the_last_lines_and_never_the_window_key() {
        let mut tail = Tail::default();
        for n in 0..15 {
            tail.push(&format!("line {n}"));
        }
        tail.push("formcel-window-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        tail.push("   ");
        tail.push(&"x".repeat(1000));
        let lines = tail.lines();
        assert_eq!(lines.len(), TAIL_LINES);
        assert_eq!(lines[0], "line 4");
        assert_eq!(lines[TAIL_LINES - 1].len(), LINE_CHARS);
        assert!(lines.iter().all(|line| !line.contains("window-key")));
    }

    #[test]
    fn every_failure_has_its_sentence_the_last_lines_the_exit_code_and_the_log() {
        let log = Path::new("/data/Logs/formcel-engine.log");
        let said = vec!["formcel is already running on /data (engine process 7).".to_string()];
        let busy = message(&Failure::Stopped(Some(BUSY_CODE)), &said, Some(log));
        assert!(busy.starts_with("FormCel could not start: another copy of its engine holds its data folder."));
        assert!(busy.contains("The engine's last lines:\nformcel is already running on /data (engine process 7)."));
        assert!(busy.contains("The engine's exit code: 2"));
        assert!(busy.ends_with("The engine's log: /data/Logs/formcel-engine.log"));
        assert!(message(&Failure::Stopped(Some(3)), &[], Some(log)).contains("stopped with code 3"));
        assert!(message(&Failure::Stopped(None), &[], None).ends_with("The engine wrote nothing before that."));
        assert!(message(&Failure::Missing, &[], None).ends_with("puts it back."));
        assert!(sentence(&Failure::NotStarted("Access is denied.".to_string())).ends_with("its engine: Access is denied."));
        assert_eq!(sentence(&Failure::Window), "FormCel could not open its window.");
    }

    #[test]
    fn a_wait_that_runs_out_says_how_long_and_for_what() {
        assert!(sentence(&Failure::TimedOut(Wait::Address)).contains("waited 90 seconds for its engine to say which address it serves on"));
        assert!(sentence(&Failure::TimedOut(Wait::Key)).contains("waited 10 seconds for its engine to hand over the key for the window"));
    }

    #[test]
    fn the_page_gets_the_sentence_the_lines_the_code_and_the_log_as_data() {
        let log = Path::new("/data/Logs/formcel-engine.log");
        let said = vec!["a \"quoted\" line </script> with a back\\slash".to_string()];
        let script = page_script(&Failure::Stopped(Some(5)), &said, Some(log));
        let data: serde_json::Value = serde_json::from_str(script.strip_prefix("window.__FORMCEL_FAILURE = ").unwrap().strip_suffix(';').unwrap()).unwrap();
        assert_eq!(data["sentence"], "FormCel could not start: its engine stopped with code 5 before the window could open.");
        assert_eq!(data["lines"][0], said[0].as_str());
        assert_eq!(data["code"], 5);
        assert_eq!(data["log"], "/data/Logs/formcel-engine.log");
        assert!(data["note"].is_null());
        let quiet: serde_json::Value = serde_json::from_str(&page_data(&Failure::TimedOut(Wait::Address), &[], None)).unwrap();
        assert_eq!(quiet["note"], "The engine wrote nothing before that.");
        assert!(quiet["code"].is_null() && quiet["log"].is_null());
        assert_eq!(quiet["lines"].as_array().unwrap().len(), 0);
        assert!(serde_json::from_str::<serde_json::Value>(&page_data(&Failure::Missing, &[], None)).unwrap()["note"].is_null());
    }

    #[test]
    fn the_wait_ends_with_the_address_and_the_key_or_says_what_was_missing() {
        let short = Duration::from_millis(150);
        let (tx, rx) = mpsc::channel();
        tx.send(Heard::Key("k".repeat(40))).unwrap();
        tx.send(Heard::Port(4321)).unwrap();
        tx.send(Heard::Port(1)).unwrap();
        assert_eq!(heard_within(&rx, short, short), Ok((4321, "k".repeat(40))));

        let (tx, rx) = mpsc::channel::<Heard>();
        assert_eq!(heard_within(&rx, short, short), Err(Failure::TimedOut(Wait::Address)));
        tx.send(Heard::Key("k".repeat(40))).unwrap();
        assert_eq!(heard_within(&rx, short, short), Err(Failure::TimedOut(Wait::Address)));

        let (tx, rx) = mpsc::channel();
        tx.send(Heard::Port(4321)).unwrap();
        let began = Instant::now();
        assert_eq!(heard_within(&rx, Duration::from_secs(30), short), Err(Failure::TimedOut(Wait::Key)));
        assert!(began.elapsed() < Duration::from_secs(5));
        drop(tx);

        let (tx, rx) = mpsc::channel();
        tx.send(Heard::Port(4321)).unwrap();
        drop(tx);
        assert_eq!(heard_within(&rx, Duration::from_secs(30), Duration::from_secs(30)), Err(Failure::Stopped(None)));
    }

    #[test]
    fn the_log_is_where_the_engine_writes_it() {
        let home = Path::new("/home/u");
        let none = |_: &str| None;
        let end = Path::new("Logs").join("formcel-engine.log");
        assert_eq!(log_path(&none, Some(home)), Some(home.join("FormCel").join(&end)));
        assert_eq!(log_path(&only("FORMCEL_DATA_DIR", "/d/x"), None), Some(Path::new("/d/x").join(&end)));
        assert_eq!(log_path(&only("FORMCEL_DATA_DIR", "~/x"), Some(home)), Some(home.join("x").join(&end)));
        assert_eq!(log_path(&only("FORMCEL_DATA_DIR", "~"), Some(home)), Some(home.join(&end)));
        assert_eq!(log_path(&only("FORMCEL_DATA_DIR", "~other/x"), Some(home)), Some(Path::new("~other/x").join(&end)));
        assert_eq!(log_path(&none, None), None);
    }
}
