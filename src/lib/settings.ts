import type { Rect } from "./geometry";
import type { Quality } from "./ffmpeg";

export type Format = "mp4" | "gif" | "png";

export type Settings = {
  rect: Rect | null;
  monitorName: string | null;
  fps: number;
  quality: Quality;
  format: Format;
  /** null = <Videos>/rbox */
  outDir: string | null;
  /** Selected microphones. System sound is `systemAudio`, not a device. */
  audioDevices: string[];
  /** Record what the machine plays, captured via WASAPI loopback. */
  systemAudio: boolean;
  gifFps: number;
  gifWidth: number;
  presets: Preset[];
  /** Name of the selected preset, or null. */
  activePreset: string | null;
};

/**
 * What a preset remembers: the settings for all three formats at once.
 * Deliberately not `format` itself — picking Video, GIF or Screenshot stays a
 * live choice, the preset only says how each of them records. Nor the region or
 * the monitor: those change per recording, a preset is the "how", not the
 * "where".
 */
export const PRESET_FIELDS = [
  "fps",
  "quality",
  "audioDevices",
  "systemAudio",
  "outDir",
  "gifFps",
  "gifWidth",
] as const;

export type PresetFields = Pick<Settings, (typeof PRESET_FIELDS)[number]>;

/**
 * A remembered recording area. Opt-in per preset: null means "leave whatever
 * area is currently selected alone", which is the right default for a preset
 * that only fixes how something records, not what.
 */
export type PresetArea = { rect: Rect; monitorName: string | null };

export type Preset = PresetFields & { name: string; area: PresetArea | null };

/** Same key order for settings and presets, so JSON compare tells them apart. */
export function presetFields(s: PresetFields): PresetFields {
  return Object.fromEntries(PRESET_FIELDS.map((k) => [k, s[k]])) as PresetFields;
}

export const DEFAULTS: Settings = {
  rect: null,
  monitorName: null,
  fps: 30,
  quality: "medium",
  format: "mp4",
  outDir: null,
  audioDevices: [],
  systemAudio: true,
  gifFps: 15,
  gifWidth: 640,
  presets: [],
  activePreset: null,
};

/**
 * The selected preset follows the settings live — picking one is the only save
 * step there is. Returns the preset list with the active one brought up to
 * date; a preset that remembers an area follows the region too.
 */
export function syncActivePreset(s: Settings): Preset[] {
  if (s.activePreset === null) return s.presets;
  const fields = presetFields(s);
  return s.presets.map((p) =>
    p.name !== s.activePreset
      ? p
      : {
          ...p,
          ...fields,
          area: p.area && s.rect ? { rect: s.rect, monitorName: s.monitorName } : p.area,
        },
  );
}

const KEY = "rbox.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    // Merge so a new setting added later does not read as undefined.
    const stored = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    return {
      ...stored,
      // A preset written before a field existed would apply it as undefined.
      presets: stored.presets.map((p) => ({ ...presetFields(DEFAULTS), ...p })),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage disabled or full — settings just do not persist.
  }
}
