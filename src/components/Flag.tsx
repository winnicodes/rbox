import * as flags from "country-flag-icons/string/3x2";

/**
 * A country flag by ISO 3166-1 alpha-2 code ("DE", "GB"). Windows' emoji font
 * has no flags, so they come as SVG. Unknown code: an empty slot of the same
 * size, so names in a list stay aligned.
 *
 * ponytail: imports every flag (some 100 KB) for a handful of languages; split
 * per code with import.meta.glob if the bundle size ever matters.
 */
export default function Flag({ code }: { code?: string }) {
  const svg = code ? (flags as Record<string, string>)[code.toUpperCase()] : undefined;
  return svg ? (
    <img
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      alt=""
      className="h-3 w-4.5 shrink-0 rounded-[2px]"
    />
  ) : (
    <span className="h-3 w-4.5 shrink-0" />
  );
}
