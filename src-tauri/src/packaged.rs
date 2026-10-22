use std::path::PathBuf;
use std::process::Command;

const ENGINE: &str = if cfg!(windows) { "formcel-engine.exe" } else { "formcel-engine" };

pub fn engine_folder() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    [dir.join("../Resources/engine"), dir.join("engine")]
        .into_iter()
        .map(|folder| folder.join(ENGINE))
        .find(|program| program.is_file())
}

fn sidecar() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let program = exe.parent()?.join(ENGINE);
    program.is_file().then_some(program)
}

fn python_module() -> Option<Command> {
    let root = PathBuf::from(std::env::var_os("FORMCEL_BACKEND_DIR")?);
    let python = std::env::var("FORMCEL_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let mut command = Command::new(python);
    command.arg("engine_main.py").current_dir(root);
    Some(command)
}

pub fn engine_command() -> Option<Command> {
    if let Some(program) = engine_folder().or_else(sidecar) {
        return Some(Command::new(program));
    }
    python_module()
}
