#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use engine_start::{Failure, Heard, Tail};

mod engine_start;
mod packaged;
mod reveal;
mod system_fonts;
mod text_edit;
mod traffic_lights;
#[cfg(windows)]
mod win_job;

const FALLBACK_SIZE: (f64, f64) = (1440.0, 900.0);
const MIN_SIZE: (f64, f64) = (800.0, 520.0);
const SCREEN_FRACTION: f64 = 0.9;

static FAILURE_SHOWN: AtomicBool = AtomicBool::new(false);

struct Engine(Mutex<Option<Child>>);

type Started = (Child, mpsc::Receiver<Heard>, Arc<Mutex<Tail>>);

fn port_in(line: &str) -> Option<u16> {
    let rest = &line[line.find("http://127.0.0.1:")? + "http://127.0.0.1:".len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn key_in(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("formcel-window-key: ")?;
    (rest.len() >= 32 && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then(|| rest.to_string())
}

fn spawn_engine() -> Result<Started, Failure> {
    let mut command = packaged::engine_command().ok_or(Failure::Missing)?;
    command
        .env("FORMCEL_PORT", "0")
        .env("FORMCEL_WINDOW_KEY_STDOUT", "1")
        .env("FORMCEL_HOST", "127.0.0.1")
        .env(engine_start::SHELL_ENV, std::process::id().to_string())
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|err| Failure::NotStarted(err.to_string()))?;
    #[cfg(windows)]
    win_job::hold(&child);
    let (tx, rx) = mpsc::channel();
    let tail = Arc::new(Mutex::new(Tail::default()));
    let out = child.stdout.take().map(|pipe| Box::new(pipe) as Box<dyn std::io::Read + Send>);
    let err = child.stderr.take().map(|pipe| Box::new(pipe) as Box<dyn std::io::Read + Send>);
    for (pipe, keyed) in [(out, true), (err, false)] {
        let Some(pipe) = pipe else { continue };
        let tx = tx.clone();
        let tail = Arc::clone(&tail);
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if keyed {
                    if let Some(key) = key_in(&line) {
                        let _ = tx.send(Heard::Key(key));
                        continue;
                    }
                }
                if let Ok(mut kept) = tail.lock() {
                    kept.push(&line);
                }
                if let Some(port) = port_in(&line) {
                    let _ = tx.send(Heard::Port(port));
                }
            }
        });
    }
    Ok((child, rx, tail))
}

