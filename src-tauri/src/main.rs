#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};

mod text_edit;

const PORT: u16 = 8199;

struct Engine(Mutex<Option<Child>>);

fn resource(app: &tauri::AppHandle, rel: &str) -> PathBuf {
    app.path().resource_dir().map(|d| d.join(rel)).unwrap_or_else(|_| PathBuf::from(rel))
}

fn python() -> String {
    std::env::var("FORMCEL_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() })
}

fn start(app: &tauri::AppHandle) -> Option<Child> {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
        return None;
    }
    let root = resource(app, "engine");
    Command::new(python())
        .args(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", &PORT.to_string()])
        .current_dir(&root)
        .env("FORMCEL_WINDOW_DIR", root.join("window"))
        .env("PYTHONPATH", &root)
        .stdin(Stdio::null())
        .spawn()
        .ok()
}

fn wait_ready() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    let end = Instant::now() + Duration::from_secs(20);
    while Instant::now() < end {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn main() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![text_edit::text_edit])
        .setup(|app| {
            let child = start(app.handle());
            app.manage(Engine(Mutex::new(child)));
            let window = app.get_webview_window("main").expect("main window");
            if wait_ready() {
                let _ = window.show();
            } else {
                let _ = window.eval("document.body.textContent = 'The FormCel engine did not start. Check that Python 3 with the formcel_engine module is installed.'");
                let _ = window.show();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("FormCel could not start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(engine) = handle.try_state::<Engine>() {
                if let Some(mut child) = engine.0.lock().ok().and_then(|mut g| g.take()) {
                    let _ = child.kill();
                }
            }
        }
    });
}
