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
  startupRect,
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

// --- startupRect -----------------------------------------------------------

test("an area whose display is still there survives a restart untouched", () => {
  const r = { x: -1000, y: 200, w: 800, h: 600 };
  assert.deepEqual(startupRect(r, "left-hidpi", monitors), {
    rect: r,
    monitorName: "left-hidpi",
  });
});

test("a missing display gives up the position but keeps the size", () => {
  // The hidpi screen on the left is unplugged. Its old coordinates are negative
  // and would now point at nothing, so the area moves to the first monitor.
  const onlyPrimary = monitors.filter((m) => m.name === "primary");
  const { rect, monitorName } = startupRect(
    { x: -1000, y: 200, w: 800, h: 600 },
    "left-hidpi",
    onlyPrimary,
  );
  assert.equal(monitorName, "primary");
  assert.ok(rect);
  assert.equal(rect.w, 800);
  assert.equal(rect.h, 600);
  assert.deepEqual(rect, centeredRect(800, 600, onlyPrimary[0]));
});

test("an area larger than the first monitor is shrunk onto it", () => {
  const small: MonitorInfo[] = [{ name: "small", x: 0, y: 0, w: 1280, h: 720, scale: 1 }];
  const { rect } = startupRect({ x: -1000, y: 0, w: 2560, h: 1440 }, "left-hidpi", small);
  assert.deepEqual(rect, { x: 0, y: 0, w: 1280, h: 720 });
});

test("a known display whose area drifted off screen still moves to the first", () => {
  // Same monitor name, but the layout shrank underneath it.
  const shrunk: MonitorInfo[] = [{ name: "primary", x: 0, y: 0, w: 1920, h: 1080, scale: 1 }];
  const { rect, monitorName } = startupRect({ x: 4000, y: 0, w: 400, h: 300 }, "primary", shrunk);
  assert.equal(monitorName, "primary");
  assert.ok(rect);
  // Clamped back on, not centred — the display it names is still present.
  assert.ok(rect.x + rect.w <= 1920);
});

test("no monitor list means unknown, so nothing is moved", () => {
  const r = { x: 10, y: 10, w: 100, h: 100 };
  assert.deepEqual(startupRect(r, "gone", []), { rect: r, monitorName: "gone" });
});

test("with nothing remembered the first monitor is the one selected", () => {
  // The picker derives its value from the area, so without one there has to be
  // a name to fall back on, or it opens showing no selection at all.
  assert.deepEqual(startupRect(null, null, monitors), {
    rect: null,
    monitorName: "primary",
  });
});

test("a remembered area without a monitor name gets the one it sits on", () => {
  const r = { x: -1000, y: 200, w: 800, h: 600 };
  assert.deepEqual(startupRect(r, null, monitors), {
    rect: r,
    monitorName: "left-hidpi",
  });
});

test("no monitors and no area leaves both alone", () => {
  assert.deepEqual(startupRect(null, null, []), { rect: null, monitorName: null });
});
