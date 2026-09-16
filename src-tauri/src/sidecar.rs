//! Spawns and supervises the `otis-runtime` Bun sidecar.
//!
//! ## Division of responsibility for shutdown
//!
//! The sidecar (owned by the TypeScript side, `src/desktop/sidecar/`) owns the graceful shutdown
//! path: it catches `SIGTERM`/`SIGINT` and also runs a disconnect watchdog that calls
//! `Application.shutdown()` if the bridge WebSocket drops and doesn't reconnect. Either path lets
//! `Application.shutdown()` finish before the process exits, which matters because it is
//! responsible for not orphaning `llama-server` children.
//!
//! `RunEvent::Exit` gives no guarantee the watchdog has already fired or even armed by the time it
//! runs — the webview's WebSocket may not have disconnected yet, and there's no renderer-side
//! `beforeunload` hook forcing it earlier. So `shutdown_gracefully` below sends the sidecar a real
//! `SIGTERM` itself (via the system `kill` command — `tauri_plugin_shell::process::CommandChild`
//! only exposes a hard `kill()`, `SIGKILL` on Unix, plus `write()`/`pid()`) to trigger its existing
//! handler directly, then waits up to `SHUTDOWN_GRACE_PERIOD` for it to exit on its own, and only
//! falls back to the hard `kill()` if it's still alive after that — SIGKILL can't be caught, so
//! that fallback is a last resort: it bypasses the sidecar's SIGTERM handler entirely and orphans
//! `llama-server` if it ever fires.
//!
//! ## Stale runtime file hazard
//!
//! A hard-killed sidecar (previous run, crash, `kill -9`) leaves `bridge.json` behind with a dead
//! port. `spawn` deletes it before starting a new process so a later launch never reads a stale
//! endpoint.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{Mutex, watch};

const SIDECAR_NAME: &str = "otis-runtime";

/// Mirrors `src/local/paths.ts`'s `localDataDirectory()` + `sidecarRuntimeDirectory()`: the same
/// `~/…/otis` data root every Otis frontend (CLI, TUI, desktop) shares, including the `OTIS_HOME`
/// override. Duplicated here in Rust rather than shelling out to Node, since this must resolve
/// before the sidecar exists to tell it. Kept intentionally tiny and mirrors paths.ts line for
/// line — if paths.ts's fallback logic changes, this must change with it.
pub fn resolve_runtime_dir() -> PathBuf {
    if let Ok(home) = std::env::var("OTIS_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("sidecar");
        }
    }

    let home_dir = std::env::var("HOME").unwrap_or_default();
    let data_root = if cfg!(target_os = "macos") {
        PathBuf::from(&home_dir)
            .join("Library")
            .join("Application Support")
            .join("otis")
    } else if cfg!(target_os = "windows") {
        let app_data = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(app_data).join("otis")
    } else {
        match std::env::var("XDG_DATA_HOME") {
            Ok(v) if !v.trim().is_empty() => PathBuf::from(v).join("otis"),
            _ => PathBuf::from(&home_dir)
                .join(".local")
                .join("share")
                .join("otis"),
        }
    };
    data_root.join("sidecar")
}

const BRIDGE_FILE_NAME: &str = "bridge.json";
const BRIDGE_POLL_INTERVAL: Duration = Duration::from_millis(50);
const BRIDGE_POLL_TIMEOUT: Duration = Duration::from_secs(5);
const SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_secs(5);

/// What the renderer needs to open the bridge WebSocket. Field names match the sidecar's
/// `bridge.json` and the TS-side `bridge.ts` contract exactly: `{port, token}`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BridgeEndpoint {
    pub port: u16,
    pub token: String,
}

/// The app data directory the sidecar was told to write `bridge.json` into, managed as Tauri
/// state so `bridge_endpoint` can find it without re-deriving it.
pub struct RuntimeDir(pub PathBuf);

/// Holds the spawned child for shutdown, plus a `watch` channel that the event pump flips once
/// the sidecar has exited on its own. `watch` (not `Notify`) specifically because it remembers
/// its last value — `shutdown_gracefully` must not miss a termination that happened before it
/// started waiting.
#[derive(Clone)]
pub struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
    terminated_tx: Arc<watch::Sender<bool>>,
    terminated_rx: watch::Receiver<bool>,
}

impl SidecarState {
    fn new(child: CommandChild) -> Self {
        let (terminated_tx, terminated_rx) = watch::channel(false);
        Self {
            child: Arc::new(Mutex::new(Some(child))),
            terminated_tx: Arc::new(terminated_tx),
            terminated_rx,
        }
    }

    fn mark_terminated(&self) {
        let _ = self.terminated_tx.send(true);
    }
}

