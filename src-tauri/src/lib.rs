mod loopback;

/// Free bytes available on the volume that holds `path`.
///
/// Rust has no portable API for this, so Windows gets GetDiskFreeSpaceExW and
/// every other platform simply reports "unknown" rather than blocking a
/// recording on a check we cannot make.
#[tauri::command]
fn free_space(path: String) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;

        unsafe extern "system" {
            fn GetDiskFreeSpaceExW(
                lpDirectoryName: *const u16,
                lpFreeBytesAvailableToCaller: *mut u64,
                lpTotalNumberOfBytes: *mut u64,
                lpTotalNumberOfFreeBytes: *mut u64,
            ) -> i32;
        }

        let wide: Vec<u16> = std::ffi::OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut available: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok != 0 {
            return Some(available);
        }
        None
    }

    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

/// One frame of the desktop region (physical pixels) as a PNG. GDI in process:
/// spawning ffmpeg for a single frame was most of the wait for the shot menu.
#[cfg(windows)]
#[tauri::command]
fn screenshot(x: i32, y: i32, w: i32, h: i32, path: String) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::*;

    let mut px = vec![0u8; (w * h * 4) as usize];
    unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp.into());
        // CAPTUREBLT: include layered (transparent) windows, as gdigrab did.
        let blit = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0));
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let rows = GetDIBits(mem, bmp, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        blit.map_err(|e| e.to_string())?;
        if rows != h {
            return Err("GetDIBits failed".into());
        }
    }
    // BGRx -> RGBA
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        p[3] = 255;
    }
    image::RgbaImage::from_raw(w as u32, h as u32, px)
        .ok_or("bad size")?
        .save(&path)
        .map_err(|e| e.to_string())
}

/// Makes a window a tool window. Chromium's occlusion tracking (browsers,
/// Electron apps) skips those; otherwise the full-desktop overlay counts as
/// covering every window behind it, and their videos stop painting.
#[cfg(windows)]
#[tauri::command]
fn tool_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;

    unsafe extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut std::ffi::c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut std::ffi::c_void, index: i32, value: isize) -> isize;
    }
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x80;

    let win = app.get_webview_window(&label).ok_or("no such window")?;
    let hwnd = win.hwnd().map_err(|e| e.to_string())?.0;
    unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, GetWindowLongPtrW(hwnd, GWL_EXSTYLE) | WS_EX_TOOLWINDOW) };
    Ok(())
}

/// The visible app windows as [x, y, w, h] in physical pixels, topmost first,
/// for the picker to snap to. DWM's frame bounds, not GetWindowRect: those
/// include the invisible resize borders. Skipped: rbox itself (the overlay
/// covers everything), minimized, cloaked (other virtual desktops, suspended
/// UWP), tool and untitled windows, and the desktop.
#[cfg(windows)]
#[tauri::command]
fn list_windows() -> Vec<[i32; 4]> {
    type Hwnd = *mut std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Bounds {
        l: i32,
        t: i32,
        r: i32,
        b: i32,
    }
    unsafe extern "system" {
        fn EnumWindows(cb: unsafe extern "system" fn(Hwnd, isize) -> i32, lp: isize) -> i32;
        fn IsWindowVisible(h: Hwnd) -> i32;
        fn IsIconic(h: Hwnd) -> i32;
        fn GetShellWindow() -> Hwnd;
        fn GetWindowThreadProcessId(h: Hwnd, pid: *mut u32) -> u32;
        fn GetWindowLongPtrW(h: Hwnd, index: i32) -> isize;
        fn GetWindowTextLengthW(h: Hwnd) -> i32;
    }
    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmGetWindowAttribute(h: Hwnd, attr: u32, out: *mut std::ffi::c_void, size: u32) -> i32;
    }
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x80;
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    const DWMWA_CLOAKED: u32 = 14;

    // EnumWindows walks the z-order from the top.
    unsafe extern "system" fn each(h: Hwnd, lp: isize) -> i32 {
        let out = unsafe { &mut *(lp as *mut Vec<[i32; 4]>) };
        let mut pid = 0u32;
        let mut cloaked = 0u32;
        let mut b = Bounds::default();
        let keep = unsafe {
            IsWindowVisible(h) != 0
                && IsIconic(h) == 0
                && h != GetShellWindow()
                && GetWindowThreadProcessId(h, &mut pid) != 0
                && pid != std::process::id()
                && GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW == 0
                && GetWindowTextLengthW(h) > 0
                && DwmGetWindowAttribute(h, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4) == 0
                && cloaked == 0
                && DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, (&mut b as *mut Bounds).cast(), 16) == 0
        };
        if keep && b.r > b.l && b.b > b.t {
            out.push([b.l, b.t, b.r - b.l, b.b - b.t]);
        }
        1
    }

    let mut out: Vec<[i32; 4]> = Vec::new();
    unsafe { EnumWindows(each, &mut out as *mut _ as isize) };
    out
}

