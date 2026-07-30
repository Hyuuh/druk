import { expect, test, afterAll } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, setTransparency, THEMES } from '../src/themes'
import { fixture, launch, openDiff, openFile, openPalette, settle, toggleSetting } from './helpers'
import type { Harness } from './helpers'

interface Span {
  text: string
  bg?: { buffer: Record<string, number> }
}

/**
 * Alpha of the background behind `text`, 0–255. Unpainted is 0 — the cell keeps
 * whatever the terminal itself is showing, which is what `transparent` buys.
 */
function bgAlpha(t: Harness, text: string): number {
  const lines = (t.captureSpans() as unknown as { lines: { spans: Span[] }[] }).lines
  for (const line of lines) {
    const span = line.spans.find(s => s.text.includes(text))
    if (span) return span.bg?.buffer['3'] ?? -1
  }
  throw new Error(`no span showing ${JSON.stringify(text)}`)
}

// The theme store is module-global and outlives a harness, so a file that turns
// transparency on has to turn it back off for whatever runs next.
afterAll(() => {
  setTransparency(false)
  setTheme('dark')
  invalidateSyntaxStyle()
})

test('transparency leaves the editor unpainted, and off paints it', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })

  const opaque = await launch(dir)
  await openFile(opaque, 'a.ts')
  expect(bgAlpha(opaque, 'const')).toBe(255)

  const clear = await launch(dir, { transparent: true })
  await openFile(clear, 'a.ts')
  expect(bgAlpha(clear, 'const')).toBe(0)
})

test('transparency never empties a floating panel', async () => {
  // Painted whatever the setting says: the editor would read straight through
  // an unpainted palette.
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { transparent: true })
  await openFile(t, 'a.ts')
  await openPalette(t)
  expect(bgAlpha(t, 'Open file')).toBe(255)
})

test('the settings page toggles transparency, and a launch starts from its own config', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir)
  await openFile(t, 'a.ts')

  await toggleSetting(t, 'Transparent')
  expect(bgAlpha(t, 'const')).toBe(0)

  // The theme store outlives a harness, so a launch that says "off" has to undo
  // what the one before it left on.
  const reopened = await launch(dir, { transparent: false })
  await openFile(reopened, 'a.ts')
  expect(bgAlpha(reopened, 'const')).toBe(255)
})

test('the diff page stays painted — it is a layer over the editor', async () => {
  // Not a surface of its own: the diff sits over the editor, so an unpainted one
  // would show the file it is diffing straight through its own lines.
  const dir = fixture({ 'a.ts': 'alpha\n' })
  const git = (...args: string[]) => {
    const run = Bun.spawnSync(['git', ...args], { cwd: dir })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  }
  git('init', '-q')
  git('config', 'user.email', 'druk@test')
  git('config', 'user.name', 'druk')
  git('config', 'commit.gpgsign', 'false')
  git('add', '.')
  git('commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')

  const t = await launch(dir, { transparent: true })
  await openDiff(t)
  expect(bgAlpha(t, 'alpha changed')).toBe(255)
})

test('a theme switch keeps transparency on', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { transparent: true })
  await openFile(t, 'a.ts')
  setTheme('catppuccin-latte')
  await settle(t)
  expect(bgAlpha(t, 'const')).toBe(0)
  expect(THEMES['catppuccin-latte'].ui.bg).not.toBe('transparent')
})
