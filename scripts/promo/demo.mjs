// Renders docs/media/demo.gif and demo.mp4 from the real overlay: a frame is
// dragged open around a stand-in window, then cleared, and the same window is
// taken with one click - it lights up under the pointer. Last, the format is
// switched to Video.
//
//   npx vite                                  # dev server on :1420
//   node <browser-automation>/browser.mjs http://localhost:1420/scripts/promo/overlay.html \
//     --script scripts/promo/demo.mjs
//
// OUT=<dir> writes elsewhere.
import { recorder } from "./frames.mjs";

const PAGE = "http://localhost:1420/scripts/promo/overlay.html?quick=png&cursor";
const OUT = process.env.OUT ?? "docs/media";

export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(PAGE);
  await page.waitForTimeout(800);

  const r = recorder(page, "scripts/promo/.shots/demo", { x: 1000, y: 600 });
  await page.mouse.move(1000, 600);
  await r.hold(6);

  // 1. Drag: around the stand-in window (31.25% / 30.5% / 37.5% x 37% of the
  //    viewport), which mock.ts also reports from list_windows.
  await r.glide({ x: 394, y: 214 }, 10);
  await page.mouse.down();
  await r.glide({ x: 886, y: 488 }, 22);
  await page.mouse.up();
  await r.hold(14);

  // 2. Click: on empty desktop clears the frame, then onto the window, which
  //    lights up, and a click takes it exactly.
  await r.glide({ x: 1130, y: 140 }, 10);
  await page.mouse.down();
  await page.mouse.up();
  await r.hold(4);
  await r.glide({ x: 700, y: 330 }, 14);
  await r.hold(10);
  await page.mouse.down();
  await page.mouse.up();
  await r.hold(12);

  await r.clickOn(page.getByRole("button", { name: "Video", exact: true }), 10);
  await r.hold(18);

  r.encode(`${OUT}/demo`, { mp4: true });
  return { frames: r.frames(), out: OUT };
}
