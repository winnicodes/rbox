import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import {
  ArrowDownUpIcon,
  CheckIcon,
  CircleIcon,
  FilmIcon,
  ImageIcon,
  LinkIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import NumberField from "@/components/NumberField";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import Tip from "@/components/Tip";
import { QUICK_CAPTURE, REGION_CANCELLED, REGION_PICKED } from "@/lib/events";
import { listMonitors } from "@/lib/monitors";
import { loadSettings, saveSettings, type Format } from "@/lib/settings";
import {
  centeredRect,
  clampRect,
  evenRect,
  monitorOfRect,
  physicalToCss,
  rectFromPoints,
  windowAt,
  type MonitorInfo,
  type Rect,
} from "@/lib/geometry";

/** Corners only — the edge handles were 10 px targets nobody hit on purpose. */
type Dir = "nw" | "ne" | "se" | "sw";
const DIRS: Dir[] = ["nw", "ne", "se", "sw"];

const CURSOR: Record<Dir, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "720p", w: 1280, h: 720 },
  { label: "1080p", w: 1920, h: 1080 },
  { label: "Square", w: 1080, h: 1080 },
];

const MIN = 16;
/** Gap between the selection edge and whatever hangs off it. */
const EDGE_GAP = 8;
/** First-paint guess; the real size is measured right after. */
const TOOLBAR_GUESS = { w: 640, h: 112 };

type Mode = "presets" | "numbers";

/** Opened by Print Screen or the tray: the toolbar captures instead of only
 * picking, starting on this format. */
const QUICK = new URLSearchParams(location.search).get("quick") as Format | null;

const QUICK_FORMATS: { format: Format; label: string; Icon: typeof ImageIcon }[] = [
  { format: "png", label: "Screenshot", Icon: ImageIcon },
  { format: "mp4", label: "Video", Icon: VideoIcon },
  { format: "gif", label: "GIF", Icon: FilmIcon },
];

type Drag =
  | { kind: "new"; anchor: { x: number; y: number } }
  | { kind: "move"; start: Rect; from: { x: number; y: number } }
  | { kind: "resize"; dir: Dir; start: Rect; from: { x: number; y: number } };

function resizeRect(start: Rect, dir: Dir, dx: number, dy: number, ratio: number | null): Rect {
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let { x, y, w, h } = start;

  if (dir.includes("w")) {
    x = start.x + dx;
    w = start.w - dx;
  }
  if (dir.includes("e")) w = start.w + dx;
  if (dir.includes("n")) {
    y = start.y + dy;
    h = start.h - dy;
  }
  if (dir.includes("s")) h = start.h + dy;

  // A drag past the opposite edge flips the rect instead of going negative.
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  w = Math.max(MIN, w);
  h = Math.max(MIN, h);

  if (ratio) {
    h = Math.max(MIN, Math.round(w / ratio));
    // Keep the edge the user is NOT dragging pinned in place.
    if (dir.includes("n")) y = bottom - h;
    if (dir.includes("w")) x = right - w;
  }

  return { x, y, w, h };
}

