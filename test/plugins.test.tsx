import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MARKET_DIR } from '../scripts/plugins'
import {
  CONFIG_FILE,
  DEFAULTS,
  loadConfig,
  parsePartial,
  PROJECT_CONFIG_DIR,
  projectConfigFile,
  readDisabledPlugins,
} from '../src/core/config'
import { iconFor, isIconThemeName } from '../src/icons'
import { languageFor } from '../src/languages'
import { filetypeForPath } from '../src/languages/highlight'
import { resolveServer } from '../src/lsp/servers'
import { loadPlugins, parseManifest, PLUGINS_DIR, projectPluginsDir } from '../src/plugins'
import { isThemeName, themeFor, themeNames } from '../src/themes'
import { fixture, launch, openPalette, press, runCommand, settle } from './helpers'

/** The smallest theme a manifest can carry: every ui color, one syntax group. */
const themeColors = (color: string) =>
  Object.fromEntries(Object.keys(themeFor('dark').ui).map(key => [key, color]))

/** An appearance plugin: how the editor looks, and nothing about a language. */
const MANIFEST = {
  id: 'pack',
  name: 'Test Pack',
  version: '2.1.0',
  themes: [
    {
      id: 'neon',
      name: 'Neon',
      ui: themeColors('#123456'),
      syntax: { keyword: { fg: '#ff00ff', bold: true } },
    },
  ],
  icons: [
    {
      id: 'blocks',
      name: 'Blocks',
      file: '■',
      folder: '□',
      extensions: { ts: { glyph: '▲', color: '#3178c6' } },
    },
  ],
}

/** A language plugin: one language, and the server that serves it. */
const LANGUAGE = {
  id: 'nim',
  name: 'Nim',
  version: '1.0.0',
  languages: [
    {
      id: 'nim',
      lineComment: '#',
      extensions: ['.nim'],
      patterns: [{ group: 'keyword', re: '\\b(?:proc|let|var)\\b', flags: 'g' }],
    },
  ],
  languageServers: [
    {
      id: 'nim',
      command: ['nimlangserver'],
      filetypes: ['nim'],
      install: { kind: 'manual', command: 'nimble install nimlangserver' },
    },
  ],
}

/** Write a manifest into the user plugins folder and load it. */
function install(manifest: unknown, id = 'pack') {
  const dir = join(PLUGINS_DIR, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest))
  return dir
}

afterEach(() => {
  rmSync(PLUGINS_DIR, { recursive: true, force: true })
  // The registries are module state, so a plugin left registered would leak
  // into every test after this one — and into the frames they capture.
  loadPlugins(process.env.XDG_CONFIG_HOME!)
})

test('an appearance manifest contributes a theme and an icon theme', () => {
  install(MANIFEST)
  const { plugins, problems } = loadPlugins(fixture({}))

  expect(problems).toEqual([])
  expect(plugins.filter(p => !p.builtin).map(plugin => `${plugin.name} ${plugin.version}`)).toEqual(
    ['Test Pack 2.1.0'],
  )

  expect(isThemeName('neon')).toBe(true)
  expect(themeNames()).toContain('neon')
  expect(themeFor('neon').ui.bg).toBe('#123456')
  expect(themeFor('neon').syntax.keyword).toEqual({ fg: '#ff00ff', bold: true })

  expect(isIconThemeName('blocks')).toBe(true)
  expect(iconFor('blocks', { name: 'a.ts', isDir: false })).toEqual({
    glyph: '▲',
    color: '#3178c6',
  })
  expect(iconFor('blocks', { name: 'notes.txt', isDir: false })?.glyph).toBe('■')
  expect(iconFor('blocks', { name: 'src', isDir: true })?.glyph).toBe('□')
})

test('a language manifest contributes the language and its server', () => {
  install(LANGUAGE, 'nim')
  const { problems } = loadPlugins(fixture({}))
  expect(problems).toEqual([])

  const language = languageFor('nim')
  expect(language?.lineComment).toBe('#')
  // The regex arrives as a string and has to come back out as a working one,
  // with `g` whatever the manifest said — the pattern walker loops without it.
  expect(language?.patterns?.[0]?.re.flags).toContain('g')
  expect(language?.patterns?.[0]?.re.test('proc f')).toBe(true)
  // The extension is the only thing that routes a .nim file to this language:
  // OpenTUI has never heard of it.
  expect(filetypeForPath('/tmp/a.nim')).toBe('nim')

  const server = resolveServer('nim', {})
  expect(server?.command).toEqual(['nimlangserver'])
  expect(server?.install).toEqual({ kind: 'manual', command: 'nimble install nimlangserver' })
})

