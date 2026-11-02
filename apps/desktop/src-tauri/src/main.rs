// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod service;

use service::{ServiceInfo, Supervisor};
use tauri::{Manager, RunEvent, WindowEvent};

/// The UI asks for the service URL + startup token here (never via env/URL).
#[tauri::command]
fn service_info(state: tauri::State<'_, Supervisor>) -> ServiceInfo {
    state.info()
}

fn main() {
    // 19-b: start and supervise the local service (which owns the FastClaw gateway).
    let supervisor = Supervisor::new();
    supervisor.start();

    let app = tauri::Builder::default()
        .manage(supervisor)
        .invoke_handler(tauri::generate_handler![service_info])
        // 19-c: closing the window only hides it; chat/tasks keep running.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Heybe desktop");

    app.run(|handle, event| match event {
        // Quit (Cmd+Q / menu): stop service + gateway so no process is left behind.
        // Launch at login stays off by default (D9).
        RunEvent::Exit => handle.state::<Supervisor>().shutdown(),
        // macOS: clicking the Dock icon brings the hidden window back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        _ => {}
    });
}
