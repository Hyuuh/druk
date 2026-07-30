import { afterAll, expect, test } from 'bun:test'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, setTransparency, THEMES } from '../src/themes'
import { fixture, launch, openFile, openPalette, runCommand, settle } from './helpers'
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

test('the palette toggles transparency, and a launch starts from its own config', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir)
  await openFile(t, 'a.ts')

  await runCommand(t, 'Transparent background')
  expect(bgAlpha(t, 'const')).toBe(0)

  // The theme store outlives a harness, so a launch that says "off" has to undo
  // what the one before it left on.
  const reopened = await launch(dir, { transparent: false })
  await openFile(reopened, 'a.ts')
  expect(bgAlpha(reopened, 'const')).toBe(255)
})

test('a theme switch keeps transparency on', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }), { transparent: true })
  await openFile(t, 'a.ts')
  setTheme('catppuccin-latte')
  await settle(t)
  expect(bgAlpha(t, 'const')).toBe(0)
  expect(THEMES['catppuccin-latte'].ui.bg).not.toBe('transparent')
})
