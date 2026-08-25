import { join, videoDir, tempDir } from "@tauri-apps/api/path";
import { mkdir, exists } from "@tauri-apps/plugin-fs";
import type { Format } from "./settings";

export async function defaultOutDir(): Promise<string> {
  return join(await videoDir(), "rbox");
}

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Ensures the directory exists and returns a full, timestamped file path. */
export async function outputPath(dir: string | null, format: Format): Promise<string> {
  const target = dir ?? (await defaultOutDir());
  try {
    if (!(await exists(target))) await mkdir(target, { recursive: true });
  } catch {
    // Outside the fs plugin scope — a folder the user picked already exists,
    // and ffmpeg reports a clear error if it somehow does not.
  }
  return join(target, `rbox-${timestamp()}.${format}`);
}

export async function palettePath(): Promise<string> {
  return join(await tempDir(), `rbox-palette-${Date.now()}.png`);
}

/** GIF is encoded from a recorded mp4; that mp4 is scratch and gets deleted. */
export async function tempVideoPath(): Promise<string> {
  return join(await tempDir(), `rbox-src-${Date.now()}.mp4`);
}
