# The druk plugin market

Every folder here is a plugin. druk fetches `index.json` from this directory on
`main` and installs a plugin by fetching `<id>/plugin.json` — so **a merged pull
request is live for everyone**, without waiting for a druk release.

A plugin is JSON and nothing else. Installing one runs no code, and druk validates
a manifest before it writes it.

## Two kinds, never both

A plugin is either a **language** or an **appearance**. The check is enforced:

| Kind | Fields | What it adds |
| --- | --- | --- |
| language | `languages`, `languageServers` | Syntax highlighting for a language, and the server that serves it. |
| appearance | `themes`, `icons` | Colour schemes and file-icon sets. |

The two are installed for different reasons and change on different schedules, so a
Go plugin that also repaints the editor is refused rather than half-registered.

## A language plugin

```json
{
  "id": "nim",
  "name": "Nim",
  "version": "1.0.0",
  "description": "Nim highlighting and nimlangserver — shown in the market list, so make it searchable",
  "languages": [
    {
      "id": "nim",
      "label": "nim",
      "lineComment": "#",
      "grammar": { "wasm": "grammar.wasm", "query": "highlights.scm" },
      "extensions": [".nim", ".nims"]
    }
  ],
  "languageServers": [
    {
      "id": "nim",
      "command": ["nimlangserver"],
      "filetypes": ["nim"],
      "install": { "kind": "manual", "command": "nimble install nimlangserver" }
    }
  ]
}
```

`grammar` is one of three:

- `{ "vendored": "go" }` — a grammar druk already embeds (the keys are in
  `src/languages/grammars.ts`). Nothing to download: installing the plugin fetches
  one small JSON. Every language plugin in this folder uses this.
- `{ "bundled": true }` — a grammar OpenTUI carries: javascript, typescript,
  markdown, zig.
- `{ "wasm": "…", "query": "…" }` — files **in your plugin's folder**, fetched on
  install. This is the case for a language druk vendors no grammar for, and the
  only reason to commit a `.wasm` here. Paths are relative and may not escape the
  folder.

With no usable grammar, use `patterns` instead — the regex is a string, and later
entries win the characters they overlap:

```json
"patterns": [
  { "group": "keyword", "re": "\\b(?:proc|let|var)\\b", "flags": "g" },
  { "group": "comment", "re": "#.*$", "flags": "gm" }
]
```

`extensions`, `filenames` and `filenamePattern` claim names OpenTUI cannot resolve
(`.tf`, `bun.lock`, `.env.local`). Without one of them the patterns never run and
the file renders plain. `install` is `{"kind": "npm", "packages": [...]}` when druk
can fetch the server itself, `{"kind": "manual", "command": "..."}` for a line to
print, and absent for a server that arrives with an SDK.

## An appearance plugin

`themes` needs every `ui` key `src/themes/types.ts` declares, all `#rrggbb`; copy a
published palette verbatim and cite it in `description`, as the shipped ones do.
`icons` maps names, extensions and folders to a **single-cell** glyph — a two-cell
one is dropped rather than drawn, since the tree gives an icon the arrow's column.
A Nerd Font glyph counts as one cell wherever it sits, including the Material
Design Icons range above U+F0000; set `"patchedFont": true` on a theme that uses
one, which is what makes druk say so when the theme is picked.

A map's value is a glyph, `{ "glyph": "…", "color": "#rrggbb" }`, or the name of
an entry in `definitions` — which is how a set that gives four thousand names an
icon spells each icon out once:

```json
"icons": [{
  "id": "material",
  "patchedFont": true,
  "definitions": {
    "typescript": { "glyph": "󰛦", "color": "#0288d1" },
    "folder-src": { "glyph": "󰅩", "color": "#4caf50", "open": "󰝰" }
  },
  "extensions": { "ts": "typescript" },
  "folders": { "src": "folder-src" }
}]
```

`open` is the form a folder takes while it is expanded — a named folder needs one
or expansion stops being readable, the icon having taken the arrow's column.
`names` and `folders` are matched whole, `.gitignore` dot and all, while an
extension is written either way (`ts` and `.ts` are one key). A folder is looked
up under the plain name too, so `github` covers `.github`, `_github` and
`__github__` and a manifest lists it once.

## Adding one

1. Make a folder named after the plugin id — lowercase, `[\w.-]+`, and the same as
   the manifest's `id`. It is the URL druk fetches and the folder it installs into.
2. Write `plugin.json`. Start at `"version": "1.0.0"`.
3. Run `bun run plugins` to regenerate `index.json`, and `bun run check`.
4. Open a pull request.

To change a plugin, edit its manifest and **bump `version`** — that is the only
thing that makes installed copies notice. druk compares semver, so `1.0.1` is an
update and `1.0.0` re-published is not.

## Preinstalled plugins

A few of these ship inside the binary, so a fresh druk highlights code with no
network: typescript, json, markdown, html, css, yaml and toml. The list is
`src/plugins/builtin.ts`, and a preinstalled plugin may carry no assets — it is
parsed without a folder, so a relative path would resolve to nothing. Installing
the market's copy of one replaces the built-in, which is how it gets an update.

## Testing yours before it is merged

Drop the folder straight into `$XDG_CONFIG_HOME/druk/plugins/` (usually
`~/.config/druk/plugins/`) and run `Plugins → Reload plugins` from the palette.
That path needs no registry at all, which is why `pluginRegistry` is only worth
changing when you are serving a whole fork.

## What the tests enforce

`test/plugins-repo.test.ts` fails the build if a manifest is one druk would reject,
if `index.json` is stale, if a plugin mixes the two kinds, if two plugins claim the
same language, theme, icon or server id — and, for themes, if `currentLine` or
`indentGuide` sit far enough from `bg` to read as a block rather than a hint.

Note for palette families: druk's palette matches a query in order, so a flavor
whose name is a prefix of another's search hits comes first in `themes`. Catppuccin
lists Mocha before Macchiato for that reason.
