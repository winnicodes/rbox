import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const src = readdirSync("src", { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => readFileSync(`src/${f}`, "utf8"))
  .join("\n");
const keys = new Set([...src.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]) as string));
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

// Bundled files are templates for translators, so each has to be complete and current.
for (const file of readdirSync("lang").filter((f) => f.endsWith(".json"))) {
  const lang = JSON.parse(readFileSync(`lang/${file}`, "utf8"));

  test(`lang/${file} translates every t() key`, () => {
    assert.deepEqual([...keys].filter((k) => !lang.strings[k]), []);
  });

  // Labels kept in constants reach t() as variables, so a literal anywhere counts as used.
  test(`lang/${file} has no stale keys`, () => {
    assert.deepEqual(Object.keys(lang.strings).filter((k) => !src.includes(JSON.stringify(k))), []);
  });

  test(`lang/${file} is made for this version`, () => {
    assert.equal(lang.version, version);
  });
}
