// Frame-by-frame recording for the promo animations: every frame is a settled
// render, so the result is deterministic. Shared by demo.mjs and compact.mjs.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";

export const FPS = 12.5; // GIF delays are whole centiseconds: 8 cs per frame.
const FFMPEG = `src-tauri/binaries/${readdirSync("src-tauri/binaries").find((f) => f.startsWith("ffmpeg"))}`;

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Collects frames of `page` into `dir`, with the pointer starting at `at`. */
export function recorder(page, dir, at) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = () => page.screenshot({ path: `${dir}/f${String(n++).padStart(3, "0")}.png` });
  const r = {
    hold: async (frames) => {
      for (let i = 0; i < frames; i++) await shot();
    },
    glide: async (to, frames) => {
      const from = at;
      for (let i = 1; i <= frames; i++) {
        const t = ease(i / frames);
        await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
        await shot();
      }
      at = to;
    },
    /** Glides onto the centre of an element and clicks it. */
    clickOn: async (locator, frames) => {
      const b = await locator.boundingBox();
      await r.glide({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, frames);
      await page.mouse.down();
      await page.mouse.up();
    },
    frames: () => n,
    /** Writes `<base>.gif`, and `<base>.mp4` with `mp4`. */
    encode: (base, { mp4 = false } = {}) => {
      const input = ["-framerate", String(FPS), "-i", `${dir}/f%03d.png`];
      const quiet = ["-hide_banner", "-loglevel", "error", "-y"];
      if (mp4) {
        execFileSync(FFMPEG, [...quiet, ...input,
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", `${base}.mp4`]);
      }
      execFileSync(FFMPEG, [...quiet, ...input,
        "-vf", "scale=820:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        `${base}.gif`]);
    },
  };
  return r;
}
