use std::{
    collections::HashMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Clone)]
struct ScreenCapture {
    png: Vec<u8>,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Default)]
struct HiddenWindows {
    widget: bool,
    panel: bool,
}

#[derive(Default)]
pub(crate) struct ScreenshotManager {
    capture: Mutex<Option<ScreenCapture>>,
    hidden_windows: Mutex<Option<HiddenWindows>>,
    active: AtomicBool,
    dialog_open: AtomicBool,
    session_id: AtomicU64,
    last_heartbeat_ms: AtomicU64,
    pins: Mutex<HashMap<String, ScreenCapture>>,
}

fn now_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapturePayload {
    data_url: String,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinishPayload {
    saved_path: String,
}

pub(crate) fn default_screenshot_folder() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("截图")
}

fn window_is_visible(window: &WebviewWindow) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, IsWindowVisible, GA_ROOT};
        return window.hwnd().ok().is_some_and(|handle| unsafe {
            let root = GetAncestor(handle, GA_ROOT);
            IsWindowVisible(if root.0.is_null() { handle } else { root }).as_bool()
        });
    }
    #[cfg(not(target_os = "windows"))]
    window.is_visible().unwrap_or(false)
}

fn warm_screenshot_window(window: &WebviewWindow, capture: &ScreenCapture) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindowLongPtrW, IsWindowVisible, SetWindowLongPtrW, SetWindowPos,
            GA_ROOT, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, WS_EX_NOACTIVATE,
            WS_EX_TRANSPARENT,
        };
        let child = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let root = GetAncestor(child, GA_ROOT);
            let handle = if root.0.is_null() { child } else { root };
            let style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
            SetWindowLongPtrW(
                handle,
                GWL_EXSTYLE,
                style | WS_EX_TRANSPARENT.0 as isize | WS_EX_NOACTIVATE.0 as isize,
            );
            SetWindowPos(
                handle,
                Some(HWND_TOPMOST),
                capture.x + capture.width as i32 - 16,
                capture.y + capture.height as i32 - 16,
                160,
                80,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
            .map_err(|error| error.to_string())?;
            if !IsWindowVisible(handle).as_bool() {
                return Err("截图窗口未能显示".to_string());
            }
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    window
        .set_position(tauri::PhysicalPosition::new(capture.x - 10_000, capture.y))
        .and_then(|_| window.set_size(tauri::PhysicalSize::new(160, 80)))
        .and_then(|_| window.show())
        .map_err(|error| error.to_string())
}

fn show_screenshot_window(window: &WebviewWindow, capture: &ScreenCapture) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindowLongPtrW, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos,
            GA_ROOT, GWL_EXSTYLE, HWND_TOPMOST, SWP_SHOWWINDOW, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
        };
        let child = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let root = GetAncestor(child, GA_ROOT);
            let handle = if root.0.is_null() { child } else { root };
            let style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
            SetWindowLongPtrW(
                handle,
                GWL_EXSTYLE,
                style & !(WS_EX_TRANSPARENT.0 as isize | WS_EX_NOACTIVATE.0 as isize),
            );
            SetWindowPos(
                handle,
                Some(HWND_TOPMOST),
                capture.x,
                capture.y,
                capture.width as i32,
                capture.height as i32,
                SWP_SHOWWINDOW,
            )
            .map_err(|error| error.to_string())?;
            let _ = SetForegroundWindow(handle);
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    window
        .set_position(tauri::PhysicalPosition::new(capture.x, capture.y))
        .and_then(|_| {
            window.set_size(tauri::PhysicalSize::new(capture.width, capture.height))
        })
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
        .map_err(|error| error.to_string())
}

fn repair_screenshot_interactivity(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GA_ROOT, GWL_EXSTYLE,
            SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_NOACTIVATE,
            WS_EX_TRANSPARENT,
        };
        let child = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let root = GetAncestor(child, GA_ROOT);
            let handle = if root.0.is_null() { child } else { root };
            let style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
            let interactive = style & !(WS_EX_TRANSPARENT.0 as isize | WS_EX_NOACTIVATE.0 as isize);
            if interactive != style {
                SetWindowLongPtrW(handle, GWL_EXSTYLE, interactive);
                SetWindowPos(
                    handle,
                    None,
                    0,
                    0,
                    0,
                    0,
                    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
                )
                .map_err(|error| error.to_string())?;
            }
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

