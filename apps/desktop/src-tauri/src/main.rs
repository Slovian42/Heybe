// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Closing the window must not stop background tasks: the task manager runs as a
    // separate launchd-managed service (stage 5), not inside this process.
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Heybe desktop");
}
