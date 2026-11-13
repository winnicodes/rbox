import "@fontsource-variable/geist";
import { emit, emitTo, listen, once } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";

const LABEL = "tip";
const TIP = "rbox:tip";
const TIP_READY = "rbox:tip-ready";
/** Physical px: centre x, top edge when below, bottom edge when above, lowest usable y. */
type Msg = { text: string; x: number; below: number; above: number; maxY: number } | null;

/**
 * A tooltip that does not fit into its window (the one-row compact bar) goes
 * into a window of its own instead of growing the bar: transparent,
 * click-through, created on first use.
 *
 * It is shown once and stays shown, empty between tips. Every show() activates
 * a window on Windows (focusable: false does not stop it), which took focus
 * from the bar each time and made its drop shadow flicker.
 */
let created: Promise<void> | null = null;
/** The showing that owns the window. A hide for an older one is a no-op: moving
 * from one button to its neighbour hides A after B has already shown. */
let current = 0;

async function create(): Promise<void> {
  // One left over from before a reload (HMR, webview reload) holds the label;
  // its page never says ready again, so replace it.
  await (await WebviewWindow.getByLabel(LABEL))?.close();
  const ready = once(TIP_READY, () => {});
  const win = new WebviewWindow(LABEL, {
    url: "frame.html?tip",
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    focus: false,
    focusable: false,
    visible: false,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
  await win.setIgnoreCursorEvents(true);
  await ready;
  // The one show() there is; hand focus back if it was taken.
  const self = getCurrentWindow();
  const hadFocus = await self.isFocused();
  await win.show();
  if (hadFocus) await self.setFocus();
}

/**
 * Shows `text` under this window, centred on `anchor` (a rect in this window's
 * CSS pixels): under the anchor itself it would overlap the window's edge.
 * Above the window instead when the screen's bottom is in the way. Returns
 * the id to pass to hideTipWindow().
 */
export function showTipWindow(text: string, anchor: DOMRect): number {
  const mine = ++current;
  void (async () => {
    created ??= create().catch((e) => {
      created = null;
      throw e;
    });
    await created;
    const self = getCurrentWindow();
    const at = await self.innerPosition();
    const work = (await currentMonitor())?.workArea;
    // Hidden or replaced while the window was still being created.
    if (mine !== current) return;
    const gap = 6 * devicePixelRatio;
    const msg: Msg = {
      text,
      x: at.x + (anchor.left + anchor.width / 2) * devicePixelRatio,
      below: at.y + innerHeight * devicePixelRatio + gap,
      above: at.y - gap,
      maxY: work ? work.position.y + work.size.height : Infinity,
    };
    await emitTo(LABEL, TIP, msg);
  })().catch(() => {});
  return mine;
}

export function hideTipWindow(id: number): void {
  if (id !== current) return;
  current++;
  if (created) void emitTo(LABEL, TIP, null).catch(() => {});
}

/** Tip window size in CSS px: room for the widest pill (288 px) over a few lines. */
const BOX = { w: 300, h: 80 };

/**
 * The tip window's side (frame.html?tip). The window keeps one size, stays
 * shown and only moves; the pill is centred at its top by CSS and hidden
 * between tips. Resizing a visible transparent WebView2 window flashes.
 *
 * ponytail: sized once with this window's own scale; on a monitor with another
 * scale the box is a bit off, which only matters for very long tips.
 */
export async function runTipPage(): Promise<void> {
  const el = document.getElementById("msg")!;
  // Empty, it would still be a pill outline when the window is first shown.
  el.style.visibility = "hidden";
  const win = getCurrentWindow();
  const w = Math.ceil(BOX.w * devicePixelRatio);
  await win.setSize(new PhysicalSize(w, Math.ceil(BOX.h * devicePixelRatio)));
  let n = 0;
  await listen<Msg>(TIP, async (e) => {
    const mine = ++n;
    // The old text never shows at the new spot.
    el.style.visibility = "hidden";
    const m = e.payload;
    if (!m) return;
    el.textContent = m.text;
    const h = el.getBoundingClientRect().height * devicePixelRatio;
    const y = m.below + h > m.maxY ? m.above - h : m.below;
    // Back to the top of the topmost band: under the bar, the bar's drop
    // shadow would be drawn over the pill and grey it out. Re-setting the flag
    // re-sorts the window without activating it.
    await win.setAlwaysOnTop(false);
    await win.setAlwaysOnTop(true);
    await win.setPosition(new PhysicalPosition(Math.round(m.x - w / 2), Math.round(y)));
    if (mine !== n) return;
    el.style.visibility = "visible";
  });
  await emit(TIP_READY);
}
