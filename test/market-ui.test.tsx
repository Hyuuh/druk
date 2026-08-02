/**
 * The market from the editor's side: the offer a file raises, the update notice
 * on startup, and what accepting one actually writes.
 *
 * `fetch` is replaced for the whole file. Nothing here may reach the network —
 * and the global is the seam because that is exactly what production uses:
 * `core/market.ts` reads it at call time, so a stub is the registry.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadExtensions, EXTENSIONS_DIR } from '../src/extensions'
import {
  fixture,
  launch,
  openFile,
  press,
  pressEscape,
  runCommand,
  settle,
  until,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

const GO_EXTENSION = {
  id: 'go',
  name: 'Go',
  version: '1.1.0',
  description: 'gopls, the Go language server',
  languageServers: [{ id: 'go', command: ['gopls'], filetypes: ['go'] }],
}

/** A language druk knows nothing about: no grammar, no extension, no server. */
const NIM_EXTENSION = {
  id: 'nim',
  name: 'Nim',
  version: '1.0.0',
  description: 'Nim highlighting',
  languages: [
    {
      id: 'nim',
      lineComment: '#',
      extensions: ['.nim'],
      patterns: [{ group: 'keyword', re: '\\b(?:proc|let|var)\\b', flags: 'g' }],
    },
  ],
}

const INDEX = {
  extensions: [
    {
      id: 'go',
      name: 'Go',
      version: '1.1.0',
      description: 'gopls, the Go language server',
      provides: { themes: [], icons: [], filetypes: ['go'] },
    },
    {
      id: 'nim',
      name: 'Nim',
      version: '1.0.0',
      description: 'Nim highlighting',
      provides: { themes: [], icons: [], filetypes: ['nim'] },
    },
  ],
}

const realFetch = globalThis.fetch
/** Every url the editor asked for, so a test can assert it asked for nothing. */
let requested: string[] = []

beforeEach(() => {
  requested = []
  globalThis.fetch = ((url: string) => {
    requested.push(String(url))
    const body = String(url).endsWith('index.json')
      ? INDEX
      : String(url).endsWith('go/extension.json')
        ? GO_EXTENSION
        : String(url).endsWith('nim/extension.json')
          ? NIM_EXTENSION
          : null
    return Promise.resolve(
      body ? new Response(JSON.stringify(body)) : new Response('no', { status: 404 }),
    )
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  rmSync(EXTENSIONS_DIR, { recursive: true, force: true })
  rmSync(join(process.env.XDG_CACHE_HOME!, 'druk', 'market.json'), { force: true })
  // The registries are module state: an extension left registered would follow this
  // file's tests into every one after them.
  loadExtensions(process.env.XDG_CONFIG_HOME!)
})

/** An installed extension, at whatever version. */
function install(manifest: unknown, id = 'go') {
  mkdirSync(join(EXTENSIONS_DIR, id), { recursive: true })
  writeFileSync(join(EXTENSIONS_DIR, id, 'extension.json'), JSON.stringify(manifest))
}

test('a file whose language has no server offers the extension, and installs it', async () => {
  const dir = fixture({ 'main.go': 'package main\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.go')

  await untilFrame(t, 'No language server')
  const frame = t.captureCharFrame()
  // The command is on the modal because it is the part that is not inert: a
  // manifest runs nothing, but this is what druk will spawn once it is there.
  expect(frame).toContain('gopls')
  expect(frame).toContain('Extension available')

  await settle(t)
  t.mockInput.pressEnter()
  await until(t, () => existsSyncSafe(join(EXTENSIONS_DIR, 'go', 'extension.json')))
  expect(JSON.parse(readFileSync(join(EXTENSIONS_DIR, 'go', 'extension.json'), 'utf8'))).toEqual(
    GO_EXTENSION,
  )
  await untilFrame(t, 'Installed Go 1.1.0')
})

test('declining is remembered, and asks again for no other file of that language', async () => {
  const dir = fixture({ 'main.go': 'package main\n', 'other.go': 'package other\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: true })
  await openFile(t, 'main.go')
  await untilFrame(t, 'No language server')

  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('No language server')

  await openFile(t, 'other.go')
  await settle(t, 200)
  expect(t.captureCharFrame()).not.toContain('No language server')
})

test('an installed extension with a newer version in the market is reported at startup', async () => {
  install({ ...GO_EXTENSION, version: '1.0.0' })
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  loadExtensions(dir)
  const t = await launch(dir, { extensionUpdates: true }, {}, { checkUpdates: true })

  await untilFrame(t, 'Go 1.1.0 is out')
})

test('the market is not touched when the setting is off', async () => {
  const dir = fixture({ 'main.go': 'package main\n' })
  const t = await launch(dir, { lsp: true, extensionUpdates: false }, {}, { checkUpdates: true })
  await openFile(t, 'main.go')
  await settle(t, 200)

  expect(requested.filter(url => url.includes('extensions'))).toEqual([])
})

/**
 * Open the extensions page and install `name` from its Available section. The
 * market is behind the filter — a standing list of every entry would bury what
 * is installed — so searching for it is the only way to reach one, here as for
 * a user.
 */
async function openMarketRow(t: Harness, name: string) {
  await runCommand(t, 'Extensions')
  await settle(t)
  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText(name))
  await press(t, input => input.pressEnter())
}

test('the extensions page lists the market and installs from it', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 2 extensions')

  await openMarketRow(t, 'gopls')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()
  await untilFrame(t, 'Installed Go 1.1.0')
})

test('the market is behind the filter, not a standing list', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, { extensionUpdates: true }, { height: 40 })

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market: 2 extensions')

  await runCommand(t, 'Extensions')
  await settle(t)
  const idle = t.captureCharFrame()
  expect(idle).toContain('Search the market')
  expect(idle).not.toContain('gopls')

  await press(t, input => void input.typeText('/'))
  await press(t, input => void input.typeText('gopls'))
  const searched = t.captureCharFrame()
  expect(searched).toContain('gopls')
  expect(searched).not.toContain('Search the market')
})

test('installing a language extension teaches druk the language, extension and all', async () => {
  const dir = fixture({ 'a.nim': 'proc main = discard\n' })
  const t = await launch(dir, { extensionUpdates: true })

  // Before: nothing claims .nim, so the status bar has no language to name.
  await openFile(t, 'a.nim')
  expect(t.captureCharFrame()).not.toContain(' nim ')

  await runCommand(t, 'Check for extension updates')
  await untilFrame(t, 'Extension market')
  await openMarketRow(t, 'Nim')
  await untilFrame(t, 'Extension available')
  await settle(t)
  t.mockInput.pressEnter()
  await untilFrame(t, 'Installed Nim 1.0.0')

  // The extension is the whole point: OpenTUI resolves nothing for .nim, so the
  // status bar naming the language means the extension's own claim is what routed it.
  await openFile(t, 'a.nim')
  await untilFrame(t, ' nim ')
})

function existsSyncSafe(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}
