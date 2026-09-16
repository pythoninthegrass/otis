pub(crate) mod sidecar;

use tauri::Manager;

pub fn run() {
    let runtime_dir = sidecar::resolve_runtime_dir();
    if let Err(e) = std::fs::create_dir_all(&runtime_dir) {
        eprintln!(
            "[sidecar] failed to create runtime dir {}: {e}",
            runtime_dir.display()
        );
    }
    // Must happen before the builder is even constructed, not inside setup() — see
    // delete_stale_bridge_file's doc comment for why setup()-timing isn't safe to rely on here.
    sidecar::delete_stale_bridge_file(&runtime_dir);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // The frontend talks to the sidecar over this rather than the browser's native WebSocket: WKWebView
        // enforces mixed-content/ATS rules against a native ws:// connection exactly as a real browser would,
        // which blocks it outright. This plugin runs the socket in Rust and streams frames over IPC instead.
        .plugin(tauri_plugin_websocket::init());

    // Debug-only automation/inspection bridge for the tauri-mcp MCP server; never compiled into a release
    // build. Bound to loopback only — the crate's own default is 0.0.0.0, which has no reason to be open here.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(
        tauri_plugin_mcp_bridge::Builder::new()
            .bind_address("127.0.0.1")
            .build(),
    );

    builder
        .invoke_handler(tauri::generate_handler![sidecar::bridge_endpoint])
        .setup(move |app| {
            sidecar::spawn(app, &runtime_dir);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                tauri::async_runtime::block_on(sidecar::shutdown_gracefully(app_handle));
            }
        });
}
