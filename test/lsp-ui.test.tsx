import { expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

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
  untilGone,
} from './helpers'

const FAKE = join(import.meta.dir, 'fixtures', 'fake-lsp.ts')
const MARKER = join(import.meta.dir, 'fixtures', 'marker-lsp.ts')
const INIT = join(import.meta.dir, 'fixtures', 'init-lsp.ts')

/** Diagnostics cross a process boundary; give the fake server room to start. */
const LSP_WAIT = 15_000

test('diagnostics reach the status bar, the problems list, and next-problem', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  // The edit reaches the server through the debounced didChange, so this
  // exercises the whole pipeline, not just the didOpen snapshot.
  await press(t, input => void input.typeText('oops'))
  await untilFrame(t, '● 1', LSP_WAIT)

  // The message is drawn inline after the line's end, before any list opens —
  // on the same row as the code it belongs to.
  await untilFrame(t, 'found oops', LSP_WAIT)
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('oopsconst'))
  expect(row).toContain('found oops')

  await runCommand(t, 'List problems')
  await untilFrame(t, 'found oops', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('a.ts:1:1')

  // Enter jumps to the diagnostic and closes the list.
  await press(t, input => input.pressEnter())
  await untilFrame(t, 'Ln 1, Col 1', LSP_WAIT)
  await untilGone(t, 'Enter jumps')

  // Next problem wraps to the same diagnostic and reads it out.
  await runCommand(t, 'Next problem')
  await untilFrame(t, 'found oops', LSP_WAIT)
}, 30_000)

test('the settings page shows the LSP rows and the master toggle flips', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // Tall enough for every section: the page windows its rows to what it can draw,
  // and the language-server rows are the last of them.
  const t = await launch(dir, {}, { height: 40 })

  await runCommand(t, 'Settings')
  await untilFrame(t, 'LSP diagnostics')
  expect(t.captureCharFrame()).toContain('Inline problem text')
  expect(t.captureCharFrame()).toMatch(/\d+\/\d+ enabled/)
}, 15_000)

test('a missing server with an npm package offers to install it', async () => {
  // The trigger is the *default* command being absent, which an override would
  // hide — so this is one of the few tests that depends on the host. php is the
  // least likely server for a druk developer to have; skip rather than guess.
  if (Bun.which('intelephense') || !Bun.which('node')) return
  const dir = fixture({ 'a.php': '<?php\n' })
  const t = await launch(
    dir,
    { lsp: true, lspAutoInstall: true },
    {},
    { openFile: join(dir, 'a.php') },
  )

  await untilFrame(t, 'Language server missing', LSP_WAIT)
  expect(t.captureCharFrame()).toContain('intelephense is not installed')

  // Declining leaves the install line behind, and does not ask again.
  await pressEscape(t)
  await untilFrame(t, 'npm i -g intelephense')
}, 30_000)

test('a missing server druk cannot install just says so', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  // An override rules out the install offer: the hint names the default's
  // package, which is not what this command is.
  // Wide enough for the whole sentence: the status bar truncates at 80 columns.
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: ['druk-no-such-language-server'] } },
    { width: 110 },
    { openFile: join(dir, 'a.ts') },
  )

  await untilFrame(t, 'is not installed, or not on PATH', LSP_WAIT)
  expect(t.captureCharFrame()).not.toContain('Language server missing')
}, 30_000)

test('the chosen TypeScript is handed to the server, and no choice sends nothing', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const dump = join(dir, 'init.json')
  const server = { typescript: [process.execPath, INIT, dump] }

  const chosen = await launch(
    dir,
    { lsp: true, lspServers: server, typescriptTsdk: '/opt/ts/lib' },
    {},
    { openFile: join(dir, 'a.ts') },
  )
  await until(chosen, () => existsSync(dump), LSP_WAIT)
  await until(chosen, () => readFileSync(dump, 'utf8').includes('/opt/ts/lib'), LSP_WAIT)
  expect(JSON.parse(readFileSync(dump, 'utf8'))).toEqual({ tsserver: { path: '/opt/ts/lib' } })
  chosen.renderer.destroy()

  // Left empty the server picks for itself — it prefers the open project's own
  // copy, so sending a path here would override the very thing that should win.
  rmSync(dump)
  const auto = await launch(
    dir,
    { lsp: true, lspServers: server },
    {},
    { openFile: join(dir, 'a.ts') },
  )
  await until(auto, () => existsSync(dump), LSP_WAIT)
  expect(JSON.parse(readFileSync(dump, 'utf8'))).toBeNull()
}, 30_000)

test('a server spawns only once a file of its language opens', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n', 'readme.md': 'hi\n' })
  const marker = join(dir, 'spawn-marker')
  const t = await launch(dir, {
    lsp: true,
    lspServers: { typescript: [process.execPath, MARKER, marker] },
  })

  // No file open: nothing may spawn, however long the editor sits there.
  await settle(t, 400)
  expect(existsSync(marker)).toBe(false)

  // A file of another language does not wake the typescript server either.
  await openFile(t, 'readme.md')
  await settle(t, 400)
  expect(existsSync(marker)).toBe(false)

  await openFile(t, 'a.ts')
  await until(t, () => existsSync(marker), LSP_WAIT)
}, 30_000)

test('inline text hides when the setting is off, the gutter dot stays', async () => {
  const dir = fixture({ 'a.ts': 'const oops = 1\n' })
  const t = await launch(
    dir,
    { lsp: true, lspInline: false, lspServers: { typescript: [process.execPath, FAKE] } },
    {},
    { openFile: join(dir, 'a.ts') },
  )

  await untilFrame(t, '● 1', LSP_WAIT)
  expect(t.captureCharFrame()).not.toContain('found oops')
}, 30_000)

test('a problem far below the viewport is marked on the track', async () => {
  const lines = Array.from({ length: 400 }, (_, index) => `const value${index} = ${index}`)
  lines[380] = 'const oops = 1'
  const dir = fixture({ 'big.ts': `${lines.join('\n')}\n` })
  const t = await launch(
    dir,
    { lsp: true, lspServers: { typescript: [process.execPath, FAKE] } },
    { width: 100, height: 24 },
    { openFile: join(dir, 'big.ts') },
  )

  await untilFrame(t, '● 1', LSP_WAIT)
  const frame = t.captureCharFrame().split('\n').filter(Boolean)
  const marked = frame.flatMap((row, index) => (row.includes('•') ? [index] : []))

  expect(marked).toHaveLength(1)
  // Near the bottom of the track, where line 380 of 400 belongs — seeing that
  // without scrolling is the whole point of the column.
  expect(marked[0]!).toBeGreaterThan(frame.length * 0.8)
}, 30_000)