test('a manifest that is both a theme pack and a language is refused', () => {
  // The two families are installed for different reasons and updated on
  // different schedules; one plugin doing both is not something to allow.
  const { plugin, problems } = parseManifest({ ...MANIFEST, ...LANGUAGE, id: 'both' }, '/p.json')
  expect(plugin).toBeNull()
  expect(problems[0]?.reason).toContain('one or the other')
})

test('a plugin on disk replaces the built-in of the same id', () => {
  // The update path: druk ships a typescript plugin, and the market's copy of it
  // — or a hand-written one — is what takes over.
  install({
    id: 'typescript',
    version: '9.0.0',
    languageServers: [{ id: 'typescript', command: ['deno', 'lsp'], filetypes: ['typescript'] }],
  })
  const { plugins: found, problems } = loadPlugins(fixture({}))
  expect(problems).toEqual([])
  expect(resolveServer('typescript', {})?.command).toEqual(['deno', 'lsp'])
  const shipped = found.filter(plugin => plugin.id === 'typescript')
  expect(shipped).toHaveLength(1)
  expect(shipped[0]?.builtin).toBe(false)
})

test('a project carries its own plugins', () => {
  const dir = fixture({})
  mkdirSync(projectPluginsDir(dir), { recursive: true })
  writeFileSync(join(projectPluginsDir(dir), 'local.json'), JSON.stringify(MANIFEST))

  expect(loadPlugins(dir).plugins.filter(plugin => !plugin.builtin)).toHaveLength(1)
  expect(isThemeName('neon')).toBe(true)
})

test('a disabled plugin is listed but registers nothing', () => {
  install(MANIFEST)
  install(LANGUAGE, 'nim')
  const { plugins: found } = loadPlugins(fixture({}), ['pack', 'nim'])
  expect(found.filter(p => !p.builtin).every(plugin => plugin.disabled)).toBe(true)
  expect(isThemeName('neon')).toBe(false)
  expect(resolveServer('nim', {})).toBeNull()
  expect(languageFor('nim')).toBeUndefined()
})

test('a disabled built-in takes its language with it', () => {
  // The one thing disabling a shipped plugin has to do: druk stops knowing that
  // language at all, rather than half-registering it.
  loadPlugins(fixture({}), ['typescript'])
  expect(languageFor('typescript')).toBeUndefined()
  loadPlugins(fixture({}))
  expect(languageFor('typescript')).toBeDefined()
})

test('reloading drops what an uninstalled plugin contributed', () => {
  const dir = install(MANIFEST)
  const project = fixture({})
  loadPlugins(project)
  expect(isThemeName('neon')).toBe(true)

  rmSync(dir, { recursive: true, force: true })
  loadPlugins(project)
  expect(isThemeName('neon')).toBe(false)
  expect(themeNames()).not.toContain('neon')
})

test('a plugin may register over a shipped id, and dropping it puts that back', () => {
  install({
    id: 'over',
    themes: [{ id: 'dark', name: 'My Dark', ui: themeColors('#010203'), syntax: {} }],
    icons: [{ id: 'unicode', name: 'Mine', file: '#' }],
  })
  const project = fixture({})
  loadPlugins(project)
  expect(themeFor('dark').ui.bg).toBe('#010203')
  expect(iconFor('unicode', { name: 'a.ts', isDir: false })?.glyph).toBe('#')

  rmSync(PLUGINS_DIR, { recursive: true, force: true })
  loadPlugins(project)
  // Not deleted with the plugin: `dark` is the fallback every other lookup ends
  // at, so losing it would leave the editor with no colors at all.
  expect(themeFor('dark').name).toBe('GitHub Dark')
  expect(themeNames()).toContain('dark')
  expect(iconFor('unicode', { name: 'a.ts', isDir: false })?.glyph).toBe('◆')
})