/// Windows 11 hands Print Screen to the Snipping Tool before any app hotkey
/// sees it. This switches that Windows setting off, then tells the shell, as
/// the toggle in Settings does. Async: the broadcast may wait on slow windows.
#[cfg(windows)]
#[tauri::command]
async fn claim_print_screen() -> Result<(), String> {
    unsafe extern "system" {
        fn RegSetKeyValueW(key: isize, sub: *const u16, name: *const u16, ty: u32, data: *const u32, len: u32) -> i32;
        fn SendMessageTimeoutW(hwnd: isize, msg: u32, w: usize, l: *const u16, flags: u32, timeout: u32, result: *mut usize) -> isize;
    }
    const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
    const REG_DWORD: u32 = 4;
    const HWND_BROADCAST: isize = 0xffff;
    const WM_SETTINGCHANGE: u32 = 0x001A;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;

    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let key = wide(r"Control Panel\Keyboard");
    let name = wide("PrintScreenKeyForSnippingEnabled");
    let off = 0u32;
    let err = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_DWORD, &off, 4) };
    if err != 0 {
        return Err(format!("registry error {err}"));
    }
    unsafe {
        SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, key.as_ptr(), SMTO_ABORTIFHUNG, 1000, std::ptr::null_mut())
    };
    Ok(())
}

/// Puts a PNG on the clipboard. Done here, not through the fs plugin: the file
/// may sit in a folder the user picked, outside every fs scope.
#[tauri::command]
fn copy_image(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let image = tauri::image::Image::from_bytes(&bytes).map_err(|e| e.to_string())?;
    app.clipboard().write_image(&image).map_err(|e| e.to_string())
}

/// Moves a file. Rename alone fails across drives, and the temp folder is on C:
/// while the output folder may not be.
#[tauri::command]
fn move_file(from: String, to: String) -> Result<(), String> {
    if std::fs::rename(&from, &to).is_ok() {
        return Ok(());
    }
    std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&from);
    Ok(())
}

/// Windows' own "Open with" chooser for a file.
#[tauri::command]
fn open_with(path: String) -> Result<(), String> {
    std::process::Command::new("rundll32")
        .args(["shell32.dll,OpenAs_RunDLL", &path])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Ends the app. The tray's Quit finishes a running recording before it calls
/// this.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // A second launch would fight the first one over the output file and the
    // recording frame, so it hands focus to the window that is already up and
    // exits instead. Registered first, as the plugin requires.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }));
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
        // Launched from the Run key with --hidden: straight to the tray.
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ));
        builder = builder.setup(|app| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

            // The right-click menu is set from the main window (App.tsx), where
            // its entries can call straight into the app.
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().ok_or("no app icon")?)
                .tooltip("rbox")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = e
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // The window is created hidden (tauri.conf.json) so --hidden never flashes it.
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(app.handle());
            }
            Ok(())
        });
    }

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(loopback::Loopback::default());

    builder
        // X only hides the panel; it is destroyed when closed mid-recording.
        // Frame, overlay and tray would outlive it, so take them along.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            free_space,
            screenshot,
            tool_window,
            list_windows,
            claim_print_screen,
            copy_image,
            move_file,
            open_with,
            quit,
            loopback::system_audio_start,
            loopback::system_audio_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
