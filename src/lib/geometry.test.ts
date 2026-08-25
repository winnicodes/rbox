import assert from "node:assert/strict";
import { test } from "node:test";
import {
  centeredRect,
  clampRect,
  evenRect,
  fitRectToMonitors,
  monitorOfRect,
  physicalToCss,
  rectFromPoints,
  virtualBounds,
  type MonitorInfo,
} from "./geometry.ts";

// Primary at 100%, secondary to the LEFT at 150% — the layout that breaks
// naive coordinate math.
const monitors: MonitorInfo[] = [
  { name: "primary", x: 0, y: 0, w: 1920, h: 1080, scale: 1 },
  { name: "left-hidpi", x: -2560, y: 0, w: 2560, h: 1440, scale: 1.5 },
];

test("virtualBounds spans negative origins", () => {
  assert.deepEqual(virtualBounds(monitors), { x: -2560, y: 0, w: 4480, h: 1440 });
});

test("physicalToCss subtracts the overlay origin and divides by dpr", () => {
  // 100 CSS px into an overlay rendered at 1.5x, starting at desktop x=-2560
  const origin = { x: -2560, y: 0 };
  const css = physicalToCss({ x: -2410, y: 60, w: 300, h: 150 }, origin, 1.5);
  assert.deepEqual(css, { x: 100, y: 40, w: 200, h: 100 });
});

test("clampRect keeps rects inside bounds and shrinks oversized ones", () => {
  const bounds = virtualBounds(monitors);
  assert.deepEqual(clampRect({ x: -3000, y: -50, w: 100, h: 100 }, bounds), {
    x: -2560,
    y: 0,
    w: 100,
    h: 100,
  });
  assert.deepEqual(clampRect({ x: 4000, y: 1400, w: 800, h: 800 }, bounds), {
    x: 1120,
    y: 640,
    w: 800,
    h: 800,
  });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 99999, h: 99999 }, bounds), bounds);
});

test("evenRect floors odd dimensions to even, never below 2", () => {
  assert.deepEqual(evenRect({ x: 1.4, y: 2.6, w: 101, h: 99 }), { x: 1, y: 3, w: 100, h: 98 });
  assert.deepEqual(evenRect({ x: 0, y: 0, w: 1, h: 0 }), { x: 0, y: 0, w: 2, h: 2 });
});

test("monitorOfRect resolves negative coordinates", () => {
  // Straddling rect belongs to whichever monitor holds more of it.
  assert.equal(monitorOfRect(monitors, { x: -100, y: 0, w: 400, h: 100 })?.name, "primary");
  assert.equal(monitorOfRect(monitors, { x: -300, y: 0, w: 400, h: 100 })?.name, "left-hidpi");
});

test("centeredRect centers on the given monitor", () => {
  assert.deepEqual(centeredRect(1280, 720, monitors[1]), { x: -1920, y: 360, w: 1280, h: 720 });
});

test("rectFromPoints normalizes a backwards drag", () => {
  assert.deepEqual(rectFromPoints(300, 200, 100, 50), { x: 100, y: 50, w: 200, h: 150 });
});

// --- fitRectToMonitors -----------------------------------------------------

test("a remembered area that still fits comes back unchanged", () => {
  const r = { x: 100, y: 100, w: 800, h: 600 };
  assert.deepEqual(fitRectToMonitors(r, monitors), r);
});

test("an area hanging off the desktop is clamped back on", () => {
  const r = { x: 1800, y: 900, w: 800, h: 600 };
  const fitted = fitRectToMonitors(r, monitors);
  assert.ok(fitted);
  const bounds = virtualBounds(monitors);
  assert.ok(fitted.x + fitted.w <= bounds.x + bounds.w);
  assert.ok(fitted.y + fitted.h <= bounds.y + bounds.h);
});

test("an area whose monitor is gone reports back as unusable", () => {
  // The rect lived on the secondary that is no longer plugged in. Returning
  // null is what stops the app from recording a different part of the screen.
  const onlyPrimary = monitors.filter((m) => m.name === "primary");
  assert.equal(fitRectToMonitors({ x: -1000, y: 0, w: 400, h: 300 }, onlyPrimary), null);
});

test("an empty monitor list means unknown, not gone", () => {
  const r = { x: 10, y: 10, w: 100, h: 100 };
  assert.deepEqual(fitRectToMonitors(r, []), r);
});
