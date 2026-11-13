# Changelog

## v0.3.0 — 2026-11-13

Pick windows with one click, record from a compact bar, and use rbox in your language.

- Click a highlighted window in the picker to capture its visible area.
- Switch to a compact, always-on-top bar with format, area and recording controls.
- Settings now separate shared recording options, Video, GIF, Screenshot, Audio, System and Language, with inline help.
- English and German are built in; add or override translations with JSON files in `%APPDATA%\rbox\lang`.
- Turn off **Close to tray** to make the X button quit rbox.
- Enable **Screenshots to clipboard** to copy screenshots directly without opening the menu or saving a file.
- Long paths scroll into view; compact-bar tooltips appear outside the window.
- Updated frontend and Rust dependencies.

## v0.2.2 — 2026-10-11

Print Screen reaches rbox instead of the Snipping Tool, the picker gets a compact toolbar, and browser videos keep playing behind it.

- Enabling Print Screen turns off Windows' own Snipping Tool binding for the key.
- Fixed rbox reporting Print Screen as "used by another app" after a quick on/off/on.
- Print and the tray's snip entries move the panel to the tray while framing.
- The overlay is a tool window, so browser videos no longer go black while picking.
- Compact toolbar: size presets and X/Y/W/H share one block, icon buttons, Redraw removed, new cancel button.
- Fixed the white ghost rectangle on a `--hidden` start; the panel re-centres at its real height.

## v0.2.1 — 2026-10-09

Autostart really stays in the tray, and the screenshot menu opens right away.

- Fixed a white, click-through rectangle left on the desktop after a `--hidden` start.
- Screenshots are captured in process with GDI instead of ffmpeg; the menu opens in ~0.3 s instead of 0.6–1 s.
- Screenshots keep the exact region size and no longer include the mouse cursor.

## v0.2.0 — 2026-10-07

rbox becomes a Snipping Tool replacement.

- Print Screen opens a quick picker for Screenshot / Video / GIF.
- Tray icon with Screenshot, Video, GIF, Open rbox and Quit rbox; X hides to the tray; Quit finishes a running recording first.
- "Start with Windows" (autostart launches hidden).
- After a screenshot, a menu at the pointer: Copy, Save, Save to…, Save and open with…, Close.
- The recording bar stays out of the video and is pinned to the frame.
- Capture delay (Off / 3 / 5 / 10 s) with a countdown.
- Startup shows only the logo until everything is loaded; toasts close on click.
- Tauri 2.12, React 19.3, Rust 1.99.

## v0.1.1 — 2026-10-06

Settings redesign, custom frame rates, a Print Screen hotkey and GIF scaling fixes.

- Two-column settings that save immediately (no Save button).
- Custom frame rate for video (1–120 fps) and GIF (1–50 fps).
- Opt-in Print Screen hotkey for the area picker.
- GIFs are only ever downscaled; new "Original" width option.

## v0.1.0 — 2026-08-25

First release: a minimal region screen recorder for Windows (mp4, GIF, PNG).

- MSI installer only (`rbox_<version>_x64.msi`), bundle identifier `com.rbox.desktop`.
- Overlay hints and "Full screen" use the monitor the pointer is on.
- The remembered area is restored at startup.
- Developer guide in `docs/dev.md`.
