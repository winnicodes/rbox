// Renders the README promo images from the real UI.
//
//   npx vite                                  # dev server on :1420
//   node <browser-automation>/browser.mjs http://localhost:1420/scripts/promo/promo.html \
//     --script scripts/promo/shoot.mjs
//
// Writes docs/media/rbox-promo-2.png and rbox-promo-3.png (1920x1080).
// OUT=<dir> writes there instead, to review before replacing.
const BASE = "http://localhost:1420/scripts/promo/";
const OUT = process.env.OUT ?? "docs/media";

export default async function run(page) {
  await page.setViewportSize({ width: 1920, height: 1080 });

  // The quick overlay with a frame dragged over the stand-in app window.
  // promo 3 shows a crop of it.
  await page.goto(`${BASE}overlay.html?quick=png`);
  await page.waitForTimeout(800);
  await page.mouse.move(600, 330);
  await page.mouse.down();
  await page.mouse.move(1320, 730, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "scripts/promo/.shots/overlay.png" });

  await page.goto(`${BASE}promo.html?n=2`);
  await page.waitForSelector("[data-win=settings] button[aria-label=Settings]");
  await page.click("[data-win=settings] button[aria-label=Settings]");
  await page.click('[data-win=rec] button:has-text("Start recording")');
  // Clicks scroll the fixed-size page; put it back.
  await page.evaluate(() => document.querySelectorAll("*").forEach((el) => (el.scrollTop = 0)));
  // Let the timer run to a believable 00:12.
  await page.waitForSelector('[data-win=rec] :text("00:12")', { timeout: 20_000 });
  await page.screenshot({ path: `${OUT}/rbox-promo-2.png` });

  await page.goto(`${BASE}promo.html?n=3`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/rbox-promo-3.png` });

  return { out: OUT };
}
