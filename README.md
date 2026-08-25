<div align="center">

<img src="docs/media/hero.svg" alt="rbox - minimal screen recorder" width="820">

<br>

**Drag a frame. Hit record.**

Region screen recorder for Windows. Frame an area to the pixel, save it as MP4, GIF or PNG.

<br>

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4?style=flat-square)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584?style=flat-square)
![ffmpeg](https://img.shields.io/badge/ffmpeg-bundled-007808?style=flat-square)

[Download](#install) · [Usage](#usage) · [Build from source](#build-from-source) · [Developer guide](docs/dev.md)

</div>

---

## 🎯 What it does

rbox records **any rectangle of your screen** - a small region, a single window,
or a whole display. You pick the area once, correct it to the pixel, and record
it as often as you like.

- **Exact region.** Drag it, or type the numbers. The size fields sit right on
  the edge of the selection, so you never lose sight of what you are framing.
- **Three formats.** MP4 (H.264), animated GIF, or a single PNG frame.
- **System sound, no drivers.** Records what your machine is playing. No Stereo
  Mix, no VB-Cable, nothing to install.
- **Microphones.** Pick one, several, or none. They are mixed into the recording.
- **Multi-monitor and mixed DPI.** Move the area between displays and it keeps
  its size. Scaled displays are handled correctly.
- **Presets.** Save how you record - fps, quality, audio, output folder - and
  optionally the area too.
- **A visible frame.** A red ring marks the region while recording, and it never
  ends up in the file.
- **Stays out of the way.** While recording, the panel shrinks to a small bar
  you can drag anywhere.

Files are saved to `Videos\rbox` by default, named by timestamp, and the folder
opens automatically when a recording finishes.

## ✂️ Picking a region

<div align="center">
  <img src="docs/media/demo.gif" alt="Dragging a region open, with the size updating as it grows" width="820">
</div>

Drag anywhere. The size counts up while you pull, and the toolbar that follows
lets you snap to 1080p, 720p or square, go full screen, or type exact numbers.

## 🖼️ Screenshots

<div align="center">
  <img src="docs/media/panel.png" alt="The rbox panel with an area selected" width="400">
  <img src="docs/media/settings.png" alt="Settings: frame rate, quality, audio and output folder" width="400">
</div>

<div align="center">
  <img src="docs/media/overlay.png" alt="The selection overlay with its toolbar" width="700">
  <br>
  <img src="docs/media/recording.png" alt="The recording bar with elapsed time" width="260">
  <br>
  <sub>While recording, the panel shrinks to this bar - drag it out of your way.</sub>
</div>

<a id="install"></a>

## 📦 Install

Download `rbox_<version>_x64.msi` from the
[Releases page](https://github.com/winnicodes/rbox/releases) and run it.

Windows 10 or 11, 64-bit. ffmpeg is bundled - there is nothing else to install.

The installer is not code-signed yet, so SmartScreen will warn you on first run.
Choose **More info → Run anyway**, or build it yourself from source.

<a id="usage"></a>

## ▶️ Usage

1. Click the crop button (**Select area**) and drag a rectangle. Correct it with
   the number fields on its edge, or pick a size preset (1080p, 720p, square).
2. Choose the format: **Video**, **GIF** or **PNG**.
3. Turn system sound and microphones on or off.
4. Hit record. The panel becomes a small bar with a timer.
5. Stop. The output folder opens with your file selected.

### While picking a region

| Key | Action |
| --- | --- |
| Drag | Draw a new region |
| Drag inside / corners | Move or resize it |
| Arrow keys | Nudge by 1 px |
| Shift + arrows | Nudge by 10 px |
| Enter | Confirm |
| Esc | Cancel |

### Good to know

- The red ring is drawn **outside** the recorded area, so it is never part of
  the file.
- The eye button shows the ring without recording, so you can check your framing.
- Recording is refused below 500 MB of free disk space.
- Closing the window mid-recording finishes the file first - it never leaves a
  broken MP4 behind.

<a id="build-from-source"></a>

## 🔨 Build from source

You need Windows 10/11, [Node 20+](https://nodejs.org),
[Rust](https://rustup.rs) with the MSVC toolchain, and the usual
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/winnicodes/rbox
cd rbox
npm install          # also downloads the ffmpeg sidecar
npm run tauri dev    # run it
npm run build:win    # build the MSI into src-tauri/target/release/bundle/msi/
```

Install Rust **before** `npm install` - the ffmpeg download names the binary
after your Rust target triple, which it reads from `rustc -vV`.

```bash
npm test                                           # TypeScript tests
cargo test --manifest-path src-tauri/Cargo.toml    # Rust tests
```

## ⚙️ How it works

The short version:

- **Capture** is ffmpeg's `gdigrab`, run as a Tauri sidecar and driven from
  TypeScript.
- **Every rectangle is in physical desktop pixels**, the coordinate space
  `gdigrab` expects. The selection overlay spans the entire virtual desktop, so
  Windows renders it at one DPI and a single scale factor keeps mixed-scaling
  setups correct.
- **Stopping sends `q` to ffmpeg's stdin** instead of killing it. A killed
  ffmpeg leaves an MP4 that no player will open.
- **System audio** is captured in Rust through WASAPI loopback and piped to
  ffmpeg over a local TCP socket. That is why no virtual audio device has to be
  installed.
- **GIF** is encoded from a scratch MP4 in two passes, palette first.
- **Settings** live in `localStorage`. There is no settings backend.

The full explanation - architecture, the coordinate rule, the audio pacing, the
build pipeline and the traps - is in the **[Developer guide](docs/dev.md)**.

## 🤝 Contributing

Issues and pull requests are welcome. Please read
[docs/dev.md](docs/dev.md) first; it documents the invariants that are easy to
break by accident, especially around coordinates and the recording ring.

## ☕ Support

If you like rbox, you can [buy me a coffee](https://ko-fi.com/winnicodes).

---

## 🎬 Built with ffmpeg

rbox does not implement any capture, encoding or muxing of its own. **All
recording, encoding and conversion is done by [ffmpeg](https://ffmpeg.org)**,
which ships with the application as a sidecar binary.

The bundled build is a **GPL** build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). Because that binary
is distributed together with rbox, the GPL applies to the combined work, and
anyone redistributing it must make the corresponding ffmpeg sources available.

ffmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

<div align="center">
<sub>Made by <a href="https://github.com/winnicodes">winnicodes</a></sub>
</div>
