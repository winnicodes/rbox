import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { cursorPosition } from "@tauri-apps/api/window";
import type { Rect } from "./geometry";

const LABEL = "frame";

/** Ring thickness in CSS px — must match the `border` in frame.html. */
const BORDER_CSS = 3;

/**
 * A click-through red ring marking the region while it records.
 *
 * The window is grown by the border thickness on every side and the ring is
 * drawn in that margin, so the ring sits strictly OUTSIDE the captured
 * rectangle and never ends up in the recording. `scale` is the scale factor of
 * the monitor holding the region: the ring is sized in CSS pixels, the window
 * in physical ones, and without it the ring would bleed into the region on a
 * scaled display.
 */
export async function showFrame(
  rect: Rect,
  scale = 1,
  extra?: { count?: number },
): Promise<void> {
  await hideFrame();

  const border = Math.max(1, Math.round(BORDER_CSS * scale));

  const win = new WebviewWindow(LABEL, {
    // count: a countdown inside the region, so the caller must hide it
    // before capturing.
    url: `frame.html?${new URLSearchParams(
      Object.entries(extra ?? {}).map(([k, v]) => [k, String(v)]),
    )}`,
    title: "rbox recording frame",
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    focus: false,
    visible: false,
  });

  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });

  // Must not swallow clicks — the user keeps working inside the region.
  await win.setIgnoreCursorEvents(true);
  await win.setPosition(new PhysicalPosition(rect.x - border, rect.y - border));
  await win.setSize(new PhysicalSize(rect.w + 2 * border, rect.h + 2 * border));
  await win.show();
}

export async function hideFrame(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(LABEL);
  if (existing) await existing.close();
}

const SHOT_MENU = "shotbar";

/**
 * After a screenshot: an invisible 1 px window at the pointer whose page opens
 * the native Copy / Save / Save as / Open with menu (shotMenu.ts). A context
 * menu needs a foreground window to belong to, and the panel may be in the
 * tray. The choice comes back as SHOT_ACTION.
 */
export async function showShotMenu(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(SHOT_MENU);
  if (existing) await existing.close();

  const p = await cursorPosition();
  const win = new WebviewWindow(SHOT_MENU, {
    url: "frame.html?pick",
    title: "rbox screenshot",
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    visible: false,
  });

  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });

  await win.setPosition(new PhysicalPosition(p.x, p.y));
  await win.setSize(new PhysicalSize(1, 1));
  await win.show();
  await win.setFocus();
}
