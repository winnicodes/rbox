import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { virtualBounds } from "./geometry";
import { listMonitors } from "./monitors";
import type { Format } from "./settings";

/**
 * One overlay spanning the whole virtual desktop. Windows then renders it at a
 * single DPI, so the overlay's devicePixelRatio is the only scale factor its
 * math needs — which is what keeps mixed-scaling setups correct.
 *
 * `quick` is the Print Screen / tray flow: start blank and capture right away,
 * with this format preselected on the toolbar.
 */
export async function openOverlay(quick?: Format): Promise<void> {
  const existing = await WebviewWindow.getByLabel("overlay");
  if (existing) await existing.close();
  // A quick snip is about the screen, not the panel: out of the way, to the
  // tray. A recording brings it back as the bar.
  if (quick) await getCurrentWindow().hide();

  const bounds = virtualBounds(await listMonitors());

  const win = new WebviewWindow("overlay", {
    url: quick ? `overlay.html?quick=${quick}` : "overlay.html",
    title: "rbox region",
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    // Created hidden, then placed in physical pixels — the constructor's
    // x/y/width/height are logical and would be wrong under scaling.
    visible: false,
  });

  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });

  await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
  await win.setSize(new PhysicalSize(bounds.w, bounds.h));
  await win.show();
  // Without it, browsers behind the overlay think they are covered and stop
  // painting video. After show(), which rewrites the extended style.
  await invoke("tool_window", { label: "overlay" }).catch(() => {});
  await win.setFocus();
}
