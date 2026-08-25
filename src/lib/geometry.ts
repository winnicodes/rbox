/**
 * All rectangles in rbox are PHYSICAL desktop pixels — the same coordinate
 * space gdigrab's -offset_x/-offset_y/-video_size expect. CSS pixels only ever
 * appear inside the overlay webview, which converts pointer positions on the
 * way in and the selection on the way out (physicalToCss). Do not mix the two
 * anywhere else.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type MonitorInfo = {
  name: string;
  /** physical desktop coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
};

/** Union of all monitors. Origin can be negative (monitor left of the primary). */
export function virtualBounds(monitors: MonitorInfo[]): Rect {
  if (monitors.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...monitors.map((m) => m.x));
  const y = Math.min(...monitors.map((m) => m.y));
  const right = Math.max(...monitors.map((m) => m.x + m.w));
  const bottom = Math.max(...monitors.map((m) => m.y + m.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * The overlay spans the whole virtual desktop, so Windows renders it at a
 * single DPI. `dpr` is that window's devicePixelRatio — using it (rather than
 * a per-monitor scale factor) keeps the math correct under mixed scaling.
 */
export function physicalToCss(phys: Rect, origin: { x: number; y: number }, dpr: number): Rect {
  return {
    x: (phys.x - origin.x) / dpr,
    y: (phys.y - origin.y) / dpr,
    w: phys.w / dpr,
    h: phys.h / dpr,
  };
}

/** Keep a rect fully inside `bounds`, shrinking it if it is larger. */
export function clampRect(r: Rect, bounds: Rect): Rect {
  const w = Math.min(r.w, bounds.w);
  const h = Math.min(r.h, bounds.h);
  return {
    x: Math.min(Math.max(r.x, bounds.x), bounds.x + bounds.w - w),
    y: Math.min(Math.max(r.y, bounds.y), bounds.y + bounds.h - h),
    w,
    h,
  };
}

/** libx264 with yuv420p rejects odd dimensions. Round down, floor at 2. */
export function evenRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.max(2, Math.floor(r.w / 2) * 2),
    h: Math.max(2, Math.floor(r.h / 2) * 2),
  };
}

/** Monitor holding the largest share of `r`; falls back to the first monitor. */
export function monitorOfRect(monitors: MonitorInfo[], r: Rect): MonitorInfo | undefined {
  let best: MonitorInfo | undefined;
  let bestArea = -1;
  for (const m of monitors) {
    const ow = Math.max(0, Math.min(r.x + r.w, m.x + m.w) - Math.max(r.x, m.x));
    const oh = Math.max(0, Math.min(r.y + r.h, m.y + m.h) - Math.max(r.y, m.y));
    const area = ow * oh;
    if (area > bestArea) {
      bestArea = area;
      best = m;
    }
  }
  return best ?? monitors[0];
}

export function centeredRect(w: number, h: number, m: MonitorInfo): Rect {
  return {
    x: Math.round(m.x + (m.w - w) / 2),
    y: Math.round(m.y + (m.h - h) / 2),
    w,
    h,
  };
}

/** Normalize a drag (start/end point) into a positive-size rect. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/**
 * Fits a remembered area to the displays that exist right now.
 *
 * A saved rect is absolute desktop coordinates, so unplugging a monitor or
 * rearranging the layout can leave it pointing at nothing. Returns the rect
 * clamped onto the current desktop, or null when none of it is on screen any
 * more — the caller then keeps whatever area is selected instead of silently
 * recording somewhere else.
 */
/**
 * The area and display the app should start on.
 *
 * A remembered area keeps its exact place for as long as that is possible —
 * that is the point of remembering it. Only when the display it lived on is
 * gone does the position get given up, and even then the size survives: the
 * area moves to the first screen instead of to wherever its old coordinates
 * happen to land now.
 *
 * With nothing remembered there is still a display to name, and it is the first
 * one. The picker would otherwise open on no selection at all.
 */
export function startupRect(
  r: Rect | null,
  monitorName: string | null,
  monitors: MonitorInfo[],
): { rect: Rect | null; monitorName: string | null } {
  // No monitor list means "unknown", so change nothing.
  if (monitors.length === 0) return { rect: r, monitorName };
  const first = monitors[0];
  if (!r) return { rect: null, monitorName: first.name };

  // A null name predates the monitor being recorded; judge it by geometry only.
  const sameScreen = monitorName === null || monitors.some((m) => m.name === monitorName);
  const fitted = sameScreen ? fitRectToMonitors(r, monitors) : null;
  // A name is filled in from the area itself, never from the first monitor —
  // that would label an area on the second screen with the first one's name.
  if (fitted) return { rect: fitted, monitorName: monitorName ?? monitorOfRect(monitors, fitted)?.name ?? null };

  return {
    rect: evenRect(centeredRect(Math.min(r.w, first.w), Math.min(r.h, first.h), first)),
    monitorName: first.name,
  };
}

export function fitRectToMonitors(r: Rect, monitors: MonitorInfo[]): Rect | null {
  // No monitor list means "unknown", not "no screens".
  if (monitors.length === 0) return r;
  const onScreen = monitors.some(
    (m) =>
      Math.min(r.x + r.w, m.x + m.w) > Math.max(r.x, m.x) &&
      Math.min(r.y + r.h, m.y + m.h) > Math.max(r.y, m.y),
  );
  return onScreen ? clampRect(r, virtualBounds(monitors)) : null;
}
