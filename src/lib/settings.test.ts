import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULTS,
  PRESET_FIELDS,
  presetFields,
  syncActivePreset,
  type Preset,
} from "./settings.ts";

const preset: Preset = {
  name: "Discord",
  fps: 15,
  quality: "low",
  audioDevices: ["Mikrofon"],
  systemAudio: false,
  outDir: "D:/clips",
  gifFps: 10,
  gifWidth: 480,
  area: null,
};

test("presetFields picks exactly the preset keys, dropping the name", () => {
  assert.deepEqual(Object.keys(presetFields(preset)), [...PRESET_FIELDS]);
});

test("key order matches between settings and presets", () => {
  // The dirty check is a JSON string compare, so a differing key order would
  // report every preset as modified.
  assert.deepEqual(Object.keys(presetFields(DEFAULTS)), Object.keys(presetFields(preset)));
});

test("applying a preset makes the settings compare equal to it", () => {
  const applied = { ...DEFAULTS, ...presetFields(preset) };
  assert.equal(
    JSON.stringify(presetFields(applied)),
    JSON.stringify(presetFields(preset)),
  );
});

test("a changed field is detected as modified", () => {
  const applied = { ...DEFAULTS, ...presetFields(preset), fps: 60 };
  assert.notEqual(
    JSON.stringify(presetFields(applied)),
    JSON.stringify(presetFields(preset)),
  );
});

test("region, monitor and format stay out of presets", () => {
  const keys = Object.keys(presetFields(DEFAULTS));
  assert.ok(!keys.includes("rect"));
  assert.ok(!keys.includes("monitorName"));
  // A preset carries the settings for all three formats; which one you record
  // stays a live choice, so applying a preset must not switch it.
  assert.ok(!keys.includes("format"));
});

test("applying a preset leaves the chosen format alone", () => {
  const settings = { ...DEFAULTS, format: "png" as const };
  const applied = { ...settings, ...presetFields(preset) };
  assert.equal(applied.format, "png");
});

test("changing a setting writes straight into the selected preset", () => {
  const s = { ...DEFAULTS, presets: [preset], activePreset: preset.name, fps: 60 };
  assert.equal(syncActivePreset(s)[0].fps, 60);
  // Nothing is selected: no preset may be touched.
  assert.deepEqual(syncActivePreset({ ...s, activePreset: null }), [preset]);
});

test("only a preset that remembers an area follows the region", () => {
  const rect = { x: 0, y: 0, w: 800, h: 600 };
  const s = { ...DEFAULTS, presets: [preset], activePreset: preset.name, rect };
  assert.equal(syncActivePreset(s)[0].area, null);

  const remembering = { ...preset, area: { rect: { x: 9, y: 9, w: 1, h: 1 }, monitorName: "A" } };
  const s2 = { ...s, presets: [remembering], monitorName: "B" };
  assert.deepEqual(syncActivePreset(s2)[0].area, { rect, monitorName: "B" });
});

test("presetFields ignores the remembered area", () => {
  // `area` lives on the preset, not in the mirrored settings fields — otherwise
  // applying a preset would always drag the region along.
  const withArea: Preset = {
    ...preset,
    area: { rect: { x: 0, y: 0, w: 800, h: 600 }, monitorName: "A" },
  };
  assert.deepEqual(presetFields(withArea), presetFields(preset));
});