export default function Overlay() {
  /** The overlay window itself, in physical desktop pixels. Its corner is the
   * origin every CSS coordinate in here is measured from. */
  const [bounds, setBounds] = useState<Rect | null>(null);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  /**
   * The screen the user is actually looking at — the one the pointer was on
   * when the overlay opened. The overlay itself spans every monitor, so its
   * centre is the seam between them; anything meant to be seen goes here.
   */
  const [home, setHome] = useState<MonitorInfo | null>(null);
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mode, setMode] = useState<Mode>("presets");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState(TOOLBAR_GUESS);
  /** Ratio lock: w/h captured when the chain was closed. */
  const [ratio, setRatio] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  /** App windows to snap to, topmost first, taken when the overlay opened. */
  const [windows, setWindows] = useState<Rect[]>([]);
  /** The window under the pointer while nothing is selected. */
  const [hover, setHover] = useState<Rect | null>(null);
  /** Quick mode only. Print Screen always starts on Screenshot. */
  const [format, setFormat] = useState<Format>(QUICK ?? "png");

  useEffect(() => {
    (async () => {
      const win = getCurrentWindow();
      const [pos, size, mons, cursor, wins] = await Promise.all([
        win.outerPosition(),
        win.innerSize(),
        listMonitors(),
        // Physical pixels, same space as the monitors — no conversion needed.
        cursorPosition().catch(() => null),
        // Nothing moves behind the overlay, so one snapshot holds.
        invoke<[number, number, number, number][]>("list_windows").catch(() => []),
      ]);
      setWindows(wins.map(([x, y, w, h]) => ({ x, y, w, h })));

      // The window's real geometry is the ground truth, not what we asked for.
      const b: Rect = { x: pos.x, y: pos.y, w: size.width, h: size.height };
      setBounds(b);
      setMonitors(mons);
      setHome(cursor ? (monitorOfRect(mons, { x: cursor.x, y: cursor.y, w: 1, h: 1 }) ?? null) : null);
      setDpr(window.devicePixelRatio || 1);

      // Reopening the overlay picks up the saved region instead of starting
      // blank — "Change" is an edit, not a redraw. Redraw clears it on purpose.
      // Print Screen is a fresh snip, so it starts blank.
      const saved = QUICK ? null : loadSettings().rect;
      if (saved) {
        setRect(evenRect(clampRect(saved, b)));
        setMode("numbers");
      }

      await win.setFocus();
    })().catch((e) => setInitError(String(e)));
  }, []);

  const setClamped = useCallback(
    (r: Rect) => {
      if (!bounds) return;
      setRect(evenRect(clampRect(r, bounds)));
    },
    [bounds],
  );

  /** Pointer position (CSS px in this window) -> physical desktop px. */
  const toPhys = useCallback(
    (e: { clientX: number; clientY: number }) => ({
      x: Math.round((bounds?.x ?? 0) + e.clientX * dpr),
      y: Math.round((bounds?.y ?? 0) + e.clientY * dpr),
    }),
    [bounds, dpr],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      const p = toPhys(e);
      if (!d) {
        const w = windowAt(windows, monitors, p.x, p.y);
        setHover((prev) => (JSON.stringify(prev) === JSON.stringify(w) ? prev : w));
        return;
      }
      if (d.kind === "new") {
        let r = rectFromPoints(d.anchor.x, d.anchor.y, p.x, p.y);
        if (ratio) r = { ...r, h: Math.max(MIN, Math.round(r.w / ratio)) };
        setClamped(r);
      } else if (d.kind === "move") {
        setClamped({
          ...d.start,
          x: d.start.x + (p.x - d.from.x),
          y: d.start.y + (p.y - d.from.y),
        });
      } else {
        setClamped(resizeRect(d.start, d.dir, p.x - d.from.x, p.y - d.from.y, ratio));
      }
    }
    function onUp(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setDragging(false);
      // A click rather than a drag: take the window under it.
      if (d.kind !== "new") return;
      const p = toPhys(e);
      if (Math.hypot(p.x - d.anchor.x, p.y - d.anchor.y) > 4 * dpr) return;
      const w = windowAt(windows, monitors, d.anchor.x, d.anchor.y);
      if (w) setRect(evenRect(w));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [toPhys, setClamped, ratio, windows, monitors, dpr]);

  const cancel = useCallback(async () => {
    await emitTo("main", REGION_CANCELLED, null);
    await getCurrentWindow().close();
  }, []);

  const confirm = useCallback(async () => {
    if (!rect) return cancel();
    const final = evenRect(rect);
    saveSettings({ ...loadSettings(), rect: final, monitorName: null });
    const win = getCurrentWindow();
    if (QUICK) {
      // Off screen before main captures, or the dimmer ends up in the shot.
      await win.hide();
      await emitTo("main", QUICK_CAPTURE, { rect: final, format });
    } else {
      await emitTo("main", REGION_PICKED, final);
    }
    await win.close();
  }, [rect, cancel, format]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void confirm();
        return;
      }
      if (!rect || !e.key.startsWith("Arrow")) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      // Alt turns the nudge into a resize of the bottom/right edges.
      if (e.altKey) {
        const w = Math.max(MIN, rect.w + dx);
        setClamped({ ...rect, w, h: ratio ? Math.round(w / ratio) : Math.max(MIN, rect.h + dy) });
      } else setClamped({ ...rect, x: rect.x + dx, y: rect.y + dy });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rect, setClamped, cancel, confirm, ratio]);

  // Measured, not hard-coded: the toolbar changes size with the mode and with
  // the height of NumberField. `bounds` is in the deps because nothing renders
  // before it is known, so the first run finds no toolbar to observe.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setToolbar({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, rect === null, bounds === null]);

  // A transparent window that renders nothing is invisible, so a failed init
  // would look like "the overlay never opened". Say so instead.
  if (initError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-8">
        <pre className="max-w-3xl whitespace-pre-wrap rounded-md bg-zinc-900 p-4 text-sm text-red-300 ring-1 ring-red-500/40">
          {`${t("The overlay could not start:")}\n${initError}`}
        </pre>
      </div>
    );
  }

  if (!bounds) return null;

  const css = rect ? physicalToCss(rect, bounds, dpr) : null;
  const viewW = bounds.w / dpr;
  const viewH = bounds.h / dpr;
  // Hints belong on one screen, not spread across the whole virtual desktop —
  // its centre falls between the monitors. Falls back to the full overlay when
  // the pointer's monitor is unknown (single screen, or cursorPosition failed).
  const hintBox = home ? physicalToCss(home, bounds, dpr) : { x: 0, y: 0, w: viewW, h: viewH };

  // Toolbar hangs off the selection, under it by default and flipped above when
  // it would leave the screen. Its size is measured rather than hard-coded —
  // it changes with the mode and with the field heights.
  const toolbarBelow = css ? css.y + css.h + EDGE_GAP + toolbar.h <= viewH : true;
  const toolbarTop = css
    ? toolbarBelow
      ? css.y + css.h + EDGE_GAP
      : Math.max(4, css.y - toolbar.h - EDGE_GAP)
    : // No selection yet: top centre of the screen, like the Snipping Tool's
      // bar, so it does not sit on what is about to be framed.
      hintBox.y + EDGE_GAP;
  const toolbarLeft = css
    ? Math.min(Math.max(4, css.x), Math.max(4, viewW - toolbar.w - 4))
    : hintBox.x + (hintBox.w - toolbar.w) / 2;

  function setW(w: number) {
    if (!rect) return;
    setClamped(ratio ? { ...rect, w, h: Math.round(w / ratio) } : { ...rect, w });
  }
  function setH(h: number) {
    if (!rect) return;
    setClamped(ratio ? { ...rect, h, w: Math.round(h * ratio) } : { ...rect, h });
  }
  function swap() {
    if (!rect) return;
    setClamped({ ...rect, w: rect.h, h: rect.w });
    if (ratio) setRatio(rect.h / rect.w);
  }
  function toggleLock() {
    if (ratio) setRatio(null);
    else if (rect) setRatio(rect.w / rect.h);
  }
  /** The monitor the selection sits on, or the one the pointer came from. */
  function currentMonitor() {
    if (rect) return monitorOfRect(monitors, rect);
    // Without `home` this would fall back to the top-left corner of the virtual
    // desktop, i.e. the leftmost screen rather than the one being used.
    return home ?? monitorOfRect(monitors, { ...bounds!, w: 1, h: 1 });
  }
  function applyPreset(w: number, h: number) {
    // An existing frame keeps its top-left corner and only changes size; it
    // shifts only where it would run off the desktop. Without one: centred.
    const mon = currentMonitor();
    if (rect) setClamped({ ...rect, w, h });
    else if (mon) setClamped(centeredRect(w, h, mon));
    if (ratio) setRatio(w / h);
  }
  function fullScreen() {
    const mon = currentMonitor();
    if (mon) setClamped({ x: mon.x, y: mon.y, w: mon.w, h: mon.h });
  }

  // The overlay has no theme tokens of its own, so the keyboard ring is spelled
  // out here rather than reusing the app's ring colour.
  const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-white/70";
  const chip = cn(
    "relative flex h-11 items-center gap-2 rounded-[10px] px-4 text-[15px] whitespace-nowrap text-zinc-400 transition-colors hover:text-zinc-50",
    focusRing,
  );
  const chipOn = cn(chip, "bg-white/10 font-semibold text-zinc-50");
  // Icon-only chips; their names live in a Tip and aria-label.
  const icon = cn(chip, "h-10 w-10 justify-center px-0");
  const iconOn = cn(chipOn, "h-10 w-10 justify-center px-0");
  // Size presets and the number fields share one look: a 2x2 block of pills.
  const cell = cn(
    "flex h-6.5 items-center justify-center rounded-md bg-white/6 px-2.5 text-xs whitespace-nowrap text-zinc-300 transition-colors hover:bg-white/12 hover:text-zinc-50",
    focusRing,
  );
  const tiny = cn(
    "relative flex size-6.5 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:text-zinc-200",
    focusRing,
  );

  return (
    <div
      className="fixed inset-0"
      style={{ cursor: rect ? "default" : "crosshair" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { kind: "new", anchor: toPhys(e) };
        setDragging(true);
        setRect(null);
      }}
    >
      {/* Four dimmers instead of an SVG mask: the hole stays truly see-through. */}
      {css ? (
        <>
          <div className="absolute right-0 left-0 bg-black/50" style={{ top: 0, height: Math.max(0, css.y) }} />
          <div className="absolute right-0 left-0 bg-black/50" style={{ top: css.y + css.h, bottom: 0 }} />
          <div className="absolute bg-black/50" style={{ top: css.y, height: css.h, left: 0, width: Math.max(0, css.x) }} />
          <div className="absolute bg-black/50" style={{ top: css.y, height: css.h, left: css.x + css.w, right: 0 }} />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/50" />
      )}

      {/* Click to take this window; drag to draw a frame as before. */}
      {!rect && !dragging && hover && (() => {
        const h = physicalToCss(hover, bounds, dpr);
        return (
          <div
            className="pointer-events-none absolute bg-white/10 outline-2 -outline-offset-2 outline-white/80"
            style={{ left: h.x, top: h.y, width: h.w, height: h.h }}
          />
        );
      })()}

      {/* toolbar ---------------------------------------------------------
          z-20: the selection is rendered after this and would otherwise sit on
          top, swallowing clicks meant for the fields whenever the toolbar
          overlaps the selected area. */}
      <div
        ref={toolbarRef}
        className="absolute z-20 flex items-center gap-1.5 rounded-[14px] bg-zinc-900/95 p-2 shadow-[0_20px_40px_-12px_rgba(0,0,0,.7)] ring-1 ring-white/10"
        style={{ left: toolbarLeft, top: toolbarTop }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Presets and numbers share one grid cell; the hidden one keeps its
            size, so switching never resizes the bar. */}
        <div className="grid">
          {/* Filled column by column: 720p over 1080p, Square over Full screen. */}
          <div
            className={cn(
              "col-start-1 row-start-1 grid grid-flow-col grid-cols-2 grid-rows-2 gap-x-1 gap-y-2",
              mode !== "presets" && "invisible",
            )}
          >
            {SIZE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.w, p.h)}
                className={cn(cell, rect && rect.w === p.w && rect.h === p.h && "bg-white/15 font-semibold text-zinc-50")}
              >
                {t(p.label)}
              </button>
            ))}
            <button type="button" onClick={fullScreen} className={cell}>
              {t("Full screen")}
            </button>
          </div>
          <div className={cn("col-start-1 row-start-1 flex items-center gap-1", mode !== "numbers" && "invisible")}>
            <div className="flex flex-col gap-2">
              <NumberField label="X" value={rect?.x ?? 0} onChange={(x) => rect && setClamped({ ...rect, x })} />
              <NumberField label="Y" value={rect?.y ?? 0} onChange={(y) => rect && setClamped({ ...rect, y })} />
            </div>

            {/* The bracket runs out sideways from the middle: short vertical on
                the outside, long arm toward the fields, gap in the middle where
                the icon sits. `items-stretch` spans it over both fields. */}
            <div className="flex items-stretch">
              <button
                type="button"
                aria-label={t("Swap width and height")}
                onClick={swap}
                className={cn(
                  "relative z-10 -mr-3 flex size-6 shrink-0 items-center justify-center self-center rounded text-zinc-500 hover:text-zinc-300",
                  focusRing,
                )}
              >
                <ArrowDownUpIcon className="size-3.5" />
                <Tip>{t("Swap width and height")}</Tip>
              </button>
              <Bracket side="left" on={ratio !== null} />
              <div className="flex flex-col gap-2">
                <NumberField label="W" value={rect?.w ?? 0} step={2} onChange={setW} />
                <NumberField label="H" value={rect?.h ?? 0} step={2} onChange={setH} />
              </div>
              <Bracket side="right" on={ratio !== null} />
              <button
                type="button"
                aria-label={ratio ? t("Unlock aspect ratio") : t("Lock aspect ratio")}
                aria-pressed={ratio !== null}
                onClick={toggleLock}
                className={cn(
                  "relative z-10 -ml-3 flex size-6 shrink-0 items-center justify-center self-center rounded",
                  ratio ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-300",
                  focusRing,
                )}
              >
                <LinkIcon className="size-3.5" />
                <Tip>{ratio ? t("Unlock aspect ratio") : t("Lock aspect ratio")}</Tip>
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label={mode === "numbers" ? t("Size presets") : t("Exact numbers")}
          onClick={() => setMode(mode === "numbers" ? "presets" : "numbers")}
          className={tiny}
        >
          {mode === "numbers" ? <ToggleRightIcon className="size-4.5" /> : <ToggleLeftIcon className="size-4.5" />}
          <Tip>{mode === "numbers" ? t("Size presets") : t("Exact numbers")}</Tip>
        </button>

        <span className="mx-1 w-px self-stretch bg-white/15" />
        {QUICK &&
          QUICK_FORMATS.map((f) => (
            <button
              key={f.format}
              type="button"
              aria-label={t(f.label)}
              aria-pressed={format === f.format}
              onClick={() => setFormat(f.format)}
              className={format === f.format ? iconOn : icon}
            >
              <f.Icon className="size-4.25" />
              <Tip>{t(f.label)}</Tip>
            </button>
          ))}
        <button
          type="button"
          disabled={!rect}
          onClick={() => void confirm()}
          className={cn(
            "flex h-10 items-center gap-2 rounded-[10px] bg-white px-4 text-sm font-semibold whitespace-nowrap text-zinc-900 hover:bg-zinc-200 disabled:opacity-40",
            focusRing,
          )}
        >
          {QUICK ? (
            <>
              <CircleIcon className="size-3.5 fill-red-500 text-red-500" />
              {format === "png" ? t("Capture") : t("Record")}
            </>
          ) : (
            <>
              <CheckIcon className="size-4.25" />
              {t("Use area")}
            </>
          )}
        </button>
        <button type="button" aria-label={t("Cancel")} onClick={() => void cancel()} className={icon}>
          <XIcon className="size-4.25" />
          <Tip>{t("Cancel (Esc)")}</Tip>
        </button>
      </div>

      {!rect && !dragging && (
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={{ left: hintBox.x, top: hintBox.y, width: hintBox.w, height: hintBox.h }}
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-xl font-semibold text-white">
              {t("Drag a frame or click a window")}
            </span>
            <span className="text-sm text-white/60">{t("Esc cancels · Enter confirms")}</span>
          </div>
        </div>
      )}

      {/* selection ------------------------------------------------------- */}
      {css && (
        <div
          className="absolute z-10 outline-2 outline-white"
          style={{ left: css.x, top: css.y, width: css.w, height: css.h, cursor: "move" }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button !== 0 || !rect) return;
            drag.current = { kind: "move", start: rect, from: toPhys(e) };
            setDragging(true);
          }}
        >
          {DIRS.map((dir) => (
            <div
              key={dir}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0 || !rect) return;
                drag.current = { kind: "resize", dir, start: rect, from: toPhys(e) };
                setDragging(true);
              }}
              className="absolute size-3.5 rounded bg-white"
              style={{
                cursor: CURSOR[dir],
                left: dir.includes("w") ? -7 : "calc(100% - 7px)",
                top: dir.includes("n") ? -7 : "calc(100% - 7px)",
              }}
            />
          ))}

          {dragging && (
            <div className="pointer-events-none absolute top-2 left-2 flex h-7.5 items-center rounded-lg bg-black/70 px-2.5 text-[13px] font-semibold tabular-nums text-white">
              {rect!.w} × {rect!.h}
            </div>
          )}
        </div>
      )}

      <div
        className="pointer-events-none absolute flex justify-center text-[13px] text-white/55"
        style={{
          left: hintBox.x,
          width: hintBox.w,
          // 14 px above that monitor's bottom edge, not the desktop's.
          bottom: viewH - (hintBox.y + hintBox.h) + 14,
        }}
      >
        {t("Arrow keys nudge · Shift for 10 px · Esc cancels")}
      </div>
    </div>
  );
}

