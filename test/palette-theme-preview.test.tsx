import { afterAll, expect, test } from 'bun:test'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import { fixture, launch, openPalette, press, pressEscape } from './helpers'

/** Reset the module-global theme so later test files do not depend on this one. */
afterAll(() => {
  setTheme('dark')
  invalidateSyntaxStyle()
})

const rgb = (c?: { buffer: Record<string, number> }) =>
  c ? `${c.buffer['0']},${c.buffer['1']},${c.buffer['2']}` : ''

function bgColors(t: { captureSpans: () => unknown }) {
  const capture = t.captureSpans() as unknown as {
    lines: { spans: { bg?: { buffer: Record<string, number> } }[] }[]
  }
  const seen = new Set<string>()
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (span.bg) seen.add(rgb(span.bg))
    }
  }
  return seen
}

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  return `${Number.parseInt(h.slice(0, 2), 16)},${Number.parseInt(h.slice(2, 4), 16)},${Number.parseInt(h.slice(4, 6), 16)}`
}

test('palette filters from root and previews a theme before confirming', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openPalette(t)

  // Filtering from the root searches flattened leaves; stopping on a theme paints it.
  await press(t, i => void i.typeText('latte'))
  const previewColors = bgColors(t)
  expect(previewColors).toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))

  // Esc cancels the preview and returns to the current theme.
  await pressEscape(t)
  const restoredColors = bgColors(t)
  expect(restoredColors).toContain(hexToRgb(THEMES.dark.ui.bg))

  // Re-open, filter, and confirm.
  await openPalette(t)
  await press(t, i => void i.typeText('latte'))
  await press(t, i => i.pressEnter())
  const appliedColors = bgColors(t)
  expect(appliedColors).toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))
  expect(appliedColors).not.toContain(hexToRgb(THEMES.dark.ui.bg))
})
