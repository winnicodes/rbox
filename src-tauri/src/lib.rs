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
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(loopback::Loopback::default());

    builder
        .invoke_handler(tauri::generate_handler![
            free_space,
            loopback::system_audio_start,
            loopback::system_audio_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
