import { expect, test } from 'bun:test'

import { THEMES } from '../src/themes'
import { fixture, launch, press, pressEscape, runCommand, until, untilFrame } from './helpers'
import type { Harness } from './helpers'

function bgColors(t: Harness) {
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
  const rgb = (c?: { buffer: Record<string, number> }) =>
    c ? `${c.buffer['0']},${c.buffer['1']},${c.buffer['2']}` : ''
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

test('settings theme picker cancel restores the editor syntax too', async () => {
  const dir = fixture({ 'a.ts': 'const a = 1\n' })
  const t = await launch(dir, {}, { height: 40 }, { openFile: `${dir}/a.ts` })
  await untilFrame(t, 'const')
  const darkKeyword = hexToRgb((THEMES.dark.syntax.keyword as { fg: string }).fg)
  const latteKeyword = hexToRgb((THEMES['catppuccin-latte'].syntax.keyword as { fg: string }).fg)
  await until(t, () => colors(t).has(darkKeyword))

  await runCommand(t, 'Settings')
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('latte'))
  await until(t, () => bgColors(t).has(hexToRgb(THEMES['catppuccin-latte'].ui.bg)))

  await pressEscape(t)
  // Back on the settings page — leave it so the editor is visible again.
  await pressEscape(t)
  await until(t, () => colors(t).has(darkKeyword) && !colors(t).has(latteKeyword))
})
