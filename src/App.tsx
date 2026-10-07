import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { remove } from "@tauri-apps/plugin-fs";
import {
  register as registerShortcut,
  unregister as unregisterShortcut,
} from "@tauri-apps/plugin-global-shortcut";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as autostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { IconMenuItem, Menu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { toast } from "sonner";
import { isNewer } from "@/lib/version";
import {
  AppWindowIcon,
  ArrowUpCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  CoffeeIcon,
  CropIcon,
  EyeIcon,
  EyeOffIcon,
  FilmIcon,
  FolderIcon,
  ImageIcon,
  LoaderIcon,
  MicIcon,
  MicOffIcon,
  MinusIcon,
  MonitorIcon,
  PencilIcon,
  PowerIcon,
  SettingsIcon,
  VideoIcon,
  Volume2Icon,
  VolumeOffIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import logo from "@/assets/logo.svg";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PresetTray, { PresetBanner } from "@/components/PresetTray";
import Segmented, { SEGMENT, SEGMENT_OFF, SEGMENT_ON } from "@/components/Segmented";
import DeviceSelect, { shortDeviceName } from "@/components/DeviceSelect";

import { cn } from "@/lib/utils";
import { QUICK_CAPTURE, REGION_PICKED, SHOT_ACTION } from "@/lib/events";
import { menuIcon } from "@/lib/shotMenu";
import { listMonitors } from "@/lib/monitors";
import { openOverlay } from "@/lib/overlayWindow";
import { hideFrame, showFrame, showShotMenu } from "@/lib/frameWindow";
import { defaultOutDir, outputPath, palettePath, tempShotPath, tempVideoPath } from "@/lib/paths";
import {
  type Format,
  type PresetArea,
  loadSettings,
  presetFields,
  saveSettings,
  syncActivePreset,
  type Preset,
  type Settings,
} from "@/lib/settings";
import {
  ffmpegVersion,
  listAudioDevices,
  screenshot,
  startRecording,
  toGif,
  type Recording,
} from "@/lib/ffmpeg";
import {
  barPosition,
  centeredRect,
  evenRect,
  fitRectToMonitors,
  monitorOfRect,
  startupRect,
  type MonitorInfo,
  type Rect,
} from "@/lib/geometry";

type Status = "idle" | "recording" | "processing";

const FPS_CHOICES = [15, 30, 60];
const QUALITY_LABELS = { low: "Low", medium: "Medium", high: "High" } as const;

const REPO_URL = "https://github.com/winnicodes/rbox";
/** Where the newest tag is published. Public data, no token needed. */
const RELEASES_API = "https://api.github.com/repos/winnicodes/rbox/releases/latest";
const KOFI_URL = "https://ko-fi.com/winnicodes";
const LOW_SPACE_BYTES = 500 * 1024 * 1024;
const DELAY_CHOICES = [0, 3, 5, 10];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Brings the panel back from the tray or the taskbar, without taking focus. */
async function surface() {
  const win = getCurrentWindow();
  await win.unminimize().catch(() => {});
  await win.show().catch(() => {});
}

/** The panel's fixed width. Its height follows the content — see fit(). */
const WIDTH_MAIN = 480;
/** Two columns of settings. */
const WIDTH_SETTINGS = 620;

/** Out-of-flow layers the window has to make room for. */
const POPUPS = '[data-popup], [data-slot="select-content"]';

/** lucide dropped its brand icons, so the GitHub mark rides along as a path. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** GIF width as shown to the user; 0 means the region's own width. */
function gifSize(w: number): string {
  return w ? `${w} px` : "Original";
}

/**
 * One line describing what a preset records — shown in the tray. It covers all
 * three formats, because the format itself is not part of a preset.
 */
function presetSummary(p: Preset): string {
  const how = `${p.fps} fps · ${QUALITY_LABELS[p.quality].toLowerCase()} · gif ${gifSize(p.gifWidth)}`;
  // A remembered area is the one thing that changes what gets recorded, so it
  // leads the line.
  return p.area ? `${p.area.rect.w} × ${p.area.rect.h} · ${how}` : how;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [appVersion, setAppVersion] = useState("");
  /** Resolved <Videos>/rbox — shown and opened whenever `outDir` is null. */
  const [defaultDir, setDefaultDir] = useState("");
  /** Link to a release newer than this build, or null. */
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  /** False until monitors, settings and devices are in: only the logo shows. */
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState<"main" | "settings">("main");
  /** Shows the recording ring on screen without recording. */
  const [preview, setPreview] = useState(false);

  const rootRef = useRef<HTMLElement>(null);
  const monitorsRef = useRef<MonitorInfo[]>([]);
  const recording = useRef<Recording | null>(null);
  const videoPath = useRef<string | null>(null);
  const startedAt = useRef(0);
  /** Remembers the selection so the microphone button can restore it. */
  const lastMics = useRef<string[]>([]);
  /** Latched for as long as start() runs, so one click starts one recording. */
  const starting = useRef(false);
  /** The screenshot waiting in temp for the shot bar's choice. */
  const pendingShot = useRef<string | null>(null);
  /** Where the panel stood before the recording bar took over. */
  const posBeforeBar = useRef<PhysicalPosition | null>(null);
  /** Window width for fit(); null means "as wide as the content is". */
  const widthRef = useRef<number | null>(WIDTH_MAIN);
  const fitRef = useRef<() => void>(() => {});

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      // Here rather than per control, so no change can slip past.
      next.presets = syncActivePreset(next);
      return next;
    });
  }, []);

  // Persisting belongs here, not in the updater above: React is free to run an
  // updater more than once, so it has to stay a pure function of `prev`. The
  // write lands before any click handler can loadSettings() again, because
  // effects flush at the end of the commit that queued them.
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // --- startup -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      setDefaultDir(await defaultOutDir().catch(() => ""));
      const version = await getVersion().catch(() => "");
      setAppVersion(version);
      // Offline, rate-limited or no release yet: no arrow, no complaint. Not
      // awaited: a slow network must not hold the UI back.
      if (version) {
        void fetch(RELEASES_API)
          .then((r) => (r.ok ? (r.json() as Promise<{ tag_name?: string; html_url?: string }>) : null))
          .then((latest) => {
            if (latest?.tag_name && latest.html_url && isNewer(latest.tag_name, version)) {
              setUpdateUrl(latest.html_url);
            }
          })
          .catch(() => {});
      }
      try {
        // Only a presence check — the version string itself is not shown.
        await ffmpegVersion();
      } catch (e) {
        toast.error("ffmpeg not found", { description: String(e) });
      }
      const mons = await listMonitors().catch(() => []);
      setMonitors(mons);
      monitorsRef.current = mons;
      // A preset is never active at startup — it is a choice for this session,
      // and recording with yesterday's settings without saying so is a
      // surprise. The remembered area does survive; startupRect only gives up
      // its position when the display it lived on is gone. Not routed through
      // update(), because syncActivePreset() would write the repaired area
      // straight back into the preset we are deselecting.
      setSettings((prev) => ({
        ...prev,
        activePreset: null,
        ...startupRect(prev.rect, prev.monitorName, mons),
      }));
      setAudioDevices(await listAudioDevices().catch(() => []));
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The window follows the content height instead of scrolling it. Measuring
  // beats hard-coded heights: every view sizes itself and no constant goes
  // stale when a row is added.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let last = 0;
    let lastW = 0;
    // The config centres the window at its guessed height; the first fit()
    // resizes it and keeps the top-left corner, so centre it once more when
    // the real height is known.
    let centred = false;
    const fit = () => {
      let bottom = el.getBoundingClientRect().height;
      // Popups are out of flow (portalled or absolute), so they never grow
      // `main`. Without their bottom edge the window would clip them.
      for (const p of document.querySelectorAll<HTMLElement>(POPUPS)) {
        bottom = Math.max(bottom, p.getBoundingClientRect().bottom + 12);
      }
      // The extra pixel absorbs logical-to-physical rounding.
      const h = Math.ceil(bottom) + 1;
      // The panel has a fixed width; the recording bar is `w-fit`, so its own
      // box is the answer. The extra pixel absorbs the same rounding as above.
      const w = widthRef.current ?? Math.ceil(el.getBoundingClientRect().width) + 1;
      if (bottom === 0 || (h === last && w === lastW)) return;
      last = h;
      lastW = w;
      const win = getCurrentWindow();
      void win
        .setSize(new LogicalSize(w, h))
        .then(() => {
          if (centred) return;
          centred = true;
          return win.center();
        })
        .catch(() => {});
    };
    fitRef.current = fit;

    // Both observers can fire for the same commit, and fit() measures every
    // popup on screen. Coalescing into one frame keeps that to a single layout
    // pass, taken after the browser has done the work anyway.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    // Opening a popup changes nothing about `main`'s box, so the ResizeObserver
    // stays quiet — watch for the node appearing instead.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // Recording swaps the panel for a bar that sizes itself to REC, the timer
  // and the stop button.
  useEffect(() => {
    widthRef.current =
      status === "recording" ? null : view === "settings" ? WIDTH_SETTINGS : WIDTH_MAIN;
    fitRef.current();
    // The bar is a window of its own to drag around; the panel should not
    // inherit wherever it was parked, so it goes back where it stood.
    const win = getCurrentWindow();
    // While recording the bar floats above everything (Print Screen may start
    // it with other apps in front) and stays out of the video. Protection is
    // switched on in start(), before ffmpeg grabs its first frame.
    void win.setAlwaysOnTop(status === "recording").catch(() => {});
    if (status !== "recording") void win.setContentProtected(false).catch(() => {});
    if (status === "recording") {
      void win
        .outerPosition()
        .then((p) => {
          posBeforeBar.current = p;
          // The bar sits at the frame, like the picker's toolbar. Its size is
          // a close estimate: fit() is resizing it in the same moment. The gap
          // clears the 3 px ring.
          const r = loadSettings().rect;
          const mon = r && monitorOfRect(monitorsRef.current, r);
          if (!r || !mon) return;
          const s = mon.scale;
          const at = barPosition(r, mon, { w: 320 * s, h: 57 * s }, 11 * s);
          return win.setPosition(new PhysicalPosition(at.x, at.y));
        })
        .catch(() => {});
    } else if (posBeforeBar.current) {
      const back = posBeforeBar.current;
      posBeforeBar.current = null;
      void win.setPosition(back).catch(() => {});
    }
  }, [status, view]);

  // Frame preview. Driven by an effect rather than by the click handler, so the
  // ring follows a region that changes after it was switched on. While
  // recording the ring belongs to the recorder, so this keeps its hands off.
  useEffect(() => {
    if (status !== "idle") return;
    const r = settings.rect;
    if (!preview || !r) {
      void hideFrame().catch(() => {});
      return;
    }
    const scale = monitorOfRect(monitorsRef.current, r)?.scale ?? 1;
    void showFrame(r, scale).catch(() => {});
  }, [preview, status, settings.rect]);

  // Nothing to preview once the region is gone.
  useEffect(() => {
    if (!settings.rect) setPreview(false);
  }, [settings.rect]);

  // Overlay reports the picked region back here.
  useEffect(() => {
    const un = listen<Rect>(REGION_PICKED, (e) => {
      update({
        rect: e.payload,
        monitorName: monitorOfRect(monitorsRef.current, e.payload)?.name ?? null,
      });
    });
    return () => {
      void un.then((f) => f());
    };
  }, [update]);

  // Print Screen opens the area picker. Unregister waits for register, so a
  // quick off-on-off cannot leave the key grabbed.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (!settings.printScreen) return;
    const reg = registerShortcut("PrintScreen", (e) => {
      if (e.state !== "Pressed" || statusRef.current !== "idle") return;
      setPreview(false);
      void openOverlay("png");
    });
    // "already registered" means another app holds the key via RegisterHotKey.
    // Anything else is worth showing as is. Either way the switch goes back
    // off, so it never claims a key rbox does not have.
    reg.catch((e) => {
      update({ printScreen: false });
      if (/already registered/i.test(String(e))) toast.error("Print Screen is used by another app");
      else toast.error("Print Screen unavailable", { description: String(e) });
    });
    return () => {
      void reg.then(() => unregisterShortcut("PrintScreen")).catch(() => {});
    };
  }, [settings.printScreen, update]);

  // --- recording -----------------------------------------------------------
  const finish = useCallback(async (source: string) => {
    const s = loadSettings();
    if (s.format !== "gif") {
      await revealItemInDir(source).catch(() => {});
      return;
    }
    setStatus("processing");
    const gifPath = await outputPath(s.outDir, "gif");
    try {
      await toGif(source, gifPath, await palettePath(), s.gifFps, s.gifWidth);
      await remove(source).catch(() => {});
      await revealItemInDir(gifPath).catch(() => {});
    } catch (e) {
      toast.error("GIF conversion failed", { description: String(e) });
    }
  }, []);

  const stop = useCallback(async () => {
    const rec = recording.current;
    if (!rec) return;
    recording.current = null;
    try {
      await rec.stop();
      const source = videoPath.current;
      // Out of the recording bar before finish() may switch to "processing".
      setStatus("idle");
      if (source) await finish(source);
    } catch (e) {
      toast.error("Recording failed", { description: String(e) });
    } finally {
      setStatus("idle");
      videoPath.current = null;
      await hideFrame().catch(() => {});
    }
  }, [finish]);

  /** `over` wins over the stored settings, for callers whose update() has not
   * been saved yet. */
  const start = useCallback(async (over?: Partial<Settings>) => {
    // Every path below awaits before the status flips to "recording", so a
    // second click would otherwise spawn a second recorder onto the same file.
    if (starting.current) return;
    starting.current = true;
    try {
      const s = { ...loadSettings(), ...over };
      if (!s.rect) {
        toast.error("No area selected");
        return;
      }

      const dir = s.outDir ?? (await defaultOutDir());
      const free = await invoke<number | null>("free_space", { path: dir }).catch(() => null);
      if (free !== null && free < LOW_SPACE_BYTES) {
        toast.error("Not enough disk space", { description: `${formatBytes(free)} free` });
        return;
      }

      const scale = monitorOfRect(monitorsRef.current, s.rect)?.scale ?? 1;
      if (s.delay > 0) {
        // The ring marks what is about to be captured and counts down inside
        // it. That number sits in the region, so it goes before the capture.
        await showFrame(s.rect, scale, { count: s.delay }).catch(() => {});
        await sleep(s.delay * 1000);
        await hideFrame().catch(() => {});
      }

      if (s.format === "png") {
        try {
          const shot = await tempShotPath();
          await screenshot(s.rect, shot);
          // A shot nobody chose for is replaced, not kept.
          if (pendingShot.current) await remove(pendingShot.current).catch(() => {});
          pendingShot.current = shot;
          await hideFrame().catch(() => {});
          await showShotMenu();
        } catch (e) {
          await hideFrame().catch(() => {});
          await surface();
          toast.error("Screenshot failed", { description: String(e) });
        }
        return;
      }

      try {
        // GIF is encoded from a scratch mp4 so the recorder itself stays one path.
        const target = s.format === "gif" ? await tempVideoPath() : await outputPath(s.outDir, "mp4");
        videoPath.current = target;
        // Keeps the recording bar out of the file (WDA_EXCLUDEFROMCAPTURE).
        await getCurrentWindow().setContentProtected(true).catch(() => {});
        recording.current = await startRecording({
          rect: s.rect,
          fps: s.fps,
          quality: s.quality,
          audioDevices: s.audioDevices,
          systemAudio: s.systemAudio,
          outPath: target,
        });
        startedAt.current = Date.now();
        setElapsed(0);
        setStatus("recording");
        // Started from Print Screen the panel may sit in the tray; Stop lives here.
        await surface();
        await showFrame(s.rect, scale).catch(() => {});
      } catch (e) {
        videoPath.current = null;
        await getCurrentWindow().setContentProtected(false).catch(() => {});
        await hideFrame().catch(() => {});
        await surface();
        toast.error("Could not start", { description: String(e) });
      }
    } finally {
      starting.current = false;
    }
  }, []);

  // Print Screen flow: the overlay already picked area and format. The format
  // sticks, so the panel shows what was just captured.
  useEffect(() => {
    const un = listen<{ rect: Rect; format: Format }>(QUICK_CAPTURE, (e) => {
      const { rect, format } = e.payload;
      update({ rect, format, monitorName: monitorOfRect(monitorsRef.current, rect)?.name ?? null });
      void start({ rect, format });
    });
    return () => {
      void un.then((f) => f());
    };
  }, [update, start]);

  // Screenshot menu choice.
  useEffect(() => {
    const un = listen<"copy" | "save" | "saveas" | "open" | "close">(SHOT_ACTION, async (e) => {
      const shot = pendingShot.current;
      if (!shot) return;
      pendingShot.current = null;
      const act = e.payload;
      let kept = false;
      try {
        if (act === "copy") {
          await invoke("copy_image", { path: shot });
        } else if (act !== "close") {
          const suggested = await outputPath(loadSettings().outDir, "png");
          const out =
            act === "saveas"
              ? await saveDialog({ defaultPath: suggested, filters: [{ name: "PNG", extensions: ["png"] }] })
              : suggested;
          // Save as cancelled: the shot is dropped, like a dismissed menu.
          if (!out) return;
          await invoke("move_file", { from: shot, to: out });
          kept = true;
          if (act === "open") await invoke("open_with", { path: out });
          toast.success("Saved", {
            action: { label: "Show file", onClick: () => void revealItemInDir(out).catch(() => {}) },
          });
        }
      } catch (err) {
        await surface();
        toast.error("Screenshot failed", { description: String(err) });
      } finally {
        if (!kept) await remove(shot).catch(() => {});
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Tray right-click menu, with the app's own icons. Quit finishes a running
  // recording first, same as closing the window.
  useEffect(() => {
    const snip = (format: Format) => () => {
      if (statusRef.current !== "idle") return;
      setPreview(false);
      void openOverlay(format);
    };
    const entries: [string, LucideIcon, () => void][] = [
      ["Screenshot", ImageIcon, snip("png")],
      ["Video", VideoIcon, snip("mp4")],
      ["GIF", FilmIcon, snip("gif")],
      ["Open rbox", AppWindowIcon, () => void surface().then(() => getCurrentWindow().setFocus())],
      [
        "Quit rbox",
        PowerIcon,
        async () => {
          if (recording.current) await stop();
          await invoke("quit");
        },
      ],
    ];
    void (async () => {
      const items = await Promise.all(
        entries.map(async ([text, icon, action]) =>
          IconMenuItem.new({ text, icon: await menuIcon(icon), action }),
        ),
      );
      const separator = await PredefinedMenuItem.new({ item: "Separator" });
      const menu = await Menu.new({ items: [...items.slice(0, 3), separator, ...items.slice(3)] });
      await (await TrayIcon.getById("main"))?.setMenu(menu);
    })().catch(() => {});
  }, [stop]);

  const toggle = useCallback(() => {
    if (status === "recording") void stop();
    else if (status === "idle") void start();
  }, [status, start, stop]);

  // Elapsed time while recording.
  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Never let the window close on a half-written mp4.
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async (e) => {
      if (!recording.current) {
        // X goes to the tray: Print Screen and the tray menu need rbox running.
        // Quitting is the tray's "Quit rbox".
        e.preventDefault();
        await getCurrentWindow().hide();
        return;
      }
      e.preventDefault();
      toast.info("Finishing the recording…");
      await stop();
      await getCurrentWindow().destroy();
    });
    return () => {
      void un.then((f) => f());
    };
  }, [stop]);

  // --- UI ------------------------------------------------------------------
  const busy = status !== "idle";
  const rect = settings.rect;
  // monitorOfRect wants a real Rect, and the label below asked for it twice.
  const rectMonitor = rect ? (monitorOfRect(monitors, rect) ?? null) : null;
  const isPng = settings.format === "png";

  function selectMonitor(name: string | null) {
    const m = monitors.find((mm) => mm.name === name);
    if (!m) return;
    // Switching displays moves the area, it does not replace it: same size,
    // centred on the new screen, shrunk only if it would not fit. Falling back
    // to the full screen when there is no area yet is the one case where
    // nothing can be preserved.
    const r = settings.rect;
    const w = Math.min(r?.w ?? m.w, m.w);
    const h = Math.min(r?.h ?? m.h, m.h);
    update({ monitorName: m.name, rect: evenRect(centeredRect(w, h, m)) });
  }

  /** Quick on/off for the microphones picked in the settings. */
  function toggleMics() {
    if (settings.audioDevices.length > 0) {
      lastMics.current = settings.audioDevices;
      update({ audioDevices: [] });
      return;
    }
    const restore = lastMics.current.filter((d) => audioDevices.includes(d));
    update({ audioDevices: restore.length > 0 ? restore : audioDevices.slice(0, 1) });
  }

  // --- presets -------------------------------------------------------------
  function applyPreset(name: string | null) {
    const p = settings.presets.find((x) => x.name === name);
    if (!p) {
      update({ activePreset: null });
      return;
    }
    const fields = presetFields(p);
    // A preset stores device names. If one is unplugged, ffmpeg would abort the
    // whole recording, so drop it here rather than at start.
    if (audioDevices.length > 0) {
      const gone = fields.audioDevices.filter((d) => !audioDevices.includes(d));
      if (gone.length > 0) {
        fields.audioDevices = fields.audioDevices.filter((d) => audioDevices.includes(d));
        toast.warning(`${gone.length} audio device(s) unavailable`, {
          description: gone.map(shortDeviceName).join(", "),
        });
      }
    }
    // A remembered area is opt-in; without one the current selection stays.
    const area = p.area ? resolveArea(p.area) : null;
    update({ ...fields, ...area, activePreset: p.name });
  }

  /**
   * Turns a preset's saved area into a settings patch, or nothing when the
   * displays no longer have room for it — recording somewhere else silently
   * would be worse than ignoring the memory.
   */
  function resolveArea(a: PresetArea): Partial<Settings> | null {
    const mons = monitorsRef.current;
    const fitted = fitRectToMonitors(a.rect, mons);
    if (!fitted) {
      toast.warning("Saved area is off screen", {
        description: "Keeping the current selection.",
      });
      return null;
    }
    const monitorName =
      a.monitorName && mons.some((m) => m.name === a.monitorName) ? a.monitorName : null;
    return { rect: fitted, monitorName };
  }

  /** The area a preset would remember right now. */
  function currentArea(): PresetArea | null {
    return settings.rect ? { rect: settings.rect, monitorName: settings.monitorName } : null;
  }

  /** Per-preset switch: remember this area from now on, or stop remembering. */
  function toggleArea(name: string) {
    update({
      presets: settings.presets.map((p) =>
        p.name === name ? { ...p, area: p.area ? null : currentArea() } : p,
      ),
    });
  }

  function storePreset(name: string) {
    const clean = name.trim();
    if (!clean) return;
    // Same name overwrites — that is the rename-and-replace path.
    const existing = settings.presets.find((p) => p.name === clean);
    const rest = settings.presets.filter((p) => p.name !== clean);
    update({
      presets: [
        ...rest,
        {
          name: clean,
          ...presetFields(settings),
          // Only a preset that already remembers an area refreshes it; a new
          // one starts out not caring where you record.
          area: existing?.area ? currentArea() : null,
        },
      ],
      activePreset: clean,
    });
  }

  function renamePreset(from: string, to: string) {
    const clean = to.trim();
    if (!clean || clean === from) return;
    update({
      presets: settings.presets
        .filter((p) => p.name !== clean || p.name === from)
        .map((p) => (p.name === from ? { ...p, name: clean } : p)),
      ...(settings.activePreset === from ? { activePreset: clean } : {}),
    });
  }

  function deletePreset(name: string) {
    update({
      presets: settings.presets.filter((p) => p.name !== name),
      ...(settings.activePreset === name ? { activePreset: null } : {}),
    });
  }

  const micLabel =
    settings.audioDevices.length === 0
      ? "No mic"
      : settings.audioDevices.length === 1
        ? shortDeviceName(settings.audioDevices[0])
        : `${settings.audioDevices.length} mics`;

  const outLabel = settings.outDir ?? defaultDir;

  return (
    <main
      ref={rootRef}
      className={cn("flex flex-col bg-background text-foreground", status === "recording" && "w-fit")}
    >
      {/* Same <main> either way: fit() observes this element, not its content.
          The splash is about the panel's height, so the window barely moves. */}
      {!ready ? (
        <div data-tauri-drag-region className="flex h-115 items-center justify-center">
          <img src={logo} alt="rbox" className="size-16 animate-pulse rounded-2xl" />
        </div>
      ) : (
      <>
      {/* The OS title bar is off; this row is the whole window chrome. */}
      <header
        data-tauri-drag-region
        className={cn(
          "flex h-14 items-center gap-2.5 px-4.5",
          status === "idle" && view === "settings" && "border-b",
        )}
      >
        {status === "recording" ? (
          <span className="flex items-center gap-2.5 text-sm font-semibold text-destructive">
            <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
            REC
          </span>
        ) : view === "settings" ? (
          <>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Back"
              className="-ml-2 rounded-[10px] text-muted-foreground"
              onClick={() => setView("main")}
            >
              <ChevronLeftIcon className="size-4.5" />
            </Button>
            <h1 data-tauri-drag-region className="text-base font-semibold tracking-tight">
              Settings
            </h1>
            <PresetBanner active={settings.activePreset} />
          </>
        ) : (
          <>
            <img data-tauri-drag-region src={logo} alt="" className="size-5.5 rounded-md" />
            <h1 data-tauri-drag-region className="text-base font-semibold tracking-tight">
              rbox
            </h1>
            <PresetTray
              presets={settings.presets}
              active={settings.activePreset}
              summary={presetSummary}
              disabled={busy}
              onSelect={applyPreset}
              onCreate={storePreset}
              onRename={renamePreset}
              onDelete={deletePreset}
              onToggleArea={toggleArea}
            />
          </>
        )}

        {status === "recording" ? (
          <span
            data-tauri-drag-region
            className="font-mono text-[26px] leading-none font-medium tracking-tight tabular-nums"
          >
            {formatDuration(elapsed)}
          </span>
        ) : null}
        {/* While recording the button sits next to the timer, not at the far
            edge — the bar is only as wide as those two. */}
        <div
          data-tauri-drag-region
          className={cn("flex items-center gap-1", status !== "recording" && "ml-auto")}
        >
          {status === "recording" ? (
            <Button
              className="h-10 gap-2 rounded-[10px] bg-destructive px-4 text-sm font-semibold text-white hover:bg-destructive/90"
              onClick={toggle}
            >
              <span className="size-2.5 rounded-[3px] bg-white" />
              Stop
            </Button>
          ) : (
            <>
              {/* Settings save on every change; this only says so. */}
              {view === "settings" && (
                <span className="flex items-center gap-1.25 pr-1.5 text-xs whitespace-nowrap text-muted-foreground/80">
                  <CheckIcon className="size-3.25" />
                  Saved
                </span>
              )}
              {view === "main" && (
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Settings"
                  disabled={busy}
                  className="rounded-[10px] text-muted-foreground"
                  onClick={() => setView("settings")}
                >
                  <SettingsIcon className="size-4.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="Minimize"
                className="rounded-[10px] text-muted-foreground"
                onClick={() => void getCurrentWindow().minimize()}
              >
                <MinusIcon className="size-4.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="Close"
                className="rounded-[10px] text-muted-foreground hover:text-destructive"
                onClick={() => void getCurrentWindow().close()}
              >
                <XIcon className="size-4.5" />
              </Button>
            </>
          )}
        </div>
      </header>

      {status === "recording" ? null : status === "processing" ? (
        <div className="flex items-center gap-4 px-4.5 pb-4.5">
          <span className="flex size-14 items-center justify-center rounded-xl bg-card text-muted-foreground">
            <LoaderIcon className="size-5 animate-spin" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold">Converting to GIF…</span>
            <span className="text-[13.5px] text-muted-foreground">
              {settings.gifFps} fps · {gifSize(settings.gifWidth)}
            </span>
          </div>
          <span className="ml-auto text-[13.5px] text-muted-foreground">
            Opens the folder when done
          </span>
        </div>
      ) : view === "settings" ? (
        <SettingsPanel
          settings={settings}
          audioDevices={audioDevices}
          defaultDir={defaultDir}
          appVersion={appVersion}
          updateUrl={updateUrl}
          update={update}
        />
      ) : (
        <div className="flex flex-col gap-3.5 px-4.5 pb-4.5">
          {/* area ------------------------------------------------------- */}
          {/* The two actions sit on the size line — their labels live in the
              tooltip — so the display line below has the full width. */}
          <div className="flex items-center gap-4 rounded-[14px] bg-card p-4">
            <AreaThumb rect={rect} monitor={rectMonitor} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[22px] font-semibold tracking-tight whitespace-nowrap tabular-nums">
                  {rect ? `${rect.w} × ${rect.h}` : "No area selected"}
                </span>
                {/* 36 px keeps this line the height of the thumbnail. */}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-pressed={preview}
                    aria-label={preview ? "Hide frame" : "Show frame"}
                    className="group relative size-9 rounded-[10px] text-muted-foreground"
                    disabled={busy || !rect}
                    onClick={() => setPreview((p) => !p)}
                  >
                    {preview ? (
                      <EyeOffIcon className="size-4.5" />
                    ) : (
                      <EyeIcon className="size-4.5" />
                    )}
                    <Tip>{preview ? "Hide frame" : "Show frame"}</Tip>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label={rect ? "Change area" : "Select area"}
                    className="group relative size-9 rounded-[10px] text-muted-foreground"
                    disabled={busy}
                    onClick={() => {
                      // The ring would otherwise sit on top of the overlay.
                      setPreview(false);
                      void openOverlay();
                    }}
                  >
                    <CropIcon className="size-4.5" />
                    <Tip>{rect ? "Change area" : "Select area"}</Tip>
                  </Button>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {monitors.length > 0 && (
                  <Select
                    value={rectMonitor?.name ?? settings.monitorName}
                    onValueChange={selectMonitor}
                    disabled={busy}
                  >
                    {/* The display picker is the subline itself — no field chrome. */}
                    <SelectTrigger className="h-auto w-fit gap-1 rounded-md border-0 bg-transparent p-0 text-xs text-muted-foreground hover:text-foreground dark:bg-transparent dark:hover:bg-transparent">
                      <MonitorIcon className="size-3.5" />
                      <SelectValue
                        placeholder={monitors.length === 1 ? displayName(monitors[0].name) : "Select monitor"}
                      >
                        {displayName}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" className="w-auto min-w-60 p-1">
                      {monitors.map((m) => (
                        <SelectItem
                          key={m.name}
                          value={m.name}
                          className="gap-2 py-1.5 pr-8 pl-2 text-[13px] whitespace-nowrap"
                        >
                          {monitorLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <span className="truncate font-mono">
                  {rect ? `at ${rect.x}, ${rect.y}` : "No frame yet"}
                </span>
              </div>
            </div>
          </div>

          {/* format ----------------------------------------------------- */}
          <div className="flex gap-1 rounded-[14px] bg-foreground/6 p-1">
            <FormatChip
              icon={<VideoIcon />}
              label="Video"
              active={settings.format === "mp4"}
              disabled={busy}
              onClick={() => update({ format: "mp4" })}
            />
            <FormatChip
              icon={<FilmIcon />}
              label="GIF"
              active={settings.format === "gif"}
              disabled={busy}
              onClick={() => update({ format: "gif" })}
            />
            <FormatChip
              icon={<ImageIcon />}
              label="PNG"
              active={isPng}
              disabled={busy}
              onClick={() => update({ format: "png" })}
            />
          </div>

          {/* meta ------------------------------------------------------- */}
          <div className="flex h-11 items-center gap-2.5 rounded-[10px] bg-foreground/3 px-3.5 text-[13px] text-muted-foreground">
            <button
              type="button"
              onClick={() => void openPath(outLabel).catch(() => toast.error("Folder does not exist yet"))}
              className="group relative flex min-w-0 items-center gap-2.5 outline-none hover:text-foreground focus-visible:text-foreground"
            >
              <FolderIcon className="size-4 shrink-0" />
              <span className="truncate">{outLabel}</span>
              <Tip>{outLabel}</Tip>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <MetaToggle
                on={settings.systemAudio}
                label={settings.systemAudio ? "System audio" : "No system audio"}
                icon={settings.systemAudio ? <Volume2Icon /> : <VolumeOffIcon />}
                disabled={busy || isPng}
                onClick={() => update({ systemAudio: !settings.systemAudio })}
              />
              <MetaToggle
                on={settings.audioDevices.length > 0}
                label={micLabel}
                icon={settings.audioDevices.length > 0 ? <MicIcon /> : <MicOffIcon />}
                disabled={busy || isPng || audioDevices.length === 0}
                onClick={toggleMics}
              />
            </div>
          </div>

          {/* record ----------------------------------------------------- */}
          <Button
            className="h-16 w-full gap-3 rounded-[14px] text-[19px] font-semibold tracking-tight"
            disabled={!rect}
            onClick={toggle}
          >
            <span className="size-3.5 rounded-full bg-destructive" />
            {isPng ? "Take screenshot" : "Start recording"}
          </Button>

          <Links appVersion={appVersion} updateUrl={updateUrl} />
        </div>
      )}
      </>
      )}

      <Toaster position="top-center" richColors />
    </main>
  );
}

/** Project and support links — the same footer under both views. */
function Links({
  appVersion,
  updateUrl,
  className,
}: {
  appVersion: string;
  updateUrl: string | null;
  className?: string;
}) {
  // px-3.5 matches the meta bar, so the icons line up with the ones above.
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3.5 text-[13px] text-muted-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => void openUrl(REPO_URL)}
          className="group relative flex min-w-0 items-center gap-2.5 rounded-[10px] outline-none hover:text-foreground focus-visible:text-foreground"
        >
          <GithubMark className="size-4 shrink-0" />
          <span className="truncate">rbox{appVersion && ` · v${appVersion}`}</span>
          <Tip>GitHub</Tip>
        </button>
        {updateUrl && (
          <button
            type="button"
            aria-label="Update available"
            onClick={() => void openUrl(updateUrl)}
            className="group relative flex shrink-0 items-center text-emerald-500 outline-none hover:text-emerald-400 focus-visible:text-emerald-400"
          >
            <ArrowUpCircleIcon className="size-4" />
            <Tip>Update available</Tip>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => void openUrl(KOFI_URL)}
        className="group relative flex shrink-0 items-center gap-2.5 rounded-[10px] outline-none hover:text-foreground focus-visible:text-foreground"
      >
        <CoffeeIcon className="size-4" />
        Buy me a coffee
        <Tip>Ko-fi</Tip>
      </button>
    </div>
  );
}

/**
 * Hover label in the app's own style. Beats `title`: no second, delayed OS
 * tooltip, and it floats out of flow so no row changes width. Put it inside a
 * button carrying `group relative`.
 */
function Tip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-md ring-1 ring-foreground/10 group-hover:block group-focus-visible:block">
      {children}
    </span>
  );
}

/** "\\.\DISPLAY1" → "DISPLAY1". The full name stays the key; this is only for show. */
function displayName(name: string): string {
  return name.replace(/^\\\\\.\\/, "");
}

/** Display name with its resolution, the same in the list and the trigger. */
function monitorLabel(m: MonitorInfo): string {
  return `${displayName(m.name)} · ${m.w}×${m.h}`;
}

/**
 * Meta-bar toggle: the icon carries the state, the name only appears while the
 * button is hovered or focused, so two of them fit next to the output path.
 */
function MetaToggle({
  on,
  label,
  icon,
  disabled,
  onClick,
}: {
  on: boolean;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex h-8 items-center rounded-lg px-2 outline-none transition-colors hover:text-foreground focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        on ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      <Tip>{label}</Tip>
    </button>
  );
}

/** True-proportion preview of the selection inside its monitor. */
function AreaThumb({ rect, monitor }: { rect: Rect | null; monitor: MonitorInfo | null }) {
  const frame =
    rect && monitor
      ? {
          left: `${((rect.x - monitor.x) / monitor.w) * 100}%`,
          top: `${((rect.y - monitor.y) / monitor.h) * 100}%`,
          width: `${(rect.w / monitor.w) * 100}%`,
          height: `${(rect.h / monitor.h) * 100}%`,
        }
      : { left: "12%", top: "18%", width: "66%", height: "64%" };
  return (
    <div className="relative h-16.5 w-28 shrink-0 overflow-hidden rounded-lg bg-linear-to-br from-[#2b3245] to-[#171b24]">
      {/* The monitor surface is inset from the tile: a selection flush with the
          screen edge would otherwise have its own rounded corners shaved off by
          the tile's rounded clip. */}
      <div className="absolute inset-1">
        <div
          className={
            rect
              ? "absolute rounded-[3px] border-2 border-foreground bg-foreground/10"
              : "absolute rounded-[3px] border-2 border-dashed border-foreground/40"
          }
          style={frame}
        />
      </div>
    </div>
  );
}

function FormatChip({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4.5 [&_svg]:shrink-0",
        active
          ? "bg-foreground font-semibold text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Small uppercase heading over a settings group. */
function Group({ children }: { children: string }) {
  return (
    <h2 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground/80 uppercase">
      {children}
    </h2>
  );
}

/** One setting: label over its control, or with `inline` label left, control right. */
function Field({
  label,
  sub,
  inline,
  children,
}: {
  label: string;
  sub?: string;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={inline ? "flex items-center justify-between gap-3" : "flex flex-col gap-1.5"}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        {sub && <span className="text-[11px] text-muted-foreground/70">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Fixed choices plus a custom slot at the end of the track: "…" until a value
 * is typed, then that value with a pencil. Clicking the slot selects the typed
 * value again, or edits it when it is already selected.
 */
function FpsPicker({
  value,
  choices,
  max,
  disabled,
  onChange,
}: {
  value: number;
  choices: number[];
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  // Stays in its slot while a fixed choice is selected, one click away.
  const [custom, setCustom] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  // A value from storage or a preset that is no fixed choice lands in the slot.
  if (!choices.includes(value) && value !== custom) setCustom(value);
  const isCustom = value === custom;

  function finish(raw: string) {
    setEditing(false);
    // Empty or Esc: leave everything as it was.
    if (cancelled.current || raw === "") return;
    const n = Math.min(max, Math.max(1, Number.parseInt(raw, 10)));
    setCustom(choices.includes(n) ? null : n);
    onChange(n);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Segmented
        mono
        value={editing || isCustom ? Number.NaN : value}
        disabled={disabled}
        onChange={onChange}
        options={choices.map((f) => ({ value: f, label: String(f) }))}
      >
        {editing ? (
          <label
            className={cn(
              SEGMENT,
              "flex-[1.6] bg-background font-mono font-semibold ring-1 ring-foreground ring-inset",
            )}
          >
            <input
              autoFocus
              inputMode="numeric"
              defaultValue={custom ?? value}
              onFocus={(e) => {
                cancelled.current = false;
                e.currentTarget.select();
              }}
              onChange={(e) => {
                e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "");
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                const el = e.currentTarget;
                if (e.key === "Enter") el.blur();
                if (e.key === "Escape") {
                  cancelled.current = true;
                  el.blur();
                }
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const n = (Number.parseInt(el.value, 10) || 0) + (e.key === "ArrowUp" ? 1 : -1);
                  el.value = String(Math.min(max, Math.max(1, n)));
                }
              }}
              onBlur={(e) => finish(e.currentTarget.value)}
              className="w-[3ch] bg-transparent text-right outline-none"
            />
            <span className="font-normal text-muted-foreground">fps</span>
          </label>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-label="Custom frame rate"
            onClick={() => (custom === null || isCustom ? setEditing(true) : onChange(custom))}
            className={cn(
              SEGMENT,
              custom === null
                ? "outline-1 -outline-offset-2 outline-muted-foreground/40 outline-dashed"
                : "font-mono font-semibold tabular-nums",
              isCustom ? SEGMENT_ON : SEGMENT_OFF,
            )}
          >
            {custom ?? "…"}
            {custom !== null && <PencilIcon className="size-2.5" />}
          </button>
        )}
      </Segmented>
      {editing && <span className="text-[11px] text-muted-foreground/70">1–{max} fps</span>}
    </div>
  );
}

/**
 * Everything that is set once and then forgotten. Every change applies and
 * persists at once — the header only reports that it did.
 */
function SettingsPanel({
  settings,
  audioDevices,
  defaultDir,
  appVersion,
  updateUrl,
  update,
}: {
  settings: Settings;
  audioDevices: string[];
  defaultDir: string;
  appVersion: string;
  updateUrl: string | null;
  update: (patch: Partial<Settings>) => void;
}) {
  const dirLabel = settings.outDir ?? defaultDir;
  const isPng = settings.format === "png";
  // The Run key is the truth, not localStorage: Task Manager can remove it.
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    void autostartEnabled().then(setAutostart, () => {});
  }, []);

  async function toggleAutostart(on: boolean) {
    try {
      await (on ? enableAutostart() : disableAutostart());
      setAutostart(on);
    } catch (e) {
      toast.error("Could not change autostart", { description: String(e) });
    }
  }

  function toggleDevice(device: string, on: boolean) {
    update({
      audioDevices: on
        ? [...settings.audioDevices, device]
        : settings.audioDevices.filter((d) => d !== device),
    });
  }

  async function pickFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") update({ outDir: picked });
  }

  return (
    <>
      <div className="grid grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3.5 border-r px-5 py-4.5">
          <Group>Video</Group>
          <Field label="Frame rate">
            <FpsPicker
              value={settings.fps}
              choices={FPS_CHOICES}
              max={120}
              disabled={isPng}
              onChange={(v) => update({ fps: v })}
            />
          </Field>
          <Field label="Quality">
            <Segmented
              value={settings.quality}
              disabled={isPng}
              onChange={(v) => update({ quality: v as Settings["quality"] })}
              options={Object.entries(QUALITY_LABELS).map(([value, label]) => ({
                value: value as Settings["quality"],
                label,
              }))}
            />
          </Field>

          <div className="my-1 h-px bg-border" />
          <Group>GIF</Group>
          <Field label="Frame rate">
            {/* GIF frame delays are whole centiseconds; players clamp above 50. */}
            <FpsPicker
              value={settings.gifFps}
              choices={[10, 15, 20, 25]}
              max={50}
              onChange={(v) => update({ gifFps: v })}
            />
          </Field>
          <Field inline label="Width">
            <Select
              value={String(settings.gifWidth)}
              onValueChange={(v) => v && update({ gifWidth: Number(v) })}
            >
              <SelectTrigger size="sm" className="font-mono text-xs">
                <SelectValue>{(v: string) => gifSize(Number(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[320, 480, 640, 800, 1024, 0].map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {gifSize(w)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 px-5 py-4.5">
          <Group>Audio</Group>
          <Field inline label="System audio">
            <Switch
              checked={settings.systemAudio}
              onCheckedChange={(v) => update({ systemAudio: v })}
              disabled={isPng}
            />
          </Field>
          <Field inline label="Microphone">
            <DeviceSelect
              devices={audioDevices}
              selected={settings.audioDevices}
              onToggle={toggleDevice}
              disabled={isPng}
            />
          </Field>

          <div className="my-1 h-px bg-border" />
          <Group>System</Group>
          <Field label="Save to">
            <button
              type="button"
              title="Change folder"
              onClick={() => void pickFolder()}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-input px-2.5 py-1.5 font-mono text-xs text-foreground/75 transition-colors outline-none hover:bg-input/30 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate">{dirLabel}</span>
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </Field>
          <Field inline label="Print Screen key" sub="The Print key opens the area selection">
            <Switch
              checked={settings.printScreen}
              onCheckedChange={(v) => update({ printScreen: v })}
            />
          </Field>
          <Field inline label="Start with Windows" sub="Starts in the tray">
            <Switch checked={autostart} onCheckedChange={(v) => void toggleAutostart(v)} />
          </Field>
          <Field label="Delay" sub="Between confirming the area and capturing">
            <Segmented
              mono
              value={settings.delay}
              onChange={(v) => update({ delay: v })}
              options={DELAY_CHOICES.map((d) => ({ value: d, label: d ? `${d} s` : "Off" }))}
            />
          </Field>
        </div>
      </div>

      <Links
        appVersion={appVersion}
        updateUrl={updateUrl}
        className="border-t px-5 pt-3 pb-3.5 text-xs"
      />
    </>
  );
}
