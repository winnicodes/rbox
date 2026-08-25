# rbox — Roadmap

Minimalistischer Region-Recorder. Rahmen aufziehen, exakt justieren, Bereich aufnehmen.

**Status: Phase 0–8 umgesetzt und am laufenden Programm verifiziert.**
Verifiziert wurde: Region-Auswahl per Overlay → Übernehmen → Aufnahme → `1280×720`,
30 fps, 3,67 s, abspielbares mp4 unter `<Videos>\rbox`.

**Stack:** Tauri v2 (Rust) + Vite + React + TypeScript + Tailwind v4 + shadcn/ui + ffmpeg als Sidecar.

**Entschieden:**
- Output: mp4 (primär), GIF (2. ffmpeg-Pass), PNG-Screenshot (1 Frame, gleicher Code-Pfad)
- Capture: ffmpeg-Sidecar mit `gdigrab` (Windows)
- Auswahl: transparentes Vollbild-Overlay-Fenster mit Drag + 8 Resize-Handles + Zahlenfeldern am Rahmen
- v1 zusätzlich: globaler Hotkey, Audio (Mic + System), Multi-Monitor, FPS/Qualität

**Bewusst weggelassen (YAGNI — bauen wenn es weh tut):**
- Kein State-Management-Lib (Zustand/Redux) → React `useState` reicht
- Kein Settings-Backend → `localStorage` im Webview, null Rust-Code
- Kein eigener Encoder/Muxer → ffmpeg macht alles
- Kein Video-Editor, kein Upload, kein Tray-Menü, keine Update-Infrastruktur
- Kein `ddagrab` in v1 → `gdigrab` ist langsamer aber trivial; Upgrade siehe Phase 8

**Abweichung von der ursprünglichen Planung (Phase 5):**
Die Aufnahme wird nicht über einen eigenen Rust-Command gesteuert, sondern direkt
über `tauri-plugin-shell` aus TypeScript. `Command.sidecar(...).spawn()` liefert ein
`Child` mit `write()` — genau das, was für den sauberen `q`-Stopp nötig ist. Damit
entfällt jeglicher Rust-State. Rust enthält nur noch `free_space`.

---

## Phase 0 — Gerüst ✅

- [x] Tauri v2 + React + TypeScript + Vite scaffolded
- [x] Tailwind v4 (`@tailwindcss/vite`, `@import "tailwindcss"` in `src/index.css`)
- [x] `shadcn` init, Alias `@/*` in `tsconfig.json` + `vite.config.ts`
- [x] Komponenten: `button`, `input`, `select`, `switch`, `label`, `slider`, `separator`, `sonner`
- [x] Fenster: 420×620, `resizable: false`, Dark-Theme fix

---

## Phase 1 — ffmpeg-Sidecar ✅

- [x] `scripts/fetch-ffmpeg.mjs` lädt/entpackt ffmpeg nach
      `src-tauri/binaries/ffmpeg-<target-triple>.exe`, hängt als `postinstall`
- [x] `bundle.externalBin: ["binaries/ffmpeg"]`
- [x] `tauri-plugin-shell` mit Capability **nur** für dieses Sidecar
- [x] `.gitignore`: `src-tauri/binaries/`
- [x] Version wird in der Fußzeile der App angezeigt (= Smoke-Test)

**Gelernt:** `shell:allow-execute` deckt nur `execute()` ab. Für den laufenden
Recorder braucht es zusätzlich `shell:allow-spawn`, `shell:allow-stdin-write`
und `shell:allow-kill`.

---

## Phase 2 — Monitor-Geometrie & DPI ✅

- [x] `availableMonitors()` → `MonitorInfo` in **physischen** Pixeln
- [x] `virtualBounds()` inkl. negativer Origins
- [x] `cssToPhysical` / `physicalToCss` als einziger Umrechnungspunkt
- [x] Monitor-Dropdown (setzt Rahmen auf den ganzen Monitor)
- [x] Self-Check `src/lib/geometry.test.ts`, 9 Tests, `npm test`

**Gelöst:** Das Overlay spannt den gesamten Virtual Desktop, deshalb rendert
Windows es mit **einem** DPI. Als Skalierungsfaktor dient darum die
`devicePixelRatio` des Overlay-Fensters, nicht der Scale-Faktor je Monitor —
das ist genau der Punkt, an dem gemischte Skalierung sonst kippt.

---

## Phase 3 — Overlay-Fenster ✅

- [x] `WebviewWindow` `overlay`, `transparent`, `decorations: false`,
      `alwaysOnTop`, `skipTaskbar`, unsichtbar erzeugt und dann in
      **physischen** Pixeln platziert (`PhysicalPosition`/`PhysicalSize`)
- [x] Eigener Entry `overlay.html` (Vite Multi-Page)
- [x] Abdunkelung über 4 Divs, kein SVG-Mask, kein Canvas
- [x] Drag zieht Rechteck auf, 8 Resize-Handles, Verschieben
- [x] `Esc` bricht ab, `Enter` übernimmt
- [x] Clamping auf Bildschirmgrenzen
- [x] Init-Fehler werden sichtbar gerendert — ein transparentes Fenster, das
      nichts zeichnet, sieht sonst aus als wäre es nie aufgegangen

---

## Phase 4 — Exakte Einstellungen am Rahmen ✅

