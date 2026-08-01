/**
 * The market folder itself: every `extensions/<id>/extension.json` in this repository,
 * and the catalog generated from them.
 *
 * These extensions are what druk used to ship in `src/`, so the guarantees the
 * source files were held to have to hold here too — a palette that fails them
 * is as broken as it ever was, and nothing else would catch it now that no
 * TypeScript file names these colors.
 */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { buildIndex, INDEX_FILE, marketIds, readMarket } from '../scripts/extensions'
import { builtinExtensions } from '../src/extensions/builtin'

const market = readMarket()

const rgb = (hex: string) =>
  [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16))

const themes = market.flatMap(extension =>
  extension.themes.map(entry => ({ ...entry, from: extension.id })),
)

test('every manifest in the market is one druk can use', () => {
  // `readMarket` throws on a manifest with any problem at all, so reaching here
  // is most of the assertion; the count is what catches a folder that is not one.
  expect(market.map(extension => extension.id)).toEqual(marketIds())
  expect(market.every(extension => extension.version !== '0.0.0')).toBe(true)
  expect(market.every(extension => extension.description.length > 0)).toBe(true)
})

test('the committed index is what the generator writes', () => {
  // Without this, a merged extension whose author forgot `bun run extensions` would be
  // invisible in the market, or listed at the version before their change. The
  // comparison is on the parsed value, not the text: the index is JSON in the
  // repository, so the formatter owns its whitespace.
  expect(JSON.parse(readFileSync(INDEX_FILE, 'utf8'))).toEqual(buildIndex())
})

test('no two extensions claim the same id', () => {
  const claimed = [
    ...themes.map(theme => `theme:${theme.id}`),
    ...market.flatMap(extension => extension.icons.map(icons => `icons:${icons.id}`)),
    ...market.flatMap(extension => extension.servers.map(server => `server:${server.id}`)),
    // Two extensions claiming one language would make which of them highlights it
    // depend on load order, which is a folder listing — not a decision anyone
    // made. The same goes for the server that language spawns.
    ...market.flatMap(extension => extension.languages.map(language => `lang:${language.id}`)),
    ...market.flatMap(extension =>
      extension.servers.flatMap(server => `serves:${server.filetypes}`),
    ),
  ]
  expect(new Set(claimed).size).toBe(claimed.length)
})

test('an extension is about a language or about how the editor looks, never both', () => {
  for (const extension of market) {
    const appearance = extension.themes.length + extension.icons.length > 0
    const language = extension.languages.length + extension.servers.length > 0
    expect(`${extension.id}:${appearance && language}`).toBe(`${extension.id}:false`)
  }
})

test('every language has something to highlight with, and a way to be reached', () => {
  for (const extension of market) {
    for (const language of extension.languages) {
      const usable = language.bundled || (language.wasm && language.query) || language.patterns
      expect(`${language.id}:${usable ? 'ok' : 'unusable'}`).toBe(`${language.id}:ok`)
      // A grammar path only exists because `vendored` resolved: an asset-backed
      // grammar in this repository would be a wasm blob nobody wants here.
      if (language.wasm) expect(language.wasm.startsWith('/')).toBe(true)
    }
    expect(extension.assets).toEqual([])
  }
})

test('what ships in the binary is the market folder, and needs no files beside it', () => {
  const shipped = builtinExtensions()
  const ids = new Set(market.map(extension => extension.id))
  for (const extension of shipped) {
    expect(`${extension.id} in the market: ${ids.has(extension.id)}`).toBe(
      `${extension.id} in the market: true`,
    )
    // A built-in is parsed without a folder, so a relative asset would resolve
    // to nothing — one carrying assets cannot be preinstalled as it stands.
    expect(extension.assets).toEqual([])
    expect(extension.builtin).toBe(true)
  }
  // The languages a first run has to highlight without any network at all.
  const languages = new Set(shipped.flatMap(extension => extension.languages.map(l => l.id)))
  for (const id of ['typescript', 'javascript', 'typescriptreact', 'json', 'markdown', 'css']) {
    expect(`${id}:${languages.has(id)}`).toBe(`${id}:true`)
  }
})

test('every market theme tints the current line instead of filling it', () => {
  for (const theme of themes) {
    const [bg, line] = [rgb(theme.theme.ui.bg), rgb(theme.theme.ui.currentLine)]
    const delta = Math.max(...bg.map((value, i) => Math.abs(value - line[i]!)))
    expect(`${theme.id}:${delta > 0 && delta <= 20}`).toBe(`${theme.id}:true`)
  }
})

test('indent guides are visible in every market theme', () => {
  for (const theme of themes) {
    const [bg, guide] = [rgb(theme.theme.ui.bg), rgb(theme.theme.ui.indentGuide)]
    const delta = Math.max(...bg.map((value, i) => Math.abs(value - guide[i]!)))
    expect(`${theme.id}:${delta >= 6}`).toBe(`${theme.id}:true`)
  }
})

test('every market theme colours the groups a file actually uses', () => {
  // A manifest whose `syntax` is empty parses fine and renders every token in
  // the body colour, which reads as "highlighting is broken", not as a theme.
  for (const theme of themes) {
    for (const group of ['comment', 'string', 'keyword', 'function', 'type']) {
      expect(`${theme.id}/${group}`).toBe(
        theme.theme.syntax[group] ? `${theme.id}/${group}` : `${theme.id}/${group} missing`,
      )
    }
  }
})

test('every market icon glyph survives parsing and is one cell wide', () => {
  for (const extension of market) {
    for (const icons of extension.icons) {
      const raw = JSON.parse(readFileSync(extension.source, 'utf8')) as {
        icons: { extensions: Record<string, unknown>; names: Record<string, unknown> }[]
      }
      const declared = raw.icons[0]!
      // A two-cell glyph is dropped by the parser rather than drawn, so a count
      // that fell is a manifest quietly missing icons — the one failure mode
      // that looks like the theme simply not covering that file type.
      expect(Object.keys(icons.extensions)).toHaveLength(Object.keys(declared.extensions).length)
      expect(Object.keys(icons.names)).toHaveLength(Object.keys(declared.names).length)
      for (const entry of [icons.file, icons.folder, icons.folderOpen]) {
        expect([...entry.glyph]).toHaveLength(1)
      }
    }
  }
})

test('the languages druk used to serve are all still one install away', () => {
  const served = new Set(market.flatMap(p => p.servers.flatMap(server => server.filetypes)))
  for (const filetype of [
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
    'go',
    'rust',
    'python',
    'c',
    'cpp',
    'zig',
    'lua',
    'bash',
    'ruby',
    'php',
    'swift',
    'css',
    'html',
    'json',
  ]) {
    expect(`${filetype}:${served.has(filetype)}`).toBe(`${filetype}:true`)
  }
})
