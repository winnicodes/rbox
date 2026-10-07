// Stands in for the Tauri backend so the real UI renders in a plain browser.
// Only what the promo pages touch is answered; everything else returns null.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

/** One display the size of the page, so the overlay's hints centre on it. */
const MONITOR = {
  name: "\\\\.\\DISPLAY1",
  position: { x: 0, y: 0 },
  size: { width: innerWidth, height: innerHeight },
  scaleFactor: 1,
  workArea: { position: { x: 0, y: 0 }, size: { width: innerWidth, height: innerHeight } },
};

const SETTINGS = {
  rect: { x: 320, y: 180, w: 1280, h: 720 },
  monitorName: MONITOR.name,
  format: "mp4",
  fps: 30,
  quality: "medium",
  systemAudio: true,
  audioDevices: ["Microphone (USB Audio)"],
  printScreen: true,
  delay: 3,
};

export function installMocks(label: string) {
  localStorage.setItem("rbox.settings", JSON.stringify(SETTINGS));
  mockWindows(label);
  mockIPC(
    (cmd, args) => {
      const a = args as Record<string, unknown> | undefined;
      switch (cmd) {
        case "plugin:app|version":
          return "0.2.0";
        case "plugin:path|resolve_directory":
          return "C:\\Users\\you\\Videos";
        case "plugin:path|join":
          return (a?.paths as string[]).join("\\");
        case "plugin:fs|exists":
          return true;
        case "plugin:shell|execute":
          return {
            code: 0,
            signal: null,
            stdout: "ffmpeg version 7.1",
            stderr: '"Microphone (USB Audio)" (audio)\n',
          };
        case "plugin:shell|spawn":
          return 4242;
        case "plugin:window|available_monitors":
          return [MONITOR];
        case "plugin:window|primary_monitor":
          return MONITOR;
        case "plugin:window|outer_position":
          return { x: 0, y: 0 };
        case "plugin:window|inner_size":
          return { width: innerWidth, height: innerHeight };
        case "plugin:window|cursor_position":
          return { x: 960, y: 540 };
        case "plugin:autostart|is_enabled":
          return true;
        case "plugin:menu|new":
          return [1, "menu"];
        case "free_space":
          return 500e9;
        case "system_audio_start":
          return { port: 5000, format: "f32le", sampleRate: 48000, channels: 2 };
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
