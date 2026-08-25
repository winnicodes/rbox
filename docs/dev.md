# rbox - Developer Guide

Technical notes for people who want to build, change or debug rbox. If you only
want to record your screen, the [README](../README.md) is enough.

- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Windows and processes](#windows-and-processes)
- [The coordinate rule](#the-coordinate-rule)
- [Recording pipeline](#recording-pipeline)
- [System audio](#system-audio)
- [Rust commands](#rust-commands)
- [Settings and presets](#settings-and-presets)
- [Window auto-sizing](#window-auto-sizing)
- [Permissions](#permissions)
- [Building installers](#building-installers)
- [Tests](#tests)
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
    ui/                 shadcn components
  lib/
    geometry.ts         rectangle math, the coordinate rule
    ffmpeg.ts           every ffmpeg call the app makes
    settings.ts         settings + preset shape, load/save, preset syncing
    paths.ts            output folder and timestamped file names
    monitors.ts         monitor list from Tauri, in physical pixels
    overlayWindow.ts    creates the full-desktop selection window
    frameWindow.ts      creates the red recording ring
    appKeys.ts          blocks browser shortcuts inside the webview
    version.ts          version compare for the update hint
    events.ts           event names shared between windows
src-tauri/
  src/lib.rs            Tauri setup, plugins, free_space command
  src/loopback.rs       WASAPI loopback capture -> TCP -> ffmpeg
  capabilities/         Tauri permission set
  binaries/             ffmpeg sidecar (downloaded, git-ignored)
scripts/
  fetch-ffmpeg.mjs      downloads the sidecar
  rename-installers.mjs post-build installer cleanup
index.html              main window
overlay.html            selection overlay
frame.html              recording ring (plain CSS, no framework)
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

rbox uses three webview windows and one child process.

| Window | File | Purpose |
| --- | --- | --- |
| `main` | `index.html` | The control panel. Owns all state. |
| `overlay` | `overlay.html` | Transparent, spans the whole virtual desktop. Used to pick a region. |
| `frame` | `frame.html` | Click-through red ring around the region while recording. |

The overlay and the frame are created on demand from
[`overlayWindow.ts`](../src/lib/overlayWindow.ts) and
[`frameWindow.ts`](../src/lib/frameWindow.ts), and closed when they are done.
They talk back to `main` with two events only, defined in
[`events.ts`](../src/lib/events.ts):

- `rbox:region-picked` - payload is a `Rect`
- `rbox:region-cancelled`

The ring window is **larger than the recorded region** by the border width on
every side, so the red line lives outside the captured rectangle and never shows
up in the recording. The border is sized in CSS pixels but the window in
physical ones, so `showFrame()` takes the monitor scale factor to keep the ring
out of the region on scaled displays.

Only one instance can run: `tauri-plugin-single-instance` focuses the existing
window instead of starting a second recorder that would fight over the same
output file.

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
  needs `-update` for a single non-sequence filename.

The window refuses to close while a recording runs (`onCloseRequested` in
`App.tsx`). It stops the recorder first, so no half-written file survives.

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
(`widthRef = null`). The panel's position before the switch is remembered and
restored afterwards, so it does not inherit wherever the bar was parked.

[`appKeys.ts`](../src/lib/appKeys.ts) swallows browser shortcuts - reload,
devtools, print, find, zoom, context menu - because none of that belongs in an
app window. It stays inactive under `tauri dev`, where reload and devtools are
the point. Listeners are registered in the **capture** phase: `NumberField`
calls `stopPropagation()` on arrow keys to keep them out of the global nudge
handler, which would otherwise hand reload and print back to the webview.

## Permissions

[`src-tauri/capabilities/default.json`](../src-tauri/capabilities/default.json)
applies to the `main` and `overlay` windows. Notable entries:

- `shell:allow-execute` and `shell:allow-spawn` are restricted to the
  `binaries/ffmpeg` sidecar, with `args: true`
- `shell:allow-stdin-write` is what makes the clean `q` stop possible
- `fs` access is scoped to the video and temp directories
- `opener:allow-open-url` is limited to `https://github.com/*` and
  `https://ko-fi.com/*`

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
| `geometry.test.ts` | clamping, even rounding, monitor hit-testing, layout repair |
| `settings.test.ts` | preset field selection and live syncing |
| `ffmpeg.test.ts` | input order and `-map` arguments for every audio combination |
| `version.test.ts` | version comparison for the update hint |
| `loopback.rs` | socket pacing keeps whole frames and lags the clock |

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

## Licensing

The bundled ffmpeg is a **GPL** build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). If you distribute
rbox together with that binary, the GPL applies to the combined work and you
must make the corresponding ffmpeg sources available.

If that does not suit your use case, point
[`scripts/fetch-ffmpeg.mjs`](../scripts/fetch-ffmpeg.mjs) at an LGPL build
instead.
