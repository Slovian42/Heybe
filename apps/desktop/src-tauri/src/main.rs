// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, RunEvent, WindowEvent};

fn main() {
    // 19-c: closing the window only hides it; chat/tasks keep running in the local
    // service. Quit (Cmd+Q / menu) exits. Launch at login stays off by default (D9).
    // 19-b (sidecar lifecycle) will start/stop the service here; not in this PR.
    let app = tauri::Builder::default()
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Heybe desktop");

    app.run(|handle, event| {
        // macOS: clicking the Dock icon brings the hidden window back.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (handle, event);
    });
}
