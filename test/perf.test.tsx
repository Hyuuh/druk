import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { invalidateSyntaxStyle } from '../src/languages/highlight'
import { setTheme, THEMES } from '../src/themes'
import { fixture, launch, press } from './helpers'

const BIG = readFileSync('pnpm-lock.yaml', 'utf8')

const rgb = (hex: string) =>
  [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16)).join(',')

test('a large file opens quickly and is highlighted', async () => {
  const started = performance.now()
  const t = await launch(fixture({ 'pnpm-lock.yaml': BIG }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  const elapsed = performance.now() - started

  expect(t.captureCharFrame()).toContain('settings:')
  // Budget is generous; it exists to catch a return to per-segment full applies.
  expect(elapsed).toBeLessThan(3000)
})

test('scrolling deep into a large file keeps highlights', async () => {
  // The theme is module state shared across test files, so pin it rather than
  // asserting against whichever one the previously run file left behind.
  setTheme('dark')
  invalidateSyntaxStyle()

  const t = await launch(fixture({ 'pnpm-lock.yaml': BIG }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  for (let n = 0; n < 300; n++) await press(t, i => i.pressArrow('down'))

  const spans = t.captureSpans() as unknown as {
    lines: { spans: { text: string; fg?: { buffer: Record<string, number> } }[] }[]
  }
  const foreground = new Set<string>()
  for (const line of spans.lines) {
    for (const span of line.spans) {
      if (span.fg && span.text.trim()) {
        const b = span.fg.buffer
        foreground.add(`${b['0']},${b['1']},${b['2']}`)
      }
    }
  }
  // Assert a syntax color, not a count of distinct ones: the tree and status bar
  // supply five on their own, so counting passes even with nothing highlighted.
  expect(foreground).toContain(rgb((THEMES.dark.syntax.property as { fg: string }).fg))
}, 20000)
