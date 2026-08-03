/**
 * The market folder itself: every `plugins/<id>/plugin.json` in this repository,
 * and the catalog generated from them.
 *
 * These plugins are what druk used to ship in `src/`, so the guarantees the
 * source files were held to have to hold here too — a palette that fails them
 * is as broken as it ever was, and nothing else would catch it now that no
 * TypeScript file names these colors.
 */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { buildIndex, INDEX_FILE, marketIds, readMarket } from '../scripts/plugins'
import { builtinPlugins } from '../src/plugins/builtin'

const market = readMarket()

const rgb = (hex: string) =>
  [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16))

const themes = market.flatMap(plugin => plugin.themes.map(entry => ({ ...entry, from: plugin.id })))

test('every manifest in the market is one druk can use', () => {
  // `readMarket` throws on a manifest with any problem at all, so reaching here
  // is most of the assertion; the count is what catches a folder that is not one.
  expect(market.map(plugin => plugin.id)).toEqual(marketIds())
  expect(market.every(plugin => plugin.version !== '0.0.0')).toBe(true)
  expect(market.every(plugin => plugin.description.length > 0)).toBe(true)
})

test('the committed index is what the generator writes', () => {
  // Without this, a merged plugin whose author forgot `bun run plugins` would be
  // invisible in the market, or listed at the version before their change. The
  // comparison is on the parsed value, not the text: the index is JSON in the
  // repository, so the formatter owns its whitespace.
  expect(JSON.parse(readFileSync(INDEX_FILE, 'utf8'))).toEqual(buildIndex())
})

test('no two plugins claim the same id', () => {
  const claimed = [
    ...themes.map(theme => `theme:${theme.id}`),
    ...market.flatMap(plugin => plugin.icons.map(icons => `icons:${icons.id}`)),
    ...market.flatMap(plugin => plugin.servers.map(server => `server:${server.id}`)),
    // Two plugins claiming one language would make which of them highlights it
    // depend on load order, which is a folder listing — not a decision anyone
    // made. The same goes for the server that language spawns.
    ...market.flatMap(plugin => plugin.languages.map(language => `lang:${language.id}`)),
    ...market.flatMap(plugin => plugin.servers.flatMap(server => `serves:${server.filetypes}`)),
  ]
  expect(new Set(claimed).size).toBe(claimed.length)
})

test('a plugin is about a language or about how the editor looks, never both', () => {
  for (const plugin of market) {
    const appearance = plugin.themes.length + plugin.icons.length > 0
    const language = plugin.languages.length + plugin.servers.length > 0
    expect(`${plugin.id}:${appearance && language}`).toBe(`${plugin.id}:false`)
  }
})

test('every language has something to highlight with, and a way to be reached', () => {
  for (const plugin of market) {
    for (const language of plugin.languages) {
      const usable = language.bundled || (language.wasm && language.query) || language.patterns
      expect(`${language.id}:${usable ? 'ok' : 'unusable'}`).toBe(`${language.id}:ok`)
      // A grammar path only exists because `vendored` resolved: an asset-backed
      // grammar in this repository would be a wasm blob nobody wants here.
      if (language.wasm) expect(language.wasm.startsWith('/')).toBe(true)
    }
    expect(plugin.assets).toEqual([])
  }
})

test('what ships in the binary is the market folder, and needs no files beside it', () => {
  const shipped = builtinPlugins()
  const ids = new Set(market.map(plugin => plugin.id))
  for (const plugin of shipped) {
    expect(`${plugin.id} in the market: ${ids.has(plugin.id)}`).toBe(
      `${plugin.id} in the market: true`,
    )
    // A built-in is parsed without a folder, so a relative asset would resolve
    // to nothing — one carrying assets cannot be preinstalled as it stands.
    expect(plugin.assets).toEqual([])
    expect(plugin.builtin).toBe(true)
  }
  // The languages a first run has to highlight without any network at all.
  const languages = new Set(shipped.flatMap(plugin => plugin.languages.map(l => l.id)))
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
  for (const plugin of market) {
    for (const icons of plugin.icons) {
      const raw = JSON.parse(readFileSync(plugin.source, 'utf8')) as {
        icons: Record<'extensions' | 'names' | 'folders', Record<string, unknown> | undefined>[]
      }
      const declared = raw.icons[0]!
      // A two-cell glyph is dropped by the parser rather than drawn, so a count
      // that fell is a manifest quietly missing icons — the one failure mode
      // that looks like the theme simply not covering that file type. A map
      // pointing at a definition that does not exist fails the same way.
      for (const map of ['extensions', 'names', 'folders'] as const) {
        expect(`${icons.id}/${map}:${Object.keys(icons[map]).length}`).toBe(
          `${icons.id}/${map}:${Object.keys(declared[map] ?? {}).length}`,
        )
      }
      for (const entry of [
        icons.file,
        icons.folder,
        icons.folderOpen,
        ...Object.values(icons.extensions),
        ...Object.values(icons.names),
        ...Object.values(icons.folders),
        ...Object.values(icons.foldersOpen),
      ]) {
        expect([...entry.glyph]).toHaveLength(1)
      }
    }
  }
})

test('the material set has an icon for the files a project is made of', () => {
  const icons = market.find(plugin => plugin.id === 'material-icons')!.icons[0]!
  // Every one of these resolves to something in the manifest rather than to the
  // theme's fallback file glyph — that fallback is what a port with the
  // associations dropped would show for the whole tree.
  for (const [name, color] of [
    ['a.ts', '#0288d1'],
    ['a.tsx', '#0288d1'],
    ['a.rs', '#ff7043'],
    ['a.go', '#00acc1'],
    ['a.py', '#0288d1'],
    ['package.json', '#8bc34a'],
    ['.gitignore', '#e64a19'],
    ['dockerfile', '#0288d1'],
  ] as const) {
    const entry = name.includes('.')
      ? (icons.names[name] ?? icons.extensions[name.split('.').pop()!])
      : icons.names[name]
    expect(`${name}:${entry?.color}`).toBe(`${name}:${color}`)
  }
  for (const folder of ['src', 'test', 'dist', 'node_modules', 'github']) {
    expect(`${folder}:${folder in icons.folders && folder in icons.foldersOpen}`).toBe(
      `${folder}:true`,
    )
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
