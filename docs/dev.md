# rbox - Developer Guide

Technical notes for people who want to build, change or debug rbox. If you only
want to record your screen, the [README](../README.md) is enough.

- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Windows and processes](#windows-and-processes)
- [Print Screen, tray and screenshots](#print-screen-tray-and-screenshots)
- [The coordinate rule](#the-coordinate-rule)
- [Recording pipeline](#recording-pipeline)
- [System audio](#system-audio)
- [Rust commands](#rust-commands)
- [Settings and presets](#settings-and-presets)
- [Translations](#translations)
- [Window auto-sizing](#window-auto-sizing)
- [Permissions](#permissions)
- [Building installers](#building-installers)
- [Tests](#tests)
- [Promo images](#promo-images)
- [Things that will bite you](#things-that-will-bite-you)
- [Licensing](#licensing)

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri v2 (Rust) |
| UI | React 19 + TypeScript, Vite 7 |
| Styling | Tailwind v4 + shadcn/ui (Base UI), lucide icons |
| Capture / encoding | ffmpeg, shipped as a Tauri sidecar |
| System audio | cpal (WASAPI loopback) in Rust |
| Settings | `localStorage` |
| Tray, menus | Tauri tray + native menus, built from JS |

There is no state library, no settings backend and no custom encoder. Those are
deliberate omissions, not gaps waiting to be filled.

## Repository layout

```
src/
  App.tsx               main window: all UI state, recording control flow
  overlay.tsx           entry point of the region overlay window
  components/
    Overlay.tsx         region selection: drag, resize, nudge, size presets
    PresetTray.tsx      named presets (create, rename, delete, pick)
    DeviceSelect.tsx    microphone multi-select
    NumberField.tsx     numeric input used on the selection edges
    Segmented.tsx       small segmented control
    Tip.tsx             hover labels, with a separate window for the compact bar
    Marquee.tsx         scrolling text when a single-line label overflows
    Flag.tsx            country flag for the language picker
    ui/                 shadcn components
  lib/
    geometry.ts         rectangle math, the coordinate rule
    ffmpeg.ts           every ffmpeg call the app makes
    settings.ts         settings + preset shape, load/save, preset syncing
    paths.ts            output folder and timestamped file names
    monitors.ts         monitor list from Tauri, in physical pixels
    overlayWindow.ts    creates the full-desktop selection window
    frameWindow.ts      creates the red ring and the screenshot menu window
    shotMenu.ts         native menu after a screenshot, menu icon helper
    appKeys.ts          blocks browser shortcuts inside the webview
    version.ts          version compare for the update hint
    events.ts           event names shared between windows
    i18n.ts             t(), language files
    tipWindow.ts        click-through tooltip window for the compact bar
lang/                   bundled language files (template for translators)
src-tauri/
  src/lib.rs            Tauri setup, plugins, tray icon, small commands
  src/loopback.rs       WASAPI loopback capture -> TCP -> ffmpeg
  capabilities/         Tauri permission set
  binaries/             ffmpeg sidecar (downloaded, git-ignored)
scripts/
  fetch-ffmpeg.mjs      downloads the sidecar
  rename-installers.mjs post-build installer cleanup
  promo/                renders the README images from the real UI
index.html              main window
overlay.html            selection overlay
frame.html              ring, delay countdown, screenshot menu host
```

Vite builds three HTML entry points (`main`, `overlay`, `frame`), configured in
[`vite.config.ts`](../vite.config.ts).

## Getting started

Requirements:

- Windows 10 or 11
- Node 20 or newer
- Rust stable, MSVC toolchain
- The usual Tauri v2 prerequisites (WebView2, Visual Studio Build Tools)

```bash
npm install        # postinstall downloads ffmpeg into src-tauri/binaries/
npm run tauri dev
```

`npm install` runs [`scripts/fetch-ffmpeg.mjs`](../scripts/fetch-ffmpeg.mjs). It
pulls a static GPL build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) and saves it as
`src-tauri/binaries/ffmpeg-<rust-target-triple>.exe`.

**The triple suffix is required.** Tauri resolves sidecars by that exact name,
and without it you get "program not found" at runtime. The script reads the
triple from `rustc -vV`, so Rust must be installed before `npm install`. To
fetch it again (for example after a toolchain change), delete the file and run:

```bash
npm run fetch-ffmpeg
```

The script skips the download if the file already exists, and skips everything
on non-Windows platforms.

## Windows and processes

rbox uses five webview windows, a tray icon and one child process.

| Window | File | Purpose |
| --- | --- | --- |
| `main` | `index.html` | The control panel. Owns all state. |
| `overlay` | `overlay.html` | Transparent, spans the whole virtual desktop. Used to pick a region. |
| `frame` | `frame.html` | Click-through red ring around the region while recording, or the delay countdown. |
| `shotbar` | `frame.html?pick` | Invisible 1 px window at the pointer that opens the screenshot menu. |
| `tip` | `frame.html?tip` | Click-through tooltip window, created when a label does not fit in the compact bar. |

Everything but `main` is created on demand from
[`overlayWindow.ts`](../src/lib/overlayWindow.ts) and
[`frameWindow.ts`](../src/lib/frameWindow.ts), and closed when it is done.
They talk back to `main` with these events, defined in
[`events.ts`](../src/lib/events.ts):

- `rbox:region-picked` - payload is a `Rect`
- `rbox:region-cancelled`
- `rbox:quick-capture` - `{ rect, format }` from the quick overlay
- `rbox:shot-action` - the screenshot menu pick: `copy`, `save`, `saveas`,
  `open` or `close`

**`main` starts hidden** (`visible: false` in `tauri.conf.json`). Rust shows it
in `setup` unless the process was started with `--hidden`, which is what
autostart passes, so a boot never flashes the window. Until monitors, settings
and devices are loaded, `main` shows only the logo (`ready` in `App.tsx`).

A hidden window that gets resized before it was ever shown leaves a white,
click-through ghost of itself on the desktop (WebView2 + DWM). On a `--hidden`
start `fit()` does exactly that, so after its first resize and `center()` it
runs one `show()`/`hide()` round trip while the window is still invisible. Doing
it earlier, in Rust `setup`, is too soon - the resize comes later.

**X hides `main` to the tray**, it does not quit. Quitting is the tray's "Quit
rbox", which finishes a running recording and then calls the `quit` command.
Closing while recording (Alt+F4) still finishes the file first and destroys the
window.

The ring window is **larger than the recorded region** by the border width on
every side, so the red line lives outside the captured rectangle and never shows
up in the recording. The border is sized in CSS pixels but the window in
physical ones, so `showFrame()` takes the monitor scale factor to keep the ring
out of the region on scaled displays.

Only one instance can run: `tauri-plugin-single-instance` focuses the existing
window instead of starting a second recorder that would fight over the same
output file.

## Print Screen, tray and screenshots

**Quick overlay.** Print Screen (a global shortcut, opt-in) and the tray entries
open the overlay as `overlay.html?quick=<format>`. Quick mode starts blank
instead of loading the saved region, and its toolbar carries Screenshot / Video
/ GIF plus a Capture/Record button. Confirming **hides the overlay first, then
emits** `rbox:quick-capture` - otherwise the dimmer ends up in the screenshot.
`main` stores area and format and calls `start({ rect, format })`. The override
argument exists because `update()` has not reached `localStorage` yet when
`start()` reads it.

Quick mode hides `main` before opening the overlay: a snip is about the screen,
not the panel. A recording brings it back as the bar.

The overlay is made a tool window (`tool_window`) **after** `show()`. Chromium's
occlusion tracking skips tool windows; otherwise every browser behind the
full-desktop overlay thinks it is covered and stops painting video.

**Print Screen key.** Windows 11 gives Print to the Snipping Tool before any
`RegisterHotKey` sees it ("Use the Print screen key to open screen capture", on
by default). Switching rbox's setting on calls `claim_print_screen`, which sets
`HKCU\Control Panel\Keyboard\PrintScreenKeyForSnippingEnabled` to 0 and
broadcasts `WM_SETTINGCHANGE`, as the toggle in Settings does. The hint under
the switch links to that page in case Windows does not pick it up.

Register and unregister run one after another on a promise chain (`keyChain`).
Overlapping - a quick on-off-on, or StrictMode's double effect in dev - rbox
registers twice and finds the key taken by itself.

If registering Print Screen fails (another app holds it), the setting is turned
back off, so the switch never claims a key rbox does not have.

**Tray.** Rust creates the icon (`TrayIconBuilder::with_id("main")`) and handles
the left click. The right-click menu is set from `App.tsx` with
`TrayIcon.getById("main").setMenu(...)`, so its entries call straight into the
app and share its icons and, later, its translations.

**Screenshot flow.**

With `screenshotToClipboard` enabled, `start()` copies the temp PNG through
`copy_image`, deletes it even if copying fails, and skips `showShotMenu()`.
The setting is app-wide and off by default, so panel, Print Screen and tray
captures all keep the menu unless the user opts in.

1. The `screenshot` command grabs the region with GDI into a temp file
   (`tempShotPath()`). Not ffmpeg: starting a process for one frame made the
   menu wait. Unlike gdigrab it leaves the cursor out.
2. `showShotMenu()` opens the 1 px `shotbar` window at the pointer. A native
   context menu needs a foreground window to belong to, and `main` may be in the
   tray.
3. [`shotMenu.ts`](../src/lib/shotMenu.ts) pops a Tauri `Menu` there. Its icons
   are lucide icons rendered to PNG at runtime (`menuIcon()`).
4. The pick goes to `main` as `rbox:shot-action`. Copy runs `copy_image` and
   deletes the temp file; Save / Save to / Save and open use `move_file` (and
   `open_with`); Close deletes it. Copy and Save shrink the 1 px window into a
   short confirmation pill before it closes.

Tauri reports no "menu closed without a pick". A dismissed menu leaves the 1 px
window and the temp file behind until the next screenshot replaces both.

**Delay.** With a delay set, the ring opens as `frame.html?count=<s>` and counts
down inside the region. That number sits *in* the captured area, so the ring is
closed before ffmpeg starts.

## The coordinate rule

This is the single most important invariant in the codebase.

> **Every `Rect` is in physical desktop pixels.** That is the coordinate space
> `gdigrab` expects. CSS pixels exist only inside the overlay webview.

The overlay converts pointer positions on the way in and the selection on the
way out, using `physicalToCss()` in
[`geometry.ts`](../src/lib/geometry.ts). Nothing else in the app converts
anything.

Mixed DPI setups work because the overlay covers the **entire** virtual desktop.
Windows then renders that one window at a single DPI, so the overlay's
`devicePixelRatio` is the only scale factor the math needs - no per-monitor
scale juggling.

Other useful pieces in the same file:

- `virtualBounds()` - union of all monitors, origin can be negative
- `clampRect()` - keep a rect on screen, shrink it if needed
- `evenRect()` - round to even width/height, because libx264 with `yuv420p`
  rejects odd dimensions
- `monitorOfRect()` - the monitor holding the biggest share of a rect
- `fitRectToMonitors()` - repair a remembered rect after the display layout
  changed. It returns `null` when the rect is fully off screen, so the caller
  can keep the current area instead of silently recording the wrong place.

## Recording pipeline

All ffmpeg calls live in [`ffmpeg.ts`](../src/lib/ffmpeg.ts) and run through
`tauri-plugin-shell` from TypeScript. There is no Rust recording state.

**Video input** is always `gdigrab`, always input 0:

```
-f gdigrab -framerate <fps> -offset_x <x> -offset_y <y> -video_size <w>x<h> -i desktop
```

**Audio inputs** come after it. System audio, when enabled, is input 1, then the
selected microphones follow. Keeping that order fixed makes the `-map` indices
predictable no matter how many devices are on. One source is mapped directly;
two or more are merged with `amix`. See `audioArgs()`, which is unit tested.

**Encoding** is `libx264 -preset veryfast`, CRF 28/23/18 for low/medium/high,
`yuv420p`, `-movflags +faststart`. `gdigrab` timestamps drift, so the output is
forced to constant frame rate (`-fps_mode cfr -r <fps>`). Without it, long
recordings slowly lose sync.

**Stopping writes `q` to ffmpeg's stdin.** It does not kill the process. A
killed ffmpeg leaves an mp4 without its `moov` atom, which no player will open.
`stopFfmpeg()` waits up to 3 seconds for a clean exit and only then kills. The
last 400 stderr lines are kept in a ring buffer, so a non-zero exit can quote
the actual reason.

Shutdown order matters: ffmpeg is stopped first, because it must stop reading
the audio socket before the capture thread goes away.

**Formats**

- **MP4** - recorded directly to the output path.
- **GIF** - recorded to a scratch mp4 in the temp folder, then converted in two
  passes (`palettegen=stats_mode=diff`, then `paletteuse=dither=bayer`). One
  pass gives visibly worse output at the same file size. The scratch file is
  deleted afterwards.
- **PNG** - the same capture arguments with `-frames:v 1 -update 1`. `image2`
  needs `-update` for a single non-sequence filename. Written to temp first;
  see [the screenshot flow](#print-screen-tray-and-screenshots).

The window refuses to close while a recording runs (`onCloseRequested` in
`App.tsx`). It stops the recorder first, so no half-written file survives.

**The recording bar stays out of the video.** `setContentProtected(true)`
(`WDA_EXCLUDEFROMCAPTURE`) is set on `main` *before* ffmpeg spawns, so the first
frame is already clean, and cleared when the status leaves `recording` or the
start fails. While recording the bar is always on top and is moved under the
frame by `barPosition()` - above it at the screen edge, inside its bottom edge
when the frame fills the screen.

Before every start, `free_space` is checked and the recording is refused below
500 MB.

## System audio

Windows has no loopback input that ffmpeg can open directly. That used to mean
telling every user to install Stereo Mix or VB-Cable. rbox does it in Rust
instead, in [`loopback.rs`](../src-tauri/src/loopback.rs):

1. Open the **default output device** as a capture device. cpal sets
   `AUDCLNT_STREAMFLAGS_LOOPBACK`, so WASAPI hands back what is currently
   playing. Nothing has to be installed.
2. Bind a TCP listener on `127.0.0.1:0` - port 0, so two instances cannot
   collide.
3. Return port, sample format, sample rate and channel count to the frontend.
4. ffmpeg opens `tcp://127.0.0.1:<port>` as a raw PCM input.

`system_audio_start` is called **before** ffmpeg spawns, because ffmpeg blocks
until the socket accepts its connection.

Two details are not obvious, and both were bugs first:

**Pacing.** WASAPI loopback delivers *nothing at all* while the machine is
silent. Writing only what arrives makes the audio track shorter than the video,
and it drifts out of sync at the first quiet moment. So the socket is paced off
the wall clock: `paced_bytes()` computes how many bytes should have been written
by now, minus a 0.2 s lag budget that absorbs callback jitter, rounded down to a
whole frame. Whatever the capture queue cannot fill is padded with zeros. That
is why only sample formats whose silence is all-zero bytes are accepted
(`f32le`, `s16le`, `s32le`).

**Blocking writes.** Windows hands out an accepted socket in the listener's
non-blocking mode. A momentarily full send buffer then fails the write instead
of waiting, which closed the stream about a second in and cut the audio short.
The socket is switched to blocking with a 5 s write timeout.

The capture queue is capped at 2 seconds of audio. Past that, ffmpeg is not
keeping up, and the oldest samples are worth less than bounded memory.

Microphones are a completely separate path: they come from DirectShow
(`-f dshow -i audio=<name>`) and several can be picked at once. `systemAudio` is
a boolean switch, not a device in that list.

`listAudioDevices()` parses `ffmpeg -list_devices true -f dshow -i dummy`. That
command exits non-zero and writes to stderr by design - it is not a failure.

## Rust commands

The Rust side is intentionally tiny.

| Command | File | Purpose |
| --- | --- | --- |
| `free_space(path)` | `lib.rs` | Free bytes on the volume holding `path`. Uses `GetDiskFreeSpaceExW`, and returns `None` on non-Windows rather than blocking a recording on a check it cannot make. |
| `system_audio_start()` | `loopback.rs` | Starts loopback capture, returns `{ port, format, sampleRate, channels }`. |
| `system_audio_stop()` | `loopback.rs` | Sets the stop flag for the capture thread. |
| `screenshot(x, y, w, h, path)` | `lib.rs` | GDI `BitBlt` of a physical-pixel region, saved as PNG. |
| `list_windows()` | `lib.rs` | Visible app windows as `[x, y, w, h]`, topmost first, for the picker's click-to-snap. DWM frame bounds (no invisible resize borders); skips rbox, minimized, cloaked, tool and untitled windows and the desktop. `windowAt()` in `geometry.ts` hit-tests them. |
| `tool_window(label)` | `lib.rs` | Adds `WS_EX_TOOLWINDOW` to a window, so Chromium does not count it as covering what lies behind. |
| `claim_print_screen()` | `lib.rs` | Turns off Windows' Print Screen -> Snipping Tool setting and tells the shell. Async: the broadcast may wait on slow windows. |
| `copy_image(path)` | `lib.rs` | Puts a PNG on the clipboard. In Rust because the file may sit outside every fs scope. |
| `move_file(from, to)` | `lib.rs` | Rename, or copy + remove across drives (temp is on C:, the output folder may not be). |
| `open_with(path)` | `lib.rs` | Windows' own "Open with" dialog (`rundll32 shell32.dll,OpenAs_RunDLL`). |
| `quit()` | `lib.rs` | Ends the app. Called by the tray's Quit after the recording is finished. |

`system_audio_start` stops any previous capture first, so a recording that ended
badly cannot keep writing.

## Settings and presets

[`settings.ts`](../src/lib/settings.ts) holds the whole shape. Everything is
stored in `localStorage` under `rbox.settings`. Loading merges over `DEFAULTS`,
so a field added later never reads as `undefined`. The same merge is applied to
every stored preset.

A **preset** remembers *how* to record, for all three formats at once: fps,
quality, microphones, system audio, output folder, GIF fps and GIF width. It
deliberately does **not** store the format - picking Video, GIF or Screenshot
stays a live choice.

A preset can optionally remember an **area** (`area: PresetArea | null`).
`null` means "leave the current selection alone", which is the right default for
a preset that only fixes the *how*, not the *where*.

There is no save button. `syncActivePreset()` runs inside every settings update,
so the selected preset follows the UI live. Picking a preset is the only save
step there is.

`presetFields()` returns the preset keys in a fixed order, so a JSON comparison
can tell settings and presets apart.

`printScreen`, `delay`, `language`, `compact`, `drawArea`, `closeToTray` and
`screenshotToClipboard` are app-wide, not part of a preset. "Start with
Windows" is not stored at all: the Run key is the truth, read with
`isEnabled()` from `tauri-plugin-autostart`.

## Translations

[`i18n.ts`](../src/lib/i18n.ts): the English text is the key, `t("Start
recording")`, so English needs no file and a missing translation falls back to
it. `{name}` placeholders are filled from the second argument.

A language file is `{ name, version, flag, strings }`; `flag` is an ISO 3166-1
alpha-2 code (`"DE"`), drawn from `country-flag-icons` because Windows has no
flag emoji. Files in `lang/` are bundled;
files in `%APPDATA%\rbox\lang\` are the user's and win over a bundled
one with the same id. `version` is the rbox version the strings were written
for; Settings compares it with the app version.

Every window is its own JS context, so each calls `loadLanguage()` before its
first render: App's startup, `overlay.tsx`, `popShotMenu()`. Switching language
loads the file first, then updates settings, so the re-render shows the new
strings.

`i18n.test.ts` fails when a `lang/*.json` misses a `t()` key, keeps a stale one,
or carries another version than `package.json`. Labels kept in constants
(quality, size presets, screenshot menu) reach `t()` as variables and are not
found as keys - translate them by hand.

## Window auto-sizing

The main window has a fixed width (480) and follows its content in height. A
`ResizeObserver` on the root element plus a `MutationObserver` on
`document.body` call `fit()`, coalesced into one animation frame.

The `MutationObserver` is not redundant. Popups (`[data-popup]`,
`[data-slot="select-content"]`) are portalled or absolutely positioned, so they
never change the root element's box and the `ResizeObserver` stays quiet.
`fit()` measures their bottom edge explicitly, otherwise the window clips open
dropdowns.

While recording, the panel becomes a small draggable bar sized to its content
(`widthRef = null`), placed at the frame. The panel's position before the switch
is remembered and restored afterwards, so it does not inherit wherever the bar
was parked.

Compact mode also sizes the window to one row and keeps it on top. `drawArea`
chooses between the saved frame and opening the quick picker; cancelling the
picker brings the bar back. Settings use a sidebar with Recording, Video, GIF,
Screenshot, Audio, System and Language sections at the normal 480 px width.
Recording holds the shared output folder and delay; Screenshot holds the direct
clipboard option. System only contains Print Screen, autostart and close-to-tray.

Tooltips normally stay inside the current window. When neither side fits,
`tipWindow.ts` shows the label in `frame.html?tip`. That window stays shown but
empty between labels to avoid WebView2 focus and shadow flicker.

The startup splash renders inside the **same** `<main>` element as the panel.
`fit()` observes that element; swapping it for another one would leave the
observers watching a detached node.

[`appKeys.ts`](../src/lib/appKeys.ts) swallows browser shortcuts - reload,
devtools, print, find, zoom, context menu - because none of that belongs in an
app window. It stays inactive under `tauri dev`, where reload and devtools are
the point. Listeners are registered in the **capture** phase: `NumberField`
calls `stopPropagation()` on arrow keys to keep them out of the global nudge
handler, which would otherwise hand reload and print back to the webview.

## Permissions

[`src-tauri/capabilities/default.json`](../src-tauri/capabilities/default.json)
applies to the `main`, `overlay`, `shotbar` and `tip` windows. Notable entries:

- `shell:allow-execute` and `shell:allow-spawn` are restricted to the
  `binaries/ffmpeg` sidecar, with `args: true`
- `shell:allow-stdin-write` is what makes the clean `q` stop possible
- `fs` access is scoped to the video and temp directories
- Language files can also be read under `$DATA/rbox/**`
- `opener:allow-open-url` is limited to `https://github.com/*`,
  `https://ko-fi.com/*` and `ms-settings:easeofaccess-keyboard`
- `core:window:allow-center` re-centres `main` once its real height is known;
  without it `center()` fails silently
- `core:window:allow-set-content-protected` keeps the recording bar out of the
  video; `allow-set-always-on-top` and `allow-unminimize` bring it forward
- `dialog:allow-save` for "Save to…", `autostart:*` for "Start with Windows"
- tray and menu calls are covered by `core:default`

If you add a Tauri API call and it fails at runtime with a permission error,
this file is the place to look.

## Building installers

```bash
npm run build:win      # tauri build + installer cleanup
```

Output lands in `src-tauri/target/release/bundle/msi/`. MSI is the only bundle
target (`bundle.targets` in `tauri.conf.json`); the NSIS `-setup.exe` was
dropped because one installer format is enough.

[`scripts/rename-installers.mjs`](../scripts/rename-installers.mjs) runs after
the bundler and fixes two things Tauri does not expose in `tauri.conf.json`:

1. **File name.** `rbox_0.1.0_x64_en-US.msi` becomes `rbox_0.1.0_x64.msi` - the
   language suffix is noise on a single-language build.
2. **MSI summary stream.** Title and comments, written through the
   `WindowsInstaller.Installer` COM API from PowerShell. The default comment is
   WiX boilerplate ("This installer database contains the logic and data
   required to install rbox"). The values live in the `MSI_SUMMARY` map at the
   top of the script, keyed by MSI summary property id.

The script verifies what it wrote and fails the build if the summary stream did
not change. Run `node scripts/rename-installers.mjs --check` to test the
renaming rules on their own.

Publisher and copyright come from `bundle.publisher` and `bundle.copyright` in
[`tauri.conf.json`](../src-tauri/tauri.conf.json). They show up in the
installer, in "Apps & features" and in the executable's file properties.

The bundle identifier must not end in `.app` - Tauri warns about it because it
clashes with the macOS bundle extension. Note that changing the identifier moves
the app's data folder and the uninstall registry key, which orphans existing
installs.

## Tests

```bash
npm test                                           # TypeScript
cargo test --manifest-path src-tauri/Cargo.toml    # Rust
```

`npm test` uses the built-in Node test runner with
`--experimental-strip-types`, so there is no test framework to install. It
covers the parts where a silent mistake is expensive:

| File | Covers |
| --- | --- |
| `geometry.test.ts` | clamping, even rounding, monitor hit-testing, layout repair, recording bar placement |
| `settings.test.ts` | preset field selection and live syncing |
| `ffmpeg.test.ts` | input order and `-map` arguments for every audio combination |
| `version.test.ts` | version comparison for the update hint |
| `i18n.test.ts` | complete translation keys, no stale keys, current app version |
| `loopback.rs` | socket pacing keeps whole frames and lags the clock |

## Promo images

`rbox-promo-2.png`, `rbox-promo-3.png`, `demo.gif`, `demo.mp4` and
`compact.gif` are rendered from the **real UI** in a browser.
[`scripts/promo/mock.ts`](../scripts/promo/mock.ts) answers the Tauri IPC with
`mockIPC` / `mockWindows`; only the two native Windows menus are drawn by hand
in `promo.tsx`. `rbox-promo-1.png` is not generated.

```bash
npx vite    # dev server on :1420
node <browser-automation>/browser.mjs http://localhost:1420/scripts/promo/promo.html --script scripts/promo/shoot.mjs
node <browser-automation>/browser.mjs http://localhost:1420/scripts/promo/overlay.html --script scripts/promo/demo.mjs
node <browser-automation>/browser.mjs "http://localhost:1420/scripts/promo/promo.html?n=compact" --script scripts/promo/compact.mjs
```

The runner only has to open the URL in Chromium and call the script's default
export with the Playwright `page`; `playwright-core` with
`chromium.launch({ channel: "msedge" })` does it without downloading a browser.

`shoot.mjs` writes the two PNGs. `demo.mjs` (drag a frame, then click a window -
`mock.ts` reports the stand-in window from `list_windows`) and `compact.mjs`
(panel to compact bar and back) record frame by frame through `frames.mjs` and
encode with the project's ffmpeg sidecar. `OUT=<dir>` writes
elsewhere for review. Intermediate captures land in `scripts/promo/.shots/`
(git-ignored). Headless screenshots carry no pointer, so the demo draws one.

## Things that will bite you

- **Sidecar name.** No target-triple suffix, no ffmpeg. See
  [Getting started](#getting-started).
- **Killing ffmpeg.** It produces an unplayable mp4. Always send `q` on stdin.
- **Odd dimensions.** libx264 with `yuv420p` rejects them. Use `evenRect()`.
- **CSS pixels leaking out of the overlay.** Everything outside the overlay is
  physical pixels. Mixing the two breaks multi-monitor and scaled displays in
  ways that only show up on someone else's machine.
- **The red ring being recorded.** It must stay in the margin outside the
  region, and that margin must be scaled by the monitor's scale factor.
- **Silence in system audio.** Do not "optimise away" the zero padding. It is
  what keeps the audio track the same length as the video.
- **Non-blocking accepted sockets on Windows.** They inherit the listener's
  mode and will truncate the audio track.
- **`-list_devices` exits non-zero.** That is normal, do not treat it as an
  error.
- **Tauri versions out of step.** The `tauri` crate and `@tauri-apps/api` must
  share major.minor, and the CLI should match. A new plugin can pull the crate
  up; bump the npm side with it.
- **Screenshotting your own UI.** Anything rbox shows while capturing is in the
  shot: hide the overlay before capturing, close the countdown ring, keep the
  recording bar content-protected.
- **Measuring before render.** The overlay renders nothing until it knows its
  bounds, so an effect that measures the toolbar must re-run once it exists.
- **Extended window styles.** tao rewrites `GWL_EXSTYLE` on `show()`, so a
  style set before it is gone. Set it afterwards (see `tool_window`).
- **Swallowed permission errors.** A window call without its capability
  rejects, and a `.catch(() => {})` hides that. `center()` failed this way for
  several releases.

## Licensing

The bundled ffmpeg is a **GPL** build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). If you distribute
rbox together with that binary, the GPL applies to the combined work and you
must make the corresponding ffmpeg sources available.

If that does not suit your use case, point
[`scripts/fetch-ffmpeg.mjs`](../scripts/fetch-ffmpeg.mjs) at an LGPL build
instead.