fn set_screenshot_topmost(window: &WebviewWindow, topmost: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, SetForegroundWindow, SetWindowPos, GA_ROOT, HWND_NOTOPMOST, HWND_TOPMOST,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        let child = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let root = GetAncestor(child, GA_ROOT);
            let handle = if root.0.is_null() { child } else { root };
            SetWindowPos(
                handle,
                Some(if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST }),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            )
            .map_err(|error| error.to_string())?;
            if topmost {
                let _ = SetForegroundWindow(handle);
            }
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    window.set_always_on_top(topmost).map_err(|error| error.to_string())
}

fn set_native_visibility(window: &WebviewWindow, visible: bool) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetAncestor, ShowWindow, GA_ROOT, SW_HIDE, SW_SHOWNOACTIVATE,
        };
        if let Ok(child) = window.hwnd() {
            unsafe {
                let root = GetAncestor(child, GA_ROOT);
                let handle = if root.0.is_null() { child } else { root };
                let _ = ShowWindow(handle, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    if visible {
        let _ = window.show();
    } else {
        let _ = window.hide();
    }
}

fn emergency_cancel_screenshot(app: &AppHandle, manager: &ScreenshotManager) {
    manager.session_id.fetch_add(1, Ordering::AcqRel);
    manager.active.store(false, Ordering::Release);
    manager.dialog_open.store(false, Ordering::Release);
    manager.last_heartbeat_ms.store(0, Ordering::Release);
    discard_capture(manager);
    if let Some(window) = app.get_webview_window("screenshot") {
        set_native_visibility(&window, false);
    }
    let visibility = manager
        .hidden_windows
        .lock()
        .ok()
        .and_then(|mut value| value.take())
        .unwrap_or(HiddenWindows { widget: true, panel: false });
    if visibility.widget {
        if let Some(window) = app.get_webview_window("widget") {
            set_native_visibility(&window, true);
        }
    }
    if visibility.panel {
        if let Some(window) = app.get_webview_window("tray-panel") {
            set_native_visibility(&window, true);
        }
    }
}

fn start_screenshot_watchdog(app: AppHandle, session_id: u64) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let manager = app.state::<ScreenshotManager>();
        if manager.session_id.load(Ordering::Acquire) != session_id {
            return;
        }
        let active = manager.active.load(Ordering::Acquire);
        let pending = manager.capture.lock().ok().is_some_and(|value| value.is_some());
        if !active && !pending {
            return;
        }
        if active {
            if let Some(window) = app.get_webview_window("screenshot") {
                let _ = repair_screenshot_interactivity(&window);
            }
        }
        if manager.dialog_open.load(Ordering::Acquire) {
            continue;
        }
        let last = manager.last_heartbeat_ms.load(Ordering::Acquire);
        let timeout = if active { 4_500 } else { 8_000 };
        if last == 0 || now_millis().saturating_sub(last) > timeout {
            emergency_cancel_screenshot(&app, &manager);
            return;
        }
    });
}

