# src-tauri HASHOUT log

### src/win_job.rs, src/engine_start.rs, src/main.rs · the shell side of starting and stopping on Windows
- refers-to: src/win_job.rs (hold, end), src/engine_start.rs (ADDRESS_WAIT, heard, Tail, sentence, page_script, engine_log), src/main.rs (spawn_engine, kill_engine, engine_failed, show_failure, failure_close), build.rs, capabilities/failure.json, Cargo.toml, Cargo.lock
- kind: decision
- logged: v0.47.0 · 2026-11-20

FormCel starts its engine with the standard library's process start, so this follows FormTools: `win_job::hold(&child)` right after the start puts the engine in a job object that ends it with the shell however the shell ends; `kill_engine` ends the job first on Windows. The engine gets the shell's process id in `FORMCEL_PARENT_PID`, the variable the engine already watches. The wait for the address is 90 seconds (the owner's D1, was 30), then 10 seconds for the window key.

A failed start (engine missing, not started, stopped, a wait that ran out, the window not opened) is shown in a window of FormCel's own, the owner's D4: no dialog crate. The page is `frontend/public/failure.html`, bundled with the app, never served by the engine. The shell hands it the sentence, the engine's last 12 lines (the key line never), the exit code and the log's path as data in an initialization script, so the text is in the page before its first paint; the window is made hidden in the theme's background colour and shown when the page has loaded (or after 2 seconds), then the loading window closes and the engine is ended. Its Close button, Escape and the window's own close end the app with exit code 1. If the window cannot be made, the text goes to standard error and the app exits. The splash's five second failure line is gone.

`windows-sys` 0.61.2 is the version already in the lock; the one line in the app's own entry was added by hand and proved with `cargo update --workspace` on the old lock in a scratch folder (diff empty).
