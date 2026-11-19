#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

mod packaged;
mod reveal;
mod system_fonts;
mod text_edit;
mod traffic_lights;

const FALLBACK_SIZE: (f64, f64) = (1440.0, 900.0);
const MIN_SIZE: (f64, f64) = (800.0, 520.0);
const SCREEN_FRACTION: f64 = 0.9;
const ENGINE_WAIT: Duration = Duration::from_secs(30);
const KEY_GRACE: Duration = Duration::from_secs(10);

struct Engine(Mutex<Option<Child>>);

fn port_in(line: &str) -> Option<u16> {
    let rest = &line[line.find("http://127.0.0.1:")? + "http://127.0.0.1:".len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

enum Heard {
    Port(u16),
    Key(String),
}

fn key_in(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("formcel-window-key: ")?;
    (rest.len() >= 32 && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then(|| rest.to_string())
}

fn spawn_engine() -> Option<(Child, mpsc::Receiver<Heard>)> {
    let mut command = packaged::engine_command()?;
    command.env("FORMCEL_PORT", "0").env("FORMCEL_WINDOW_KEY_STDOUT", "1").env("FORMCEL_HOST", "127.0.0.1").env("FORMCEL_PARENT_PID", std::process::id().to_string()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().ok()?;
    let (tx, rx) = mpsc::channel();
    let out = child.stdout.take()?;
    let err = child.stderr.take()?;
    for (pipe, keyed) in [(Box::new(out) as Box<dyn std::io::Read + Send>, true), (Box::new(err), false)] {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if keyed {
                    if let Some(key) = key_in(&line) {
                        let _ = tx.send(Heard::Key(key));
                        continue;
                    }
                }
                if let Some(port) = port_in(&line) {
                    let _ = tx.send(Heard::Port(port));
                }
            }
        });
    }
    Some((child, rx))
}

fn kill_engine(app: &tauri::AppHandle) {
    if let Some(engine) = app.try_state::<Engine>() {
        if let Some(mut child) = engine.0.lock().ok().and_then(|mut g| g.take()) {
            let _ = child.kill();
        }
    }
}

fn engine_failed(app: &tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.eval("window.formcelSplashFailed && window.formcelSplashFailed()");
    }
    std::thread::sleep(Duration::from_secs(5));
    kill_engine(app);
    app.exit(1);
}

fn open_main(app: &tauri::AppHandle, port: u16, key: Option<String>) {
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
        }
        Err(_) => engine_failed(app),
    }
}

fn main() {
    reveal::mark_launch();
    let app = tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, WindowEvent::Resized(_) | WindowEvent::Focused(_) | WindowEvent::ThemeChanged(_) | WindowEvent::ScaleFactorChanged { .. })
            {
                traffic_lights::place(window);
            }
        })
        .invoke_handler(tauri::generate_handler![traffic_lights::set_window_title, reveal::app_ready, text_edit::text_edit, system_fonts::system_fonts])
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            reveal::round_splash(&handle);
            let Some((child, rx)) = spawn_engine() else {
                std::thread::spawn(move || engine_failed(&handle));
                return Ok(());
            };
            *app.state::<Engine>().0.lock().unwrap() = Some(child);
            std::thread::spawn(move || {
                let started = Instant::now();
                let (mut port, mut key, mut port_at) = (None, None, None);
                while port.is_none() || key.is_none() {
                    let deadline = port_at.map_or(started + ENGINE_WAIT, |at: Instant| at + KEY_GRACE);
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match rx.recv_timeout(deadline - now) {
                        Ok(Heard::Port(found)) if port.is_none() => {
                            port = Some(found);
                            port_at = Some(Instant::now());
                        }
                        Ok(Heard::Key(found)) if key.is_none() => key = Some(found),
                        Ok(_) => continue,
                        Err(_) => break,
                    }
                }
                match (port, key) {
                    (Some(found), Some(value)) => open_main(&handle, found, Some(value)),
                    _ => engine_failed(&handle),
                }
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
