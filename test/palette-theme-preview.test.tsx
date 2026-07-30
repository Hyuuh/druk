import { afterAll, expect, test } from 'bun:test'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import {
  fixture,
  launch,
  openPalette,
  press,
  pressEscape,
  pressTimes,
  until,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

/** Reset the module-global theme so later test files do not depend on this one. */
afterAll(() => {
  setTheme('dark')
  invalidateSyntaxStyle()
})

const rgb = (c?: { buffer: Record<string, number> }) =>
  c ? `${c.buffer['0']},${c.buffer['1']},${c.buffer['2']}` : ''

function bgColors(t: Harness) {
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

/** Background and foreground — syntax lives in the latter. */
function colors(t: Harness) {
  const capture = t.captureSpans() as unknown as {
    lines: {
      spans: {
        text: string
        fg?: { buffer: Record<string, number> }
        bg?: { buffer: Record<string, number> }
      }[]
    }[]
  }
  const seen = new Set<string>()
  for (const line of capture.lines) {
    for (const span of line.spans) {
      if (span.bg) seen.add(rgb(span.bg))
      if (span.fg && span.text.trim()) seen.add(rgb(span.fg))
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

test('palette cancels a previewed theme when filtering away from it', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openPalette(t)

  // Preview catppuccin-latte.
  await press(t, i => void i.typeText('latte'))
  const previewColors = bgColors(t)
  expect(previewColors).toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))

  // Filtering until there are no matching commands leaves the preview row.
  await press(t, i => void i.typeText('x'))
  expect(t.captureCharFrame()).toContain('No matching commands')
  const restoredColors = bgColors(t)
  expect(restoredColors).toContain(hexToRgb(THEMES.dark.ui.bg))
  expect(restoredColors).not.toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))

  // Closing the palette after the preview has already been cancelled.
  await pressEscape(t)
  const afterEsc = bgColors(t)
  expect(afterEsc).toContain(hexToRgb(THEMES.dark.ui.bg))
  expect(afterEsc).not.toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))
})

test('palette cancels a previewed theme before running a non-preview command', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await openPalette(t)

  await press(t, i => void i.typeText('latte'))
  const previewColors = bgColors(t)
  expect(previewColors).toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))

  // Backspace the filter and select a non-preview command.
  await pressTimes(t, 5, i => i.pressBackspace())
  await press(t, i => void i.typeText('save'))
  expect(t.captureCharFrame()).toContain('Save file')

  // Running the non-preview command should cancel the stale preview.
  await press(t, i => i.pressEnter())
  const restoredColors = bgColors(t)
  expect(restoredColors).toContain(hexToRgb(THEMES.dark.ui.bg))
  expect(restoredColors).not.toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))
})

test('cancelling a theme preview restores the editor, not only the sidebar', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, {}, { openFile: `${dir}/a.ts` })
  await untilFrame(t, 'const')
  // Wait for the highlight pass: keyword color is what the editor alone paints.
  const darkKeyword = hexToRgb((THEMES.dark.syntax.keyword as { fg: string }).fg)
  const latteKeyword = hexToRgb((THEMES['catppuccin-latte'].syntax.keyword as { fg: string }).fg)
  await until(t, () => colors(t).has(darkKeyword))

  await openPalette(t)
  await press(t, i => void i.typeText('latte'))
  await until(t, () => bgColors(t).has(hexToRgb(THEMES['catppuccin-latte'].ui.bg)))

  // Esc closes the palette and must undo the preview everywhere — including the
  // open editor's syntax table, which used to stay on the previewed theme until
  // the next keystroke dirtied the buffer.
  await pressEscape(t)
  await until(t, () => colors(t).has(darkKeyword) && !colors(t).has(latteKeyword))
  expect(bgColors(t)).toContain(hexToRgb(THEMES.dark.ui.bg))
  expect(bgColors(t)).not.toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))
})