- [x] Toolbar am Rahmen, klappt nach oben wenn unten kein Platz ist
- [x] Zahlenfelder `x` `y` `w` `h`, bidirektional gebunden
- [x] Pfeiltasten 1 px, `Shift` 10 px, `Alt` skaliert statt zu verschieben
- [x] Seitenverhältnis-Lock frei / 16:9 / 4:3 / 1:1
- [x] Presets 1080p / 720p / 600p, zentriert auf dem aktuellen Monitor
- [x] Live-Maße während des Ziehens
- [x] `w`/`h` immer gerade (H.264/yuv420p)
- [x] Button „Neu" — bei bildschirmfüllendem Rahmen gibt es sonst keine freie
      Fläche mehr, auf der ein neuer Zug beginnen könnte

---

## Phase 5 — Aufnahme (mp4) ✅

- [x] `-f gdigrab -framerate F -offset_x X -offset_y Y -video_size WxH -i desktop`
      `-c:v libx264 -preset veryfast -crf {28|23|18} -pix_fmt yuv420p -fps_mode cfr`
- [x] **Stopp schreibt `q` auf stdin**, kein `kill()` — sonst bleibt der
      mp4-Container unfertig. Fallback: nach 3 s doch `kill()`
- [x] Ausgabe `<Videos>\rbox\rbox-YYYYMMDD-HHMMSS.mp4`
- [x] ffmpeg-stderr wird mitgelesen und im Fehlerfall angezeigt
- [x] Status im UI: Laufzeit + mitwachsende Dateigröße
- [x] Roter Rahmen bleibt während der Aufnahme sichtbar: eigenes
      klick-durchlässiges Fenster (`frame.html`), das um die Randstärke
      **größer** ist als die Region. Der Ring liegt damit komplett im Rand
      außerhalb des Aufnahmebereichs und landet nie im Video. Die Randstärke
      wird mit dem Scale-Faktor des Monitors multipliziert, sonst blutet der
      Ring auf skalierten Displays in die Region

---

## Phase 6 — Screenshot & GIF ✅

- [x] Screenshot = gleicher Aufruf + `-frames:v 1 -update 1`
- [x] GIF in zwei Pässen (`palettegen=stats_mode=diff` → `paletteuse`),
      Zwischen-mp4 und Palette liegen in `$TEMP` und werden gelöscht
- [x] Format-Auswahl mp4 / gif / png, GIF-FPS und GIF-Breite einstellbar
- [x] Nach dem Speichern wird die Datei im Explorer angezeigt

---

## Phase 7 — Audio, Hotkey, Settings ✅

- [x] Geräte aus `ffmpeg -list_devices true -f dshow -i dummy` geparst
- [x] Ein Gerät → `-map 0:v -map 1:a`; mehrere → `amix`
- [x] **Systemton:** ffmpeg hat unter Windows keinen nativen WASAPI-Loopback.
      Die App listet nur real vorhandene DirectShow-Geräte und sagt im UI klar,
      dass für Systemton ein Loopback-Gerät (Stereomix, VB-Cable) nötig ist.
      Kein eigener Treiber, kein Installer
- [x] Globaler Hotkey, Default `Ctrl+Shift+R`, im UI änderbar,
      Konfliktfehler wird angezeigt
- [x] Registrierungen laufen über eine Promise-Queue mit einmaligem Retry —
      sonst kollidieren Doppel-Effekte in „HotKey already registered"
- [x] Settings in `localStorage`: Rahmen, fps, Qualität, Format, Ordner,
      Audiogeräte, Hotkey, Seitenverhältnis, GIF-Parameter

---

## Phase 8 — Feinschliff & Bündeln ✅

- [x] Fehler-Toasts (`sonner`) statt stiller Fehlschläge
- [x] Freier Speicherplatz wird vor dem Start geprüft (Rust-Command
      `free_space` → `GetDiskFreeSpaceExW`), Abbruch unter 500 MB
- [x] App-Close während laufender Aufnahme wird abgefangen und sauber gestoppt
- [x] `npm run tauri build` → NSIS + MSI, ffmpeg liegt im Bundle
- [x] README mit Build-Schritten und ffmpeg-Lizenzhinweis

**Erst wenn es weh tut, nicht vorher:**
- `ddagrab` (Desktop Duplication) statt `gdigrab` — nur wenn 60 fps ruckelt
- Hardware-Encoder (`h264_nvenc` / `h264_qsv`) — nur wenn die CPU-Last stört
- Eigener Systemton-Pfad in Rust (WASAPI-Loopback) — nur wenn dshow zu unbequem ist
- Mehrfachauswahl / mehrere Regionen, Zeichenwerkzeuge, Cursor-Highlight

---

## Was noch nicht am laufenden Programm getestet wurde

- PNG-Ausgabe über die UI. Der ffmpeg-Aufruf ist auf der Kommandozeile
  verifiziert, der Klickpfad in der App aber nicht. (GIF über die UI ist
  verifiziert: 640×372, 8,87 s, 260 KB.)
- Aufnahme mit aktiviertem Mikrofon über die UI (der ffmpeg-Aufruf selbst ist
  auf der Kommandozeile verifiziert: 320×240 + AAC 44,1 kHz stereo).
- Zweiter Monitor mit abweichender Skalierung. Die Rechenlogik dafür deckt
  `geometry.test.ts` ab, echte Hardware mit gemischtem DPI stand nicht zur Verfügung.
