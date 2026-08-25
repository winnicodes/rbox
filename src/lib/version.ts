/**
 * Is `candidate` a newer version than `current`? Both dotted and numeric, with
 * an optional `v` prefix so a GitHub tag can go in as it comes.
 *
 * A pre-release suffix ("0.2.0-rc1") reads as the plain number before it, which
 * is close enough for "is there something newer" — nobody is offered an update
 * to a build they already run.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);

  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