fn kill_engine(app: &tauri::AppHandle) {
    if let Some(engine) = app.try_state::<Engine>() {
        if let Some(mut child) = engine.0.lock().ok().and_then(|mut g| g.take()) {
            #[cfg(windows)]
            win_job::end();
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn engine_exit_code(app: &tauri::AppHandle) -> Option<i32> {
    let engine = app.try_state::<Engine>()?;
    let mut waited = Duration::ZERO;
    while waited < engine_start::EXIT_WAIT {
        if let Ok(mut slot) = engine.0.lock() {
            match slot.as_mut().map(|child| child.try_wait()) {
                Some(Ok(Some(status))) => return status.code(),
                Some(Ok(None)) => {}
                _ => return None,
            }
        }
        std::thread::sleep(engine_start::EXIT_STEP);
        waited += engine_start::EXIT_STEP;
    }
    None
}

fn show_failure(app: &tauri::AppHandle) {
    if FAILURE_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(engine_start::FAILURE_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    kill_engine(app);
}

#[tauri::command]
fn failure_close(app: tauri::AppHandle) {
    kill_engine(&app);
    app.exit(1);
}

fn engine_failed(app: &tauri::AppHandle, failure: Failure, tail: &[String]) {
    let failure = match failure {
        Failure::Stopped(None) => Failure::Stopped(engine_exit_code(app)),
        other => other,
    };
    let log = engine_start::engine_log();
    let light = app.get_webview_window("splash").and_then(|splash| splash.theme().ok()) == Some(tauri::Theme::Light);
    let (r, g, b) = if light { engine_start::FAILURE_LIGHT } else { engine_start::FAILURE_DARK };
    let built = WebviewWindowBuilder::new(app, engine_start::FAILURE_LABEL, WebviewUrl::App(engine_start::FAILURE_PAGE.into()))
        .title(engine_start::APP)
        .visible(false)
        .background_color(tauri::window::Color(r, g, b, 255))
        .inner_size(engine_start::FAILURE_SIZE.0, engine_start::FAILURE_SIZE.1)
        .min_inner_size(engine_start::FAILURE_SIZE.0 * 0.75, engine_start::FAILURE_SIZE.1 * 0.75)
        .center()
        .focused(true)
        .initialization_script(engine_start::page_script(&failure, tail, log.as_deref()))
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                show_failure(window.app_handle());
            }
        })
        .build();
    if built.is_err() {
        eprintln!("{}", engine_start::message(&failure, tail, log.as_deref()));
        kill_engine(app);
        app.exit(1);
        return;
    }
    std::thread::sleep(engine_start::SHOW_WAIT);
    show_failure(app);
}

fn open_main(app: &tauri::AppHandle, port: u16, key: Option<String>) -> bool {
    let (width, height) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let logical = monitor.size().to_logical::<f64>(monitor.scale_factor());
            (logical.width * SCREEN_FRACTION, logical.height * SCREEN_FRACTION)
        })
        .unwrap_or(FALLBACK_SIZE);
    let url = format!("http://127.0.0.1:{port}/");
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
        .title("FormCel")
        .visible(reveal::BUILD_VISIBLE)
        .background_color(reveal::BACKGROUND)
        .inner_size(width, height)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .center()
        .disable_drag_drop_handler();
    let origin = format!("http://127.0.0.1:{port}");
    let builder = match &key {
        Some(value) => builder.initialization_script(format!("if (window.location.origin === {origin:?}) {{ window.__FORMCEL_WINDOW_KEY = {value:?}; }}")),
        None => builder,
    };
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let builder = builder.on_page_load(|window, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            traffic_lights::place(&window.as_ref().window());
        }
    });
    match builder.build() {
        Ok(window) => {
            reveal::conceal(&window);
            traffic_lights::place(&window.as_ref().window());
            true
        }
        Err(_) => false,
    }
}

fn main() {
    reveal::mark_launch();
    let app = tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == engine_start::FAILURE_LABEL && matches!(event, WindowEvent::Destroyed) {
                kill_engine(window.app_handle());
                window.app_handle().exit(1);
                return;
            }
            if window.label() == "main"
                && matches!(event, WindowEvent::Resized(_) | WindowEvent::Focused(_) | WindowEvent::ThemeChanged(_) | WindowEvent::ScaleFactorChanged { .. })
            {
                traffic_lights::place(window);
            }
        })
        .invoke_handler(tauri::generate_handler![traffic_lights::set_window_title, reveal::app_ready, text_edit::text_edit, system_fonts::system_fonts, failure_close])
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            reveal::round_splash(&handle);
            let (child, rx, tail) = match spawn_engine() {
                Ok(started) => started,
                Err(failure) => {
                    std::thread::spawn(move || engine_failed(&handle, failure, &[]));
                    return Ok(());
                }
            };
            *app.state::<Engine>().0.lock().unwrap() = Some(child);
            std::thread::spawn(move || {
                let failure = match engine_start::heard(&rx) {
                    Ok((port, key)) => {
                        if open_main(&handle, port, Some(key)) {
                            return;
                        }
                        Failure::Window
                    }
                    Err(failure) => failure,
                };
                let lines = tail.lock().map(|kept| kept.lines()).unwrap_or_default();
                engine_failed(&handle, failure, &lines);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("FormCel could not start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            kill_engine(handle);
        }
    });
}
