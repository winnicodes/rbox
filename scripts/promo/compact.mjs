// Renders docs/media/compact.gif from the real panel: it shrinks to the
// compact bar and comes back.
//
//   npx vite                                  # dev server on :1420
//   node <browser-automation>/browser.mjs http://localhost:1420/scripts/promo/promo.html?n=compact \
//     --script scripts/promo/compact.mjs
//
// OUT=<dir> writes elsewhere.
import { recorder } from "./frames.mjs";

const PAGE = "http://localhost:1420/scripts/promo/promo.html?n=compact";
const OUT = process.env.OUT ?? "docs/media";

export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(PAGE);
  await page.waitForSelector("button[aria-label='Compact view']");
  await page.waitForTimeout(500);

  const r = recorder(page, "scripts/promo/.shots/compact", { x: 1150, y: 640 });
  await page.mouse.move(1150, 640);
  await r.hold(8);
  await r.clickOn(page.getByRole("button", { name: "Compact view" }), 16);
  await r.hold(22);
  await r.clickOn(page.getByRole("button", { name: "Full view" }), 14);
  await r.hold(18);

  r.encode(`${OUT}/compact`);
  return { frames: r.frames(), out: OUT };
}
