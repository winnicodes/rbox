import { dataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, mkdir, readDir, readTextFile } from "@tauri-apps/plugin-fs";

/**
 * A language file: `<id>.json` in `lang/` (bundled) or in `%APPDATA%\rbox\lang`
 * (user-supplied, wins over a bundled one with the same id). `version` is the
 * rbox version the strings were written for, `flag` an ISO 3166-1 alpha-2
 * country code for the picker.
 */
export type LangFile = { name: string; version: string; flag?: string; strings: Record<string, string> };
export type LangInfo =
  | { id: string; name: string; version: string; flag?: string }
  | { id: string; error: true };

/** Under %APPDATA%. Not the identifier folder: `rbox` is what users look for. */
const DIR = "rbox/lang";
const BUNDLED = Object.fromEntries(
  Object.entries(
    import.meta.glob<LangFile>("../../lang/*.json", { eager: true, import: "default" }),
  ).map(([path, file]) => [path.replace(/^.*\/|\.json$/g, ""), file]),
);

let dict: Record<string, string> = {};

/** The English text is the key; a missing translation stays English. `{name}` is filled from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  const s = dict[en] || en;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : s;
}

async function readLang(id: string): Promise<LangFile | null> {
  try {
    const f = JSON.parse(await readTextFile(`${DIR}/${id}.json`, { baseDir: BaseDirectory.Data }));
    if (typeof f?.strings === "object" && f.strings) return f as LangFile;
  } catch {
    // Missing or broken: the bundled one, if any.
  }
  return BUNDLED[id] ?? null;
}

/** Switches t() over. Every window calls this before its first render; null = English. */
export async function loadLanguage(id: string | null): Promise<void> {
  dict = (id && (await readLang(id))?.strings) || {};
}

/** Bundled and user languages. A user file that does not parse is listed with `error`. */
export async function listLanguages(): Promise<LangInfo[]> {
  const ids = new Set(Object.keys(BUNDLED));
  try {
    for (const e of await readDir(DIR, { baseDir: BaseDirectory.Data })) {
      if (e.isFile && e.name.endsWith(".json")) ids.add(e.name.slice(0, -5));
    }
  } catch {
    // No folder yet.
  }
  return Promise.all(
    [...ids].sort().map(async (id): Promise<LangInfo> => {
      const f = await readLang(id);
      return f ? { id, name: f.name || id, version: f.version || "", flag: f.flag } : { id, error: true };
    }),
  );
}

/** Where users drop language files; created on demand. */
export async function langDir(): Promise<string> {
  const dir = await join(await dataDir(), "rbox", "lang");
  await mkdir(dir, { recursive: true }).catch(() => {});
  return dir;
}
