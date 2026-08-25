/** Ctrl+<key>: reload, print, find, view-source, save, zoom. */
const CTRL = new Set(["r", "p", "f", "g", "u", "s", "+", "-", "=", "0"]);
/** Ctrl+Shift+<key>: the devtools trio. Plain Ctrl+C stays copy. */
const CTRL_SHIFT = new Set(["i", "j", "c"]);

/**
 * The webview answers to browser shortcuts and its own context menu — reload,
 * devtools, print, find, zoom. None of that belongs in an app window, so it is
 * swallowed here.
 *
 * Left alive under `tauri dev`, where reload and devtools are the point; a
 * release build has no devtools compiled in either way.
 */
export function blockBrowserKeys(): void {
  // Capture, not bubble: an input that calls stopPropagation() — NumberField
  // does, to keep arrow keys out of the region nudge — would otherwise hand
  // reload and print back to the webview while it has focus.
  const capture = { capture: true } as const;

  window.addEventListener("contextmenu", (e) => e.preventDefault(), capture);
  if (import.meta.env.DEV) return;

  window.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();
      if (
        k === "f12" ||
        k === "f5" ||
        k === "f3" ||
        (e.ctrlKey && e.shiftKey && CTRL_SHIFT.has(k)) ||
        (e.ctrlKey && CTRL.has(k))
      ) {
        // preventDefault only — the app's own keydown handlers still run.
        e.preventDefault();
      }
    },
    capture,
  );
  // Ctrl+wheel zooms the whole window out of its measured layout.
  window.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), {
    passive: false,
    capture: true,
  });
}
