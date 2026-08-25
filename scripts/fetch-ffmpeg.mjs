// Downloads a static ffmpeg build and installs it as a Tauri sidecar.
// Sidecar filenames must end in the Rust target triple or Tauri reports
// "program not found" at runtime.
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, copyFile, access } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";

const URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

const root = path.resolve(import.meta.dirname, "..");
const binDir = path.join(root, "src-tauri", "binaries");

function targetTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const m = out.match(/^host:\s*(\S+)$/m);
  if (!m) throw new Error("could not read host triple from `rustc -vV`");
  return m[1];
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (process.platform !== "win32") {
    console.log("[fetch-ffmpeg] not Windows, skipping");
    return;
  }

  const triple = targetTriple();
  const dest = path.join(binDir, `ffmpeg-${triple}.exe`);

  if (await exists(dest)) {
    console.log(`[fetch-ffmpeg] already present: ${dest}`);
    return;
  }

  await mkdir(binDir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `rbox-ffmpeg-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const zip = path.join(tmp, "ffmpeg.zip");

  console.log(`[fetch-ffmpeg] downloading ${URL}`);
  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

  console.log("[fetch-ffmpeg] extracting");
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`],
    { stdio: "inherit" },
  );

  // Zip contains one top-level folder, e.g. ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe
  const entries = await readdir(tmp, { withFileTypes: true });
  const folder = entries.find((e) => e.isDirectory() && e.name.startsWith("ffmpeg"));
  if (!folder) throw new Error("unexpected archive layout: no ffmpeg-* folder");

  await copyFile(path.join(tmp, folder.name, "bin", "ffmpeg.exe"), dest);
  await rm(tmp, { recursive: true, force: true });

  console.log(`[fetch-ffmpeg] installed ${dest}`);
}

main().catch((err) => {
  console.error(`[fetch-ffmpeg] ${err.message}`);
  process.exit(1);
});
