// Renders docs/media/demo.gif and demo.mp4 from the real overlay: a frame is
// dragged open over a stand-in window, then the format is switched to Video.
//
//   npx vite                                  # dev server on :1420
//   node <browser-automation>/browser.mjs http://localhost:1420/scripts/promo/overlay.html \
//     --script scripts/promo/demo.mjs
//
// Frame by frame rather than a screen recording: every frame is a settled
// render, so the result is deterministic. OUT=<dir> writes elsewhere.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";

const PAGE = "http://localhost:1420/scripts/promo/overlay.html?quick=png&cursor";
const OUT = process.env.OUT ?? "docs/media";
const FRAMES = "scripts/promo/.shots/demo";
const FPS = 12.5; // GIF delays are whole centiseconds: 8 cs per frame.
const FFMPEG = `src-tauri/binaries/${readdirSync("src-tauri/binaries").find((f) => f.startsWith("ffmpeg"))}`;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default async function run(page) {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(PAGE);
  await page.waitForTimeout(800);

  let n = 0;
  let at = { x: 1000, y: 600 };
  const shot = () => page.screenshot({ path: `${FRAMES}/f${String(n++).padStart(3, "0")}.png` });
  const hold = async (frames) => {
    for (let i = 0; i < frames; i++) await shot();
  };
  const glide = async (to, frames) => {
    const from = at;
    for (let i = 1; i <= frames; i++) {
      const t = ease(i / frames);
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await shot();
    }
    at = to;
  };

  // Around the stand-in window (31.25% / 30.5% / 37.5% x 37% of the viewport).
  const start = { x: 394, y: 214 };
  const end = { x: 886, y: 488 };

  await page.mouse.move(at.x, at.y);
  await hold(6);
  await glide(start, 10);
  await page.mouse.down();
  await glide(end, 22);
  await page.mouse.up();
  await hold(12);

  const video = await page.getByRole("button", { name: "Video", exact: true }).boundingBox();
  await glide({ x: video.x + video.width / 2, y: video.y + video.height / 2 }, 10);
  await page.mouse.down();
  await page.mouse.up();
  await hold(18);

  const input = ["-framerate", String(FPS), "-i", `${FRAMES}/f%03d.png`];
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...input,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", `${OUT}/demo.mp4`]);
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...input,
    "-vf", "scale=820:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    `${OUT}/demo.gif`]);

  return { frames: n, out: OUT };
}
