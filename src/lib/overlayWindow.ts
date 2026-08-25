import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { virtualBounds } from "./geometry";
import { listMonitors } from "./monitors";

/**
 * One overlay spanning the whole virtual desktop. Windows then renders it at a
 * single DPI, so the overlay's devicePixelRatio is the only scale factor its
 * math needs — which is what keeps mixed-scaling setups correct.
 */
export async function openOverlay(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("overlay");
  if (existing) await existing.close();

  const bounds = virtualBounds(await listMonitors());

  const win = new WebviewWindow("overlay", {
    url: "overlay.html",
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
  await win.setFocus();
}
