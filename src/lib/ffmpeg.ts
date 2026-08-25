import { Command, type Child } from "@tauri-apps/plugin-shell";
import { remove } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { evenRect, type Rect } from "./geometry.ts";

const SIDECAR = "binaries/ffmpeg";

export type Quality = "low" | "medium" | "high";
const CRF: Record<Quality, string> = { low: "28", medium: "23", high: "18" };

export type RecordOptions = {
  rect: Rect;
  fps: number;
  quality: Quality;
  /** dshow microphone names; [] = no mic. */
  audioDevices: string[];
  /** Record what the machine is playing. Captured in Rust, see loopback.rs. */
  systemAudio: boolean;
  outPath: string;
};

/** What the Rust `system_audio_start` command hands back. */
export type SystemAudio = {
  port: number;
  format: string;
  sampleRate: number;
  channels: number;
};

export type Recording = {
  stop: () => Promise<void>;
};

function run(args: string[]) {
  return Command.sidecar(SIDECAR, args);
}

export async function ffmpegVersion(): Promise<string> {
  const { stdout } = await run(["-hide_banner", "-version"]).execute();
  return stdout.split("\n")[0]?.trim() ?? "unknown";
}

/**
 * `-list_devices` exits non-zero and writes to stderr — that is normal, not a
 * failure. These are microphones plus whatever loopback devices happen to be
 * installed; system audio itself no longer comes from here but from the WASAPI
 * capture in Rust, which needs nothing installed.
 */
export async function listAudioDevices(): Promise<string[]> {
  const { stderr } = await run(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"]).execute();
  const names: string[] = [];
  for (const line of stderr.split("\n")) {
    const m = line.match(/"([^"]+)"\s*\(audio\)/);
    if (m) names.push(m[1]);
  }
  return [...new Set(names)];
}

function captureArgs(rect: Rect, fps?: number): string[] {
  const r = evenRect(rect);
  return [
    "-f", "gdigrab",
    ...(fps ? ["-framerate", String(fps)] : []),
    "-offset_x", String(r.x),
    "-offset_y", String(r.y),
    "-video_size", `${r.w}x${r.h}`,
    "-i", "desktop",
  ];
}

/**
 * Video is always input 0. System audio, when on, takes input 1, so mic indices
 * stay predictable however many devices are selected.
 */
export function audioArgs(
  system: SystemAudio | null,
  devices: string[],
): { inputs: string[]; mapping: string[] } {
  const inputs = [
    ...(system
      ? [
          "-f", system.format,
          "-ar", String(system.sampleRate),
          "-ac", String(system.channels),
          "-i", `tcp://127.0.0.1:${system.port}`,
        ]
      : []),
    ...devices.flatMap((d) => ["-f", "dshow", "-i", `audio=${d}`]),
  ];

  const count = (system ? 1 : 0) + devices.length;
  if (count === 0) return { inputs, mapping: ["-map", "0:v"] };
  if (count === 1) {
    return { inputs, mapping: ["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "128k"] };
  }
  const labels = Array.from({ length: count }, (_, i) => `[${i + 1}:a]`).join("");
  return {
    inputs,
    mapping: [
      "-filter_complex", `${labels}amix=inputs=${count}:duration=first:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]",
      "-c:a", "aac", "-b:a", "128k",
    ],
  };
}

export async function startRecording(opts: RecordOptions): Promise<Recording> {
  // Started first: ffmpeg blocks until the socket accepts its connection.
  const system = opts.systemAudio ? await invoke<SystemAudio>("system_audio_start") : null;
  const stopSystem = () => {
    if (system) void invoke("system_audio_stop").catch(() => {});
  };

  const { inputs, mapping } = audioArgs(system, opts.audioDevices);
  const cmd = run([
    "-hide_banner",
    ...captureArgs(opts.rect, opts.fps),
    ...inputs,
    ...mapping,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", CRF[opts.quality],
    "-pix_fmt", "yuv420p",
    // gdigrab timestamps drift; forcing CFR keeps long recordings in sync.
    "-fps_mode", "cfr",
    "-r", String(opts.fps),
    "-movflags", "+faststart",
    "-y",
    opts.outPath,
  ]);

  // Kept only so a non-zero exit can quote why. Bounded: a long recording
  // writes a progress line per second.
  const log: string[] = [];
  cmd.stderr.on("data", (line: string) => {
    log.push(line);
    if (log.length > 400) log.shift();
  });

  let exited = false;
  let exitCode: number | null = null;
  cmd.on("close", (payload: { code: number | null }) => {
    exited = true;
    exitCode = payload.code;
  });

  let child: Child;
  try {
    child = await cmd.spawn();
  } catch (e) {
    stopSystem();
    throw e;
  }

  const stopFfmpeg = async () => {
    if (exited) return;
    // Killing ffmpeg leaves the mp4 container unfinalized and unplayable.
    // "q" on stdin makes it write the moov atom and exit cleanly.
    try {
      await child.write("q");
    } catch {
      await child.kill();
      return;
    }
    const deadline = Date.now() + 3000;
    while (!exited && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!exited) await child.kill();
    if (exitCode !== null && exitCode !== 0) {
      throw new Error(`ffmpeg exited with ${exitCode}: ${log.slice(-6).join(" ")}`);
    }
  };

  return {
    async stop() {
      // ffmpeg first — it stops reading the socket, then the capture can go.
      try {
        await stopFfmpeg();
      } finally {
        stopSystem();
      }
    },
  };
}

export async function screenshot(rect: Rect, outPath: string): Promise<void> {
  const { code, stderr } = await run([
    "-hide_banner",
    ...captureArgs(rect),
    "-frames:v", "1",
    // image2 needs -update for a single non-sequence filename.
    "-update", "1",
    "-y",
    outPath,
  ]).execute();
  if (code !== 0) throw new Error(`screenshot failed: ${lastError(stderr)}`);
}

/**
 * Two passes: build an optimal palette, then apply it. A single pass produces
 * visibly worse GIFs for the same size.
 */
export async function toGif(
  mp4Path: string,
  outPath: string,
  palettePath: string,
  fps = 15,
  width = 640,
): Promise<void> {
  const filter = `fps=${fps},scale=${width}:-1:flags=lanczos`;

  const pass1 = await run([
    "-hide_banner", "-i", mp4Path, "-vf", `${filter},palettegen=stats_mode=diff`, "-update", "1", "-y", palettePath,
  ]).execute();
  if (pass1.code !== 0) throw new Error(`palettegen failed: ${lastError(pass1.stderr)}`);

  const pass2 = await run([
    "-hide_banner", "-i", mp4Path, "-i", palettePath,
    "-lavfi", `${filter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    "-y", outPath,
  ]).execute();

  await remove(palettePath).catch(() => {});
  if (pass2.code !== 0) throw new Error(`paletteuse failed: ${lastError(pass2.stderr)}`);
}

function lastError(stderr: string): string {
  const lines = stderr.trim().split("\n").filter(Boolean);
  return lines.slice(-3).join(" ").trim() || "unknown ffmpeg error";
}