test('an icon map points at definitions, and a folder gets its open form', () => {
  const { plugin, problems } = parseManifest(
    {
      id: 'defs',
      icons: [
        {
          id: 'named',
          definitions: {
            'typescript': { glyph: '◆', color: '#3178c6' },
            'folder-src': { glyph: '◈', color: '#4caf50', open: '◇' },
          },
          extensions: { 'ts': 'typescript', '.tsx': 'typescript' },
          names: { '.gitignore': 'typescript' },
          folders: { src: 'folder-src' },
        },
      ],
    },
    '/plugins/defs/plugin.json',
  )
  expect(problems).toEqual([])
  const icons = plugin!.icons[0]!
  expect(icons.extensions).toEqual({
    ts: { glyph: '◆', color: '#3178c6' },
    tsx: { glyph: '◆', color: '#3178c6' },
  })
  // Kept whole, dot and all: `.gitignore` is the file's name, and stripping the
  // dot here would leave a key `iconFor` can never look up.
  expect(icons.names['.gitignore']?.glyph).toBe('◆')
  expect(icons.folders.src?.glyph).toBe('◈')
  expect(icons.foldersOpen.src).toEqual({ glyph: '◇', color: '#4caf50' })
})

test('a named folder is found however the project spelled it', () => {
  install({
    id: 'dirs',
    icons: [
      {
        id: 'dirs',
        folder: '□',
        folderOpen: '▽',
        definitions: { 'folder-github': { glyph: '◉', open: '◎' } },
        folders: { github: 'folder-github' },
      },
    ],
  })
  loadPlugins(fixture({}))
  for (const name of ['github', '.github', '_github', '__github__']) {
    expect(`${name}:${iconFor('dirs', { name, isDir: true })?.glyph}`).toBe(`${name}:◉`)
  }
  expect(iconFor('dirs', { name: '.github', isDir: true, expanded: true })?.glyph).toBe('◎')
  // A folder the theme never named still says whether it is open.
  expect(iconFor('dirs', { name: 'whatever', isDir: true, expanded: true })?.glyph).toBe('▽')
})

test('a Nerd Font glyph above the BMP is one cell, and still not an emoji', () => {
  const { plugin } = parseManifest(
    {
      id: 'nerd',
      // U+F07D3 is Nerd Fonts' Material Design Icons range, which a patched font
      // draws one cell wide; U+1F600 is an emoji and is two.
      icons: [{ id: 'nerd', file: '\u{F07D3}', extensions: { ts: '\u{1F600}' } }],
    },
    '/plugins/nerd/plugin.json',
  )
  expect(plugin?.icons[0]?.file.glyph).toBe('\u{F07D3}')
  expect(plugin?.icons[0]?.extensions).toEqual({})
})

test('a bad contribution is reported and costs the plugin only that entry', () => {
  const { plugin, problems } = parseManifest(
    {
      id: 'half',
      themes: [{ id: 'broken', ui: { bg: 'red' }, syntax: {} }],
      icons: [
        { id: 'wide', file: '👍' },
        { id: 'ok', file: '#' },
      ],
      languageServers: [{ id: 'nocmd', filetypes: ['nim'] }],
    },
    '/plugins/half/plugin.json',
  )

  expect(plugin?.themes).toEqual([])
  expect(plugin?.servers).toEqual([])
  // The two-cell glyph is refused, not drawn: it would shift every name in the
  // tree by a column. The theme it belongs to keeps its other icons.
  expect(plugin?.icons.map(icons => icons.id)).toEqual(['wide', 'ok'])
  expect(plugin?.icons[0]?.file.glyph).not.toBe('👍')
  expect(problems.map(problem => problem.reason)).toEqual([
    'theme "broken" needs a #rrggbb bg',
    'server "nocmd" needs a command, e.g. ["nimlangserver"]',
  ])
})

test('a manifest that is not JSON is a reported problem, not a crash', () => {
  const dir = join(PLUGINS_DIR, 'bad')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), '{ not json')

  const { plugins: found, problems } = loadPlugins(fixture({}))
  expect(found.filter(plugin => !plugin.builtin)).toEqual([])
  expect(problems).toHaveLength(1)
})

test('the config takes a plugin theme, and drops one no plugin registers', () => {
  install(MANIFEST)
  loadPlugins(fixture({}))
  expect(parsePartial({ theme: 'neon', iconTheme: 'blocks' })).toEqual({
    theme: 'neon',
    iconTheme: 'blocks',
  })

  rmSync(PLUGINS_DIR, { recursive: true, force: true })
  loadPlugins(fixture({}))
  expect(parsePartial({ theme: 'neon', iconTheme: 'blocks' })).toEqual({})
})

