import assert from "node:assert/strict";
import { test } from "node:test";
import { audioArgs } from "./ffmpeg.ts";

const sys = { port: 5001, format: "f32le", sampleRate: 48000, channels: 2 };

test("no audio maps the video only", () => {
  assert.deepEqual(audioArgs(null, []), { inputs: [], mapping: ["-map", "0:v"] });
});

test("a single source is mapped straight, without amix", () => {
  const { inputs, mapping } = audioArgs(sys, []);
  assert.deepEqual(inputs.slice(-2), ["-i", "tcp://127.0.0.1:5001"]);
  assert.deepEqual(mapping, ["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "128k"]);
});

test("system audio stays input 1, so mic indices do not shift", () => {
  const { inputs, mapping } = audioArgs(sys, ["Mic A", "Mic B"]);
  assert.ok(inputs.indexOf("tcp://127.0.0.1:5001") < inputs.indexOf("audio=Mic A"));
  assert.ok(mapping.includes("[1:a][2:a][3:a]amix=inputs=3:duration=first:normalize=0[a]"));
});

test("mics alone still mix", () => {
  const { mapping } = audioArgs(null, ["Mic A", "Mic B"]);
  assert.ok(mapping.includes("[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a]"));
});
