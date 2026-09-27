#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct SidecarState(Mutex<Option<Child>>);

fn is_port_ready(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
}

fn resolve_data_dir(exe_dir: &PathBuf) -> PathBuf {
    let portable_data = exe_dir.join("data");
    if portable_data.exists() {
        return portable_data;
    }
    if std::fs::create_dir_all(&portable_data).is_ok() {
        return portable_data;
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let fallback = PathBuf::from(local_app_data).join("NovaLedger").join("data");
        let _ = std::fs::create_dir_all(&fallback);
        return fallback;
    }
    portable_data
}

fn find_sidecar_binary(exe_dir: &PathBuf) -> Option<PathBuf> {
    let candidates = [
        exe_dir.join("novaledger-engine.exe"),
        exe_dir.join("novaledger-engine-x86_64-pc-windows-gnu.exe"),
        exe_dir.join("novaledger-engine-x86_64-pc-windows-msvc.exe"),
        exe_dir.join("binaries").join("novaledger-engine.exe"),
        exe_dir.join("binaries").join("novaledger-engine-x86_64-pc-windows-gnu.exe"),
    ];
    for c in candidates {
        if c.exists() {
            return Some(c);
        }
    }
    None
}

fn spawn_sidecar() -> Option<Child> {
    if is_port_ready(8088) {
        return None;
    }

    let exe_path = std::env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?.to_path_buf();
    let sidecar_bin = find_sidecar_binary(&exe_dir)?;
    let data_dir = resolve_data_dir(&exe_dir);

    let mut cmd = Command::new(sidecar_bin);
    cmd.arg("--port")
        .arg("8088")
        .arg("--data-dir")
        .arg(data_dir.to_string_lossy().to_string());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().ok()?;

    // Wait up to 8 seconds for the local FastAPI Beancount engine to listen on 127.0.0.1:8088
    for _ in 0..80 {
        if is_port_ready(8088) {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    Some(child)
}

fn kill_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    let child = spawn_sidecar();

    let app = tauri::Builder::default()
        .manage(SidecarState(Mutex::new(child)))
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let state = window.state::<SidecarState>();
                kill_sidecar(&state);
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to build NovaLedger v2.0 Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<SidecarState>();
            kill_sidecar(&state);
        }
    });
}