/// Deletes any stale `bridge.json` left by a hard-killed previous run. Called from `run()` before
/// `Builder::build()` — not from inside `setup()` — so it is guaranteed to happen before the window can
/// possibly load and invoke `bridge_endpoint`. `setup()` is documented to run before window content starts
/// loading, but that ordering isn't a contract worth betting a race on: `bridge_endpoint`'s poll loop
/// returns on the first bridge.json it can parse, stale or not, so a webview that got there first would
/// silently hand the renderer a dead port and token.
pub fn delete_stale_bridge_file(runtime_dir: &Path) {
    let bridge_file = runtime_dir.join(BRIDGE_FILE_NAME);
    if let Err(e) = std::fs::remove_file(&bridge_file)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!(
            "[sidecar] failed to remove stale bridge file at {}: {e}",
            bridge_file.display()
        );
    }
}

/// Spawns the sidecar and manages `SidecarState`/`RuntimeDir` on `app`. Mirrors
/// `~/git/mt/crates/mt-tauri/src/sidecar.rs`'s spawn and event-pump shape; every failure path here is
/// logged rather than propagated, since a missing sidecar binary must not prevent the rest of the app
/// (and its window) from starting. Callers must call `delete_stale_bridge_file` first.
pub fn spawn<R: Runtime>(app: &tauri::App<R>, runtime_dir: &Path) {
    app.manage(RuntimeDir(runtime_dir.to_path_buf()));

    let command = match app.shell().sidecar(SIDECAR_NAME) {
        Ok(command) => command,
        Err(e) => {
            eprintln!(
                "[sidecar] not started: {SIDECAR_NAME} is not configured under tauri.conf.json > bundle > externalBin, or the binary is missing for this platform ({e})"
            );
            return;
        }
    };

    let Some(runtime_dir_str) = runtime_dir.to_str() else {
        eprintln!(
            "[sidecar] not started: runtime dir is not valid UTF-8: {}",
            runtime_dir.display()
        );
        return;
    };

    let (mut rx, child) = match command.args(["--runtime-dir", runtime_dir_str]).spawn() {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[sidecar] not started: failed to spawn {SIDECAR_NAME}: {e}");
            return;
        }
    };

    let state = SidecarState::new(child);
    app.manage(state.clone());

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Error(err) => {
                    eprintln!("[sidecar] command error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!(
                        "[sidecar] terminated: code={:?} signal={:?}",
                        payload.code, payload.signal
                    );
                    *state.child.lock().await = None;
                    state.mark_terminated();
                    break;
                }
                _ => {}
            }
        }
    });
}

/// Polls for `bridge.json` to appear (the sidecar may still be booting when the renderer's first
/// `invoke` lands) and returns its contents. Poll shape mirrors mt's health-probe retry loop.
#[tauri::command]
pub async fn bridge_endpoint(runtime_dir: State<'_, RuntimeDir>) -> Result<BridgeEndpoint, String> {
    let bridge_file = runtime_dir.0.join(BRIDGE_FILE_NAME);
    let deadline = tokio::time::Instant::now() + BRIDGE_POLL_TIMEOUT;

    loop {
        if let Ok(contents) = tokio::fs::read(&bridge_file).await
            && let Ok(endpoint) = serde_json::from_slice::<BridgeEndpoint>(&contents)
        {
            return Ok(endpoint);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "sidecar bridge file did not appear at {} within {BRIDGE_POLL_TIMEOUT:?}",
                bridge_file.display()
            ));
        }
        tokio::time::sleep(BRIDGE_POLL_INTERVAL).await;
    }
}

/// The `RunEvent::Exit` handler described in the module doc: send the sidecar a real `SIGTERM` to
/// trigger its own graceful shutdown directly, wait up to `SHUTDOWN_GRACE_PERIOD` for it to exit,
/// then hard-kill only as a last resort.
pub async fn shutdown_gracefully<R: Runtime>(app_handle: &tauri::AppHandle<R>) {
    let Some(state) = app_handle.try_state::<SidecarState>() else {
        return;
    };

    let mut terminated_rx = state.terminated_rx.clone();
    if *terminated_rx.borrow() {
        return;
    }

    if let Some(pid) = state.child.lock().await.as_ref().map(CommandChild::pid) {
        send_sigterm(pid);
    }

    let waited_for_exit = tokio::time::timeout(SHUTDOWN_GRACE_PERIOD, async {
        loop {
            if *terminated_rx.borrow() {
                return;
            }
            if terminated_rx.changed().await.is_err() {
                return;
            }
        }
    })
    .await
    .is_ok();

    if waited_for_exit {
        eprintln!("[sidecar] exited gracefully before shutdown deadline");
        return;
    }

    let Some(child) = state.child.lock().await.take() else {
        return;
    };
    eprintln!("[sidecar] did not exit within {SHUTDOWN_GRACE_PERIOD:?}, killing");
    if let Err(e) = child.kill() {
        eprintln!("[sidecar] failed to kill on exit: {e}");
    }
}

/// Delivers a real `SIGTERM` to `pid`, since `CommandChild::kill()` only exposes `SIGKILL`. Shells
/// out to the system `kill` rather than adding a signal-handling crate for this one call.
#[cfg(unix)]
fn send_sigterm(pid: u32) {
    if let Err(e) = std::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
    {
        eprintln!("[sidecar] failed to send SIGTERM to pid {pid}: {e}");
    }
}

#[cfg(not(unix))]
fn send_sigterm(_pid: u32) {}
