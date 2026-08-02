# The druk extension market

Every folder here is an extension. druk fetches `index.json` from this directory on
`main` and installs an extension by fetching `<id>/extension.json` — so **a merged pull
request is live for everyone**, without waiting for a druk release.

An extension is JSON and nothing else. Installing one runs no code, and druk validates
a manifest before it writes it.

## Two kinds, never both

An extension is either a **language** or an **appearance**. The check is enforced:

| Kind | Fields | What it adds |
| --- | --- | --- |
| language | `languages`, `languageServers` | Syntax highlighting for a language, and the server that serves it. |
| appearance | `themes`, `icons` | Colour schemes and file-icon sets. |

The two are installed for different reasons and change on different schedules, so a
Go extension that also repaints the editor is refused rather than half-registered.

## A language extension

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
  `src/languages/grammars.ts`). Nothing to download: installing the extension fetches
  one small JSON. Every language extension in this folder uses this.
- `{ "bundled": true }` — a grammar OpenTUI carries: javascript, typescript,
  markdown, zig.
- `{ "wasm": "…", "query": "…" }` — files **in your extension's folder**, fetched on
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

## An appearance extension

`themes` needs every `ui` key `src/themes/types.ts` declares, all `#rrggbb`; copy a
published palette verbatim and cite it in `description`, as the shipped ones do.
`icons` maps names, extensions and folders to a **single-cell** glyph — a two-cell
one is dropped rather than drawn, since the tree gives an icon the arrow's column.

## Adding one

1. Make a folder named after the extension id — lowercase, `[\w.-]+`, and the same as
   the manifest's `id`. It is the URL druk fetches and the folder it installs into.
2. Write `extension.json`. Start at `"version": "1.0.0"`.
3. Run `bun run extensions` to regenerate `index.json`, and `bun run check`.
4. Open a pull request.

To change an extension, edit its manifest and **bump `version`** — that is the only
thing that makes installed copies notice. druk compares semver, so `1.0.1` is an
update and `1.0.0` re-published is not.

## Preinstalled extensions

A few of these ship inside the binary, so a fresh druk highlights code with no
network: typescript, json, markdown, html, css, yaml and toml. The list is
`src/extensions/builtin.ts`, and a preinstalled extension may carry no assets — it is
parsed without a folder, so a relative path would resolve to nothing. Installing
the market's copy of one replaces the built-in, which is how it gets an update.

## Testing yours before it is merged

Drop the folder straight into `$XDG_CONFIG_HOME/druk/extensions/` (usually
`~/.config/druk/extensions/`) and press `r` in the extensions panel.
That path needs no registry at all, which is why `extensionRegistry` is only worth
changing when you are serving a whole fork.

## What the tests enforce

`test/extensions-repo.test.ts` fails the build if a manifest is one druk would reject,
if `index.json` is stale, if an extension mixes the two kinds, if two extensions claim the
same language, theme, icon or server id — and, for themes, if `currentLine` or
`indentGuide` sit far enough from `bg` to read as a block rather than a hint.

Note for palette families: druk's palette matches a query in order, so a flavor
whose name is a prefix of another's search hits comes first in `themes`. Catppuccin
lists Mocha before Macchiato for that reason.