pub(crate) fn restore_windows(app: &AppHandle, manager: &ScreenshotManager) {
    manager.active.store(false, Ordering::Release);
    let visibility = manager
        .hidden_windows
        .lock()
        .ok()
        .and_then(|mut value| value.take());
    let Some(visibility) = visibility else { return };
    if visibility.widget {
        if let Some(window) = app.get_webview_window("widget") {
            let _ = window.show();
        }
    }
    if visibility.panel {
        if let Some(window) = app.get_webview_window("tray-panel") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn hide_preserved_windows(app: &AppHandle, manager: &ScreenshotManager) {
    let visibility = manager.hidden_windows.lock().ok().and_then(|value| *value);
    let Some(visibility) = visibility else { return };
    if visibility.widget {
        if let Some(window) = app.get_webview_window("widget") { let _ = window.hide(); }
    }
    if visibility.panel {
        if let Some(window) = app.get_webview_window("tray-panel") { let _ = window.hide(); }
    }
}

pub(crate) fn remove_pin(manager: &ScreenshotManager, label: &str) {
    if let Ok(mut pins) = manager.pins.lock() {
        pins.remove(label);
    }
}

pub(crate) fn discard_capture(manager: &ScreenshotManager) {
    if let Ok(mut capture) = manager.capture.lock() {
        *capture = None;
    }
}

#[tauri::command]
pub(crate) fn begin_screenshot(app: AppHandle, manager: State<'_, ScreenshotManager>) -> Result<(), String> {
    let pending = manager.capture.lock().ok().is_some_and(|capture| capture.is_some());
    if manager.active.load(Ordering::Acquire) || pending {
        cancel_screenshot(app, manager);
        return Ok(());
    }

    let visibility = HiddenWindows {
        widget: app.get_webview_window("widget").as_ref().is_some_and(window_is_visible),
        panel: app.get_webview_window("tray-panel").as_ref().is_some_and(window_is_visible),
    };
    if let Ok(mut hidden) = manager.hidden_windows.lock() {
        *hidden = Some(visibility);
    }
    // Keep the widget visible during capture so its pixels remain in the screenshot. The live
    // window is hidden only after the full-screen overlay replaces it with those same pixels.
    if let Some(window) = app.get_webview_window("tray-panel") { let _ = window.hide(); }
    std::thread::sleep(Duration::from_millis(120));

    let capture = match capture_current_monitor() {
        Ok(value) => value,
        Err(error) => {
            restore_windows(&app, &manager);
            return Err(error);
        }
    };
    if let Ok(mut slot) = manager.capture.lock() {
        *slot = Some(capture.clone());
    }
    let session_id = manager.session_id.fetch_add(1, Ordering::AcqRel) + 1;
    manager.dialog_open.store(false, Ordering::Release);
    manager.last_heartbeat_ms.store(now_millis(), Ordering::Release);
    start_screenshot_watchdog(app.clone(), session_id);
    let window = app
        .get_webview_window("screenshot")
        .ok_or_else(|| "截图窗口不存在".to_string())?;
    if let Err(error) = warm_screenshot_window(&window, &capture) {
        discard_capture(&manager);
        restore_windows(&app, &manager);
        return Err(error);
    }
    let emitter = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(160));
        let _ = emitter.emit_to("screenshot", "screenshot-capture-ready", ());
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn activate_screenshot(app: AppHandle, manager: State<'_, ScreenshotManager>) -> Result<(), String> {
    if manager.active.load(Ordering::Acquire) {
        if let Some(window) = app.get_webview_window("screenshot") { let _ = window.set_focus(); }
        return Ok(());
    }
    let capture = manager
        .capture
        .lock()
        .map_err(|_| "截图数据不可用".to_string())?
        .clone()
        .ok_or_else(|| "没有待处理的截图".to_string())?;
    let window = app
        .get_webview_window("screenshot")
        .ok_or_else(|| "截图窗口不存在".to_string())?;
    if let Err(error) = show_screenshot_window(&window, &capture) {
        let _ = window.hide();
        discard_capture(&manager);
        restore_windows(&app, &manager);
        return Err(error);
    }
    hide_preserved_windows(&app, &manager);
    manager.last_heartbeat_ms.store(now_millis(), Ordering::Release);
    manager.active.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_screenshot_capture(manager: State<'_, ScreenshotManager>) -> Result<CapturePayload, String> {
    let capture = manager
        .capture
        .lock()
        .map_err(|_| "截图数据不可用".to_string())?
        .clone()
        .ok_or_else(|| "没有待处理的截图".to_string())?;
    Ok(payload(&capture))
}

#[tauri::command]
pub(crate) fn screenshot_heartbeat(manager: State<'_, ScreenshotManager>) -> bool {
    let active = manager.active.load(Ordering::Acquire);
    let pending = manager.capture.lock().ok().is_some_and(|value| value.is_some());
    if active || pending {
        manager.last_heartbeat_ms.store(now_millis(), Ordering::Release);
        true
    } else {
        false
    }
}

#[tauri::command]
pub(crate) fn set_screenshot_dialog_mode(
    app: AppHandle,
    manager: State<'_, ScreenshotManager>,
    open: bool,
) -> Result<(), String> {
    if !manager.active.load(Ordering::Acquire) {
        return Ok(());
    }
    let window = app
        .get_webview_window("screenshot")
        .ok_or_else(|| "截图窗口不存在".to_string())?;
    manager.dialog_open.store(open, Ordering::Release);
    manager.last_heartbeat_ms.store(now_millis(), Ordering::Release);
    set_screenshot_topmost(&window, !open)
}

#[tauri::command]
pub(crate) fn cancel_screenshot(app: AppHandle, manager: State<'_, ScreenshotManager>) {
    manager.session_id.fetch_add(1, Ordering::AcqRel);
    manager.active.store(false, Ordering::Release);
    manager.dialog_open.store(false, Ordering::Release);
    manager.last_heartbeat_ms.store(0, Ordering::Release);
    if let Ok(mut capture) = manager.capture.lock() { *capture = None; }
    if let Some(window) = app.get_webview_window("screenshot") { set_native_visibility(&window, false); }
    restore_windows(&app, &manager);
}

#[tauri::command]
pub(crate) fn get_default_screenshot_folder() -> String {
    default_screenshot_folder().to_string_lossy().into_owned()
}

#[tauri::command]
pub(crate) fn open_screenshot_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    fs::create_dir_all(&path).map_err(|error| format!("无法创建截图文件夹：{error}"))?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法打开截图文件夹：{error}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("当前只支持在 Windows 打开截图文件夹".into())
    }
}

#[tauri::command]
pub(crate) fn finish_screenshot(
    app: AppHandle,
    manager: State<'_, ScreenshotManager>,
    state: State<'_, crate::AppState>,
    data_url: String,
    target_path: Option<String>,
    pin: bool,
) -> Result<FinishPayload, String> {
    let png = decode_png_data_url(&data_url)?;
    let image = image::load_from_memory_with_format(&png, ImageFormat::Png)
        .map_err(|_| "截图图片无效".to_string())?;
    let folder = state
        .preferences
        .lock()
        .map_err(|_| "截图设置不可用".to_string())?
        .screenshot_folder
        .clone();
    let target = match target_path {
        Some(value) if !value.trim().is_empty() => ensure_png_extension(PathBuf::from(value)),
        _ => {
            let folder = if folder.trim().is_empty() { default_screenshot_folder() } else { PathBuf::from(folder) };
            folder.join(format!("Token-Bubble_{}.png", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")))
        }
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建保存文件夹：{error}"))?;
    }
    fs::write(&target, &png).map_err(|error| format!("无法保存截图：{error}"))?;
    copy_image_to_clipboard(&image)?;

    if pin {
        create_pin_window(&app, &manager, ScreenCapture {
            png: png.clone(),
            width: image.width(),
            height: image.height(),
            x: 0,
            y: 0,
        })?;
    }
    if let Ok(mut capture) = manager.capture.lock() { *capture = None; }
    manager.session_id.fetch_add(1, Ordering::AcqRel);
    manager.active.store(false, Ordering::Release);
    manager.dialog_open.store(false, Ordering::Release);
    manager.last_heartbeat_ms.store(0, Ordering::Release);
    if let Some(window) = app.get_webview_window("screenshot") { set_native_visibility(&window, false); }
    restore_windows(&app, &manager);
    Ok(FinishPayload { saved_path: target.to_string_lossy().into_owned() })
}

#[tauri::command]
pub(crate) fn get_pinned_screenshot(id: String, manager: State<'_, ScreenshotManager>) -> Result<CapturePayload, String> {
    let capture = manager
        .pins
        .lock()
        .map_err(|_| "贴图数据不可用".to_string())?
        .get(&id)
        .cloned()
        .ok_or_else(|| "贴图已经关闭".to_string())?;
    Ok(payload(&capture))
}

#[tauri::command]
pub(crate) fn close_pinned_screenshot(
    id: String,
    app: AppHandle,
    manager: State<'_, ScreenshotManager>,
) -> Result<(), String> {
    if id != "pin" && !id.starts_with("pin-") {
        return Err("贴图标识无效".to_string());
    }
    let window = app
        .get_webview_window(&id)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    remove_pin(&manager, &id);
    let _ = window.emit("pinned-screenshot-cleared", ());
    if id == "pin" {
        window.hide().map_err(|error| format!("无法关闭贴图：{error}"))
    } else {
        window.close().map_err(|error| format!("无法关闭贴图：{error}"))
    }
}

fn payload(capture: &ScreenCapture) -> CapturePayload {
    CapturePayload {
        data_url: format!("data:image/png;base64,{}", BASE64.encode(&capture.png)),
        width: capture.width,
        height: capture.height,
    }
}

fn decode_png_data_url(value: &str) -> Result<Vec<u8>, String> {
    let encoded = value
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "截图数据格式不正确".to_string())?;
    BASE64.decode(encoded).map_err(|_| "截图数据无法解码".to_string())
}

fn ensure_png_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().and_then(|value| value.to_str()).is_none_or(|value| !value.eq_ignore_ascii_case("png")) {
        path.set_extension("png");
    }
    path
}

fn create_pin_window(app: &AppHandle, manager: &ScreenshotManager, capture: ScreenCapture) -> Result<(), String> {
    let id = "pin";
    if let Ok(mut pins) = manager.pins.lock() { pins.insert(id.to_string(), capture.clone()); }
    let scale = (720.0 / capture.width as f64).min(520.0 / capture.height as f64).min(1.0);
    let width = (capture.width as f64 * scale).max(120.0);
    let height = (capture.height as f64 * scale).max(80.0);
    let window = app.get_webview_window(id).ok_or_else(|| "贴图窗口不存在".to_string())?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .and_then(|_| window.center())
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
        .map_err(|error| format!("无法显示贴图：{error}"))?;
    let _ = app.emit_to(id, "pinned-screenshot-updated", ());
    Ok(())
}

#[cfg(target_os = "windows")]
fn capture_current_monitor() -> Result<ScreenCapture, String> {
    use std::{ffi::c_void, mem::size_of};
    use windows::Win32::{
        Foundation::POINT,
        Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
            GetDIBits, GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, MONITORINFO,
            MONITOR_DEFAULTTONEAREST, ROP_CODE, SRCCOPY,
        },
        UI::WindowsAndMessaging::GetCursorPos,
    };

    unsafe {
        let mut cursor = POINT::default();
        GetCursorPos(&mut cursor).map_err(|error| error.to_string())?;
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() { return Err("无法读取显示器信息".into()); }
        let width = info.rcMonitor.right - info.rcMonitor.left;
        let height = info.rcMonitor.bottom - info.rcMonitor.top;
        if width <= 0 || height <= 0 { return Err("显示器尺寸无效".into()); }

        let screen_dc = GetDC(None);
        if screen_dc.0.is_null() { return Err("无法访问屏幕画面".into()); }
        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if memory_dc.0.is_null() || bitmap.0.is_null() {
            if !memory_dc.0.is_null() { let _ = DeleteDC(memory_dc); }
            let _ = ReleaseDC(None, screen_dc);
            return Err("无法创建截图缓冲区".into());
        }
        let old = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        let result = (|| -> Result<Vec<u8>, String> {
            BitBlt(
                memory_dc,
                0,
                0,
                width,
                height,
                Some(screen_dc),
                info.rcMonitor.left,
                info.rcMonitor.top,
                ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0),
            )
            .map_err(|error| error.to_string())?;
            let mut pixels = vec![0_u8; width as usize * height as usize * 4];
            let mut bitmap_info = BITMAPINFO::default();
            bitmap_info.bmiHeader = BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: pixels.len() as u32,
                ..Default::default()
            };
            let rows = GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr().cast::<c_void>()),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            );
            if rows != height { return Err("无法读取屏幕像素".into()); }
            for pixel in pixels.chunks_exact_mut(4) { pixel.swap(0, 2); }
            Ok(pixels)
        })();
        let _ = SelectObject(memory_dc, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);
        let pixels = result?;
        let image = RgbaImage::from_raw(width as u32, height as u32, pixels)
            .ok_or_else(|| "截图像素尺寸不匹配".to_string())?;
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut output, ImageFormat::Png)
            .map_err(|error| format!("截图编码失败：{error}"))?;
        Ok(ScreenCapture {
            png: output.into_inner(),
            width: width as u32,
            height: height as u32,
            x: info.rcMonitor.left,
            y: info.rcMonitor.top,
        })
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_current_monitor() -> Result<ScreenCapture, String> {
    Err("截图功能当前只支持 Windows".into())
}

