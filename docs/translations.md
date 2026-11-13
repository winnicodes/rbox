# Language files

rbox speaks English out of the box and ships German. Any other language is one
JSON file you drop into a folder - no rebuild, no install.

## Where they go

```
%APPDATA%\rbox\lang\
```

The quickest way there: **Settings → Language → Open folder**. rbox creates the
folder if it does not exist yet. Reopen the settings and the new language is in
the list.

## The format

One file per language. The file name (without `.json`) is the language's id,
for example `fr.json` or `zh-CN.json`.

```json
{
  "name": "Français",
  "version": "0.3.0",
  "flag": "FR",
  "strings": {
    "Start recording": "Démarrer l'enregistrement",
    "{n} mics": "{n} micros",
    "at {x}, {y}": "à {x}, {y}"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Shown in the language list. Write it in the language itself. |
| `version` | yes | The rbox version the strings were written for. See [Versions](#versions). |
| `flag` | no | ISO 3166-1 alpha-2 country code (`FR`, `CN`, `BR`), shown next to the name. Unknown or missing: no flag. |
| `strings` | yes | English text → translation. |

## Strings

- **The key is the English text**, exactly as rbox shows it, including
  punctuation and `…`.
- **Missing keys stay English.** A half-finished file works; translate the
  most visible strings first.
- **An empty value counts as missing**, so you can keep untranslated keys in
  the file as a to-do list.
- **Placeholders** in curly braces (`{n}`, `{size}`, `{x}`, `{name}`, `{v}`,
  `{file}`) are filled in by rbox. Keep them, move them wherever the sentence
  needs them.

## Start from a template

Copy [`lang/de.json`](../lang/de.json). It always contains every string of the
current version, so it doubles as the complete key list. Replace the German
values with yours.

## Versions

rbox compares `version` with its own version and says so under the info icon
next to **Language**:

- **Same version** - the file is complete for this rbox.
- **Older file** - newer rbox versions may have added strings; those show in
  English until the file is updated. Compare with the current `lang/de.json`
  to find them.
- **Newer file** - the file was made for a newer rbox; update rbox.

## Override a bundled language

A file with the id of a bundled language (`de.json`) wins over the built-in
one. Handy to fix a wording without waiting for a release.

## Broken files

A file that is not valid JSON or has no `strings` object shows up in the list
as `name.json (invalid)` and cannot be picked. Check it with any JSON
validator.

## Share it

Open a pull request that adds your file to [`lang/`](../lang/). Bundled files
are checked by `npm test`: every string present, no leftovers, `version` equal
to the app's.
