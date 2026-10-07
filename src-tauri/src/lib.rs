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
        .invoke_handler(tauri::generate_handler![
            free_space,
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