#[cfg(target_os = "windows")]
fn copy_image_to_clipboard(image: &DynamicImage) -> Result<(), String> {
    use std::{mem::size_of, ptr::copy_nonoverlapping};
    use windows::Win32::{
        Foundation::{GlobalFree, HANDLE},
        Graphics::Gdi::{BITMAPINFOHEADER, BI_RGB},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
    };

    let rgba = image.to_rgba8();
    let width = rgba.width();
    let height = rgba.height();
    let header = BITMAPINFOHEADER {
        biSize: size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width as i32,
        biHeight: height as i32,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        biSizeImage: width * height * 4,
        ..Default::default()
    };
    let mut dib = vec![0_u8; size_of::<BITMAPINFOHEADER>() + (width * height * 4) as usize];
    unsafe {
        copy_nonoverlapping(
            (&header as *const BITMAPINFOHEADER).cast::<u8>(),
            dib.as_mut_ptr(),
            size_of::<BITMAPINFOHEADER>(),
        );
    }
    let header_size = size_of::<BITMAPINFOHEADER>();
    for y in 0..height {
        let source_y = height - 1 - y;
        for x in 0..width {
            let source = rgba.get_pixel(x, source_y).0;
            let target = header_size + ((y * width + x) * 4) as usize;
            dib[target..target + 4].copy_from_slice(&[source[2], source[1], source[0], source[3]]);
        }
    }

    unsafe {
        OpenClipboard(None).map_err(|error| format!("无法打开剪贴板：{error}"))?;
        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|error| error.to_string())?;
            let memory = GlobalAlloc(GMEM_MOVEABLE, dib.len()).map_err(|error| error.to_string())?;
            let target = GlobalLock(memory);
            if target.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err("无法分配剪贴板内存".into());
            }
            copy_nonoverlapping(dib.as_ptr(), target.cast::<u8>(), dib.len());
            let _ = GlobalUnlock(memory);
            if let Err(error) = SetClipboardData(8, Some(HANDLE(memory.0))) {
                let _ = GlobalFree(Some(memory));
                return Err(error.to_string());
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result.map_err(|error| format!("复制截图失败：{error}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn copy_image_to_clipboard(_image: &DynamicImage) -> Result<(), String> {
    Err("复制图片当前只支持 Windows".into())
}

#[cfg(test)]
mod tests {
    use super::ensure_png_extension;
    use std::path::PathBuf;

    #[test]
    fn save_targets_are_png_files() {
        assert_eq!(ensure_png_extension(PathBuf::from("capture")), PathBuf::from("capture.png"));
        assert_eq!(ensure_png_extension(PathBuf::from("capture.PNG")), PathBuf::from("capture.PNG"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "captures the active Windows monitor"]
    fn captures_current_monitor_as_png() {
        let capture = super::capture_current_monitor().unwrap();
        assert!(capture.width > 0);
        assert!(capture.height > 0);
        let decoded = image::load_from_memory_with_format(&capture.png, image::ImageFormat::Png).unwrap();
        assert_eq!(decoded.width(), capture.width);
        assert_eq!(decoded.height(), capture.height);
    }
}