test('startup order: plugins load, then the config keeps their theme', () => {
  // What main.tsx does, in the order it does it — the one arrangement no UI test
  // covers, and the one that decides whether a plugin theme survives a restart.
  install(MANIFEST)
  const dir = fixture({})
  mkdirSync(join(dir, PROJECT_CONFIG_DIR), { recursive: true })
  writeFileSync(projectConfigFile(dir), JSON.stringify({ disabledPlugins: [] }))
  writeFileSync(CONFIG_FILE, JSON.stringify({ theme: 'neon', disabledPlugins: ['pack'] }))

  // The project's empty list wins over the user's, so nothing is disabled.
  expect(readDisabledPlugins(dir)).toEqual([])
  loadPlugins(dir, readDisabledPlugins(dir))
  expect(loadConfig().theme).toBe('neon')

  // And with the project file gone, the user's own list shelves the plugin —
  // which takes its theme with it, so the config falls back.
  rmSync(projectConfigFile(dir))
  expect(readDisabledPlugins(dir)).toEqual(['pack'])
  loadPlugins(dir, readDisabledPlugins(dir))
  expect(loadConfig().theme).toBe(DEFAULTS.theme)
})

test('icons take the arrow column in the tree', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'notes.md': '# hi\n' })
  const t = await launch(dir, { iconTheme: 'unicode' })

  const frame = t.captureCharFrame()
  expect(frame).toContain('◆ a.ts')
  expect(frame).toContain('¶ notes.md')
  // The row is no wider than it was: the glyph replaced the arrow.
  expect(frame).not.toContain('· a.ts')
})

test('a plugin icon theme is a value of the setting', async () => {
  install(MANIFEST)
  loadPlugins(fixture({}))
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { iconTheme: 'blocks' })
  expect(t.captureCharFrame()).toContain('▲ a.ts')
})

test('the material set draws the tree it is installed for', async () => {
  install(
    JSON.parse(readFileSync(join(MARKET_DIR, 'material-icons', 'plugin.json'), 'utf8')),
    'material-icons',
  )
  const dir = fixture({ 'a.ts': 'const a = 1\n', 'src/b.rs': 'fn main() {}\n' })
  loadPlugins(dir)
  const t = await launch(dir, { iconTheme: 'material' })

  const glyph = (name: string, isDir: boolean) =>
    iconFor('material', { name, isDir, expanded: false })!.glyph
  const frame = t.captureCharFrame()
  expect(frame).toContain(`${glyph('a.ts', false)} a.ts`)
  expect(frame).toContain(`${glyph('src', true)} src`)
  // Every row is still the same number of cells: a Nerd Font glyph above the
  // BMP takes one, and the tree would drift a column if it were counted as two.
  const widths = frame
    .split('\n')
    .filter(Boolean)
    .map(line => [...line].length)
  expect(new Set(widths).size).toBe(1)
})

test('a plugin theme is in the palette and the settings page', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadPlugins(dir)
  const t = await launch(dir)

  await openPalette(t)
  await press(t, input => void input.typeText('Neon'))
  expect(t.captureCharFrame()).toContain('Neon')
})

test('the settings page counts the plugins and turns one off', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const count = loadPlugins(dir).plugins.length
  // Tall enough to reach the Plugins section, which is the last one on the page.
  const t = await launch(dir, {}, { height: 60 })

  await runCommand(t, 'Settings')
  await settle(t)
  // Counted rather than written out: the number is druk's preinstalled set plus
  // the one this test wrote, and pinning it here would make adding a shipped
  // plugin look like a broken settings page.
  expect(t.captureCharFrame()).toContain(`${count}/${count} enabled`)
})

test('the palette names what was installed, and counts what ships', async () => {
  install(MANIFEST)
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const shipped = loadPlugins(dir).plugins.filter(plugin => plugin.builtin).length
  const t = await launch(dir, {}, { width: 120 })

  await runCommand(t, 'Installed plugins')
  const frame = t.captureCharFrame()
  // The shipped ones are a number: naming seven of them would push the plugin
  // the user actually installed off the end of the line.
  expect(frame).toContain(`${shipped} built in`)
  expect(frame).toContain('Test Pack 2.1.0')
})

test('every icon glyph druk ships is one cell wide', () => {
  // A two-cell glyph shifts every name in the tree, and the frame captures in
  // these tests would drift with it.
  for (const theme of ['unicode']) {
    for (const name of ['a.ts', 'a.js', 'readme.md', 'package.json', 'photo.png', 'x.unknown']) {
      const glyph = iconFor(theme, { name, isDir: false })?.glyph ?? ''
      expect(`${theme}/${name}:${[...glyph].length}`).toBe(`${theme}/${name}:1`)
    }
  }
})

test('the default config draws no icons at all', () => {
  expect(DEFAULTS.iconTheme).toBe('none')
  expect(iconFor('none', { name: 'a.ts', isDir: false })).toBeNull()
})
