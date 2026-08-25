import { availableMonitors, primaryMonitor } from "@tauri-apps/api/window";
import type { MonitorInfo } from "./geometry";

/**
 * Tauri reports monitor position/size in physical pixels already — that is the
 * space gdigrab works in, so we keep it and never convert here.
 */
export async function listMonitors(): Promise<MonitorInfo[]> {
  const [all, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
  return all.map((m, i) => ({
    name: m.name || (m.position.x === primary?.position.x && m.position.y === primary?.position.y
      ? "Primary"
      : `Display ${i + 1}`),
    x: m.position.x,
    y: m.position.y,
    w: m.size.width,
    h: m.size.height,
    scale: m.scaleFactor,
  }));
}
