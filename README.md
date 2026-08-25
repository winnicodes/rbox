# rbox

Minimal region recorder for Windows. Drag a frame, fine-tune it with exact
numbers right at its edge, record that area to mp4, GIF or PNG.

## Requirements

- Node 20+
- Rust stable (MSVC toolchain)
- Windows 10/11

## Setup

```bash
npm install          # postinstall downloads ffmpeg into src-tauri/binaries/
npm run tauri dev
```

`npm install` fetches a static ffmpeg build and installs it as a Tauri sidecar
named `ffmpeg-<rust-target-triple>.exe`. The suffix is required — without it
Tauri reports "program not found" at runtime. Re-run it any time with:

```bash
npm run fetch-ffmpeg
```

## Build

```bash
npm run tauri build     # NSIS + MSI in src-tauri/target/release/bundle/
```

## Tests

```bash
npm test                # coordinate math, preset/settings rules, ffmpeg args
cargo test --manifest-path src-tauri/Cargo.toml   # loopback pacing
```

## How it works

- **Coordinates.** Every rectangle is stored in *physical* desktop pixels — the
  space `gdigrab` expects. CSS pixels exist only inside the overlay webview,
  which converts pointer positions on the way in and the selection on the way
  out (`physicalToCss` in `src/lib/geometry.ts`).
- **The overlay** spans the whole virtual desktop, so Windows renders it at a
  single DPI. Its `devicePixelRatio` is therefore the only scale factor the math
  needs, which is what keeps mixed-scaling setups correct.
- **Recording** runs entirely from TypeScript via `tauri-plugin-shell`. Stopping
  writes `q` to ffmpeg's stdin rather than killing it — a killed ffmpeg leaves an
  unfinalized, unplayable mp4.
- **The recording frame** is a separate click-through window sized *larger* than
  the region by the border width, so its red ring lives in that margin and never
  gets captured.
- **GIF** is encoded from a scratch mp4 in two passes (palettegen → paletteuse).
- **Settings** live in `localStorage`. No settings backend, no store plugin.

## System audio

Nothing to install. ffmpeg has no native WASAPI loopback input on Windows, so
rbox captures the default output device in Rust (`src-tauri/src/loopback.rs`,
via cpal) and pipes the raw PCM to ffmpeg over a local TCP socket. Stereo Mix
and VB-Cable are not needed.

The socket is paced off the wall clock and padded with silence, because WASAPI
loopback delivers nothing at all while the machine is silent — writing only
what arrives would make the audio track shorter than the video.

Microphones are separate: those come from DirectShow and can be picked
individually, several at once. `systemAudio` is a switch, not a device.

## Licensing

The bundled ffmpeg is a GPL build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). If you distribute
rbox, the GPL applies to the combined work and you must make the corresponding
ffmpeg sources available. Swap `scripts/fetch-ffmpeg.mjs` to an LGPL build if
that does not suit you.