/**
 * The ratio bracket. Shape, from the outside in: a short vertical on the outer
 * edge, a long arm running toward the fields, and a gap across the middle where
 * the swap / chain icon sits. Height comes from the parent, so the arms land on
 * the real top and bottom of the W/H pair.
 */
function Bracket({ side, on }: { side: "left" | "right"; on: boolean }) {
  const color = on ? "border-white/60" : "border-white/25";
  const edge = side === "left" ? "border-l-2" : "border-r-2";
  // 6 px, not rounded-lg: the vertical stub is only 9 px tall and a larger
  // radius would curve all of it away.
  const top = side === "left" ? "rounded-tl-[6px]" : "rounded-tr-[6px]";
  const bottom = side === "left" ? "rounded-bl-[6px]" : "rounded-br-[6px]";
  return (
    <div className="flex w-7 shrink-0 flex-col self-stretch">
      {/* Half a NumberField (h-6.5), so the top arm starts level with the
          middle of the W field instead of its top edge. */}
      <div className="h-3.25 shrink-0" />
      <div className={`h-2.25 shrink-0 border-t-2 ${edge} ${top} ${color}`} />
      <div className="flex-1" />
      <div className={`h-2.25 shrink-0 border-b-2 ${edge} ${bottom} ${color}`} />
      {/* Mirror of the top inset: the bottom arm ends level with the middle of
          the H field. */}
      <div className="h-3.25 shrink-0" />
    </div>
  );
}
