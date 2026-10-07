import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ClipboardCopyIcon,
  FolderOutputIcon,
  SaveIcon,
  SquareArrowOutUpRightIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { emitTo } from "@tauri-apps/api/event";
import { IconMenuItem, Menu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { SHOT_ACTION } from "./events";

const ITEMS: [string, string, LucideIcon][] = [
  ["copy", "Copy to clipboard", ClipboardCopyIcon],
  ["save", "Save", SaveIcon],
  ["saveas", "Save to…", FolderOutputIcon],
  ["open", "Save and open with…", SquareArrowOutUpRightIcon],
  ["close", "Close", XIcon],
];

/** Picks that get a short confirmation; the others open a dialog or do nothing. */
const CONFIRM: Record<string, string> = { copy: "Copied to clipboard", save: "Saved" };

/** Lucide icon as PNG bytes at menu-icon size. Mid grey reads on light and dark menus. */
export async function menuIcon(icon: LucideIcon): Promise<Uint8Array> {
  const px = Math.round(16 * devicePixelRatio);
  const svg = renderToStaticMarkup(createElement(icon, { size: px, color: "#808080" }));
  const img = new Image();
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = new OffscreenCanvas(px, px);
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/**
 * The native context menu after a screenshot, opened at the pointer from the
 * invisible shot window. The pick goes to main as SHOT_ACTION.
 *
 * ponytail: a dismissed menu leaves the 1 px window and the temp shot behind;
 * the next screenshot replaces both. Tauri reports no "menu closed" to act on.
 */
export async function popShotMenu(): Promise<void> {
  const win = getCurrentWindow();
  const choose = async (act: string) => {
    await emitTo("main", SHOT_ACTION, act);
    const text = CONFIRM[act];
    if (text) {
      // The 1 px window grows into a short confirmation where the menu was.
      const el = document.getElementById("msg")!;
      el.textContent = `✓ ${text}`;
      document.body.classList.add("confirm");
      const r = el.getBoundingClientRect();
      await win.setSize(new LogicalSize(Math.ceil(r.width), Math.ceil(r.height)));
      await new Promise((done) => setTimeout(done, 1000));
    }
    await win.close();
  };
  const items = await Promise.all(
    ITEMS.map(async ([id, text, icon]) =>
      IconMenuItem.new({ id, text, icon: await menuIcon(icon), action: () => void choose(id) }),
    ),
  );
  // Close sits apart, under a separator.
  const close = items.pop()!;
  const separator = await PredefinedMenuItem.new({ item: "Separator" });
  await (await Menu.new({ items: [...items, separator, close] })).popup();
}
