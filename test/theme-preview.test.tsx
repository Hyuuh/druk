import { expect, test } from 'bun:test'

import { THEMES } from '../src/themes'
import { fixture, launch, press, pressEscape, runCommand } from './helpers'

function bgColors(t: { captureSpans: () => unknown }) {
  const capture = t.captureSpans() as unknown as {
    lines: { spans: { bg?: { buffer: Record<string, number> } }[] }[]
  }
  const rgb = (c?: { buffer: Record<string, number> }) =>
    c ? `${c.buffer['0']},${c.buffer['1']},${c.buffer['2']}` : ''
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

test('settings theme picker previews theme on filter/navigate and cancels on escape', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\n' }))
  await runCommand(t, 'Settings')

  // Open theme picker
  await press(t, i => i.pressEnter())

  // Filter for latte
  await press(t, i => void i.typeText('latte'))
  const previewColors = bgColors(t)
  expect(previewColors).toContain(hexToRgb(THEMES['catppuccin-latte'].ui.bg))

  // Esc cancels preview
  await pressEscape(t)
  const restoredColors = bgColors(t)
  expect(restoredColors).toContain(hexToRgb(THEMES.dark.ui.bg))
})
