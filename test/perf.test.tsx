import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { computeSegments, getSyntaxStyle } from '../src/languages/highlight'
import { fixture, launch, press } from './helpers'

const BIG = readFileSync('pnpm-lock.yaml', 'utf8')

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
  // More than plain text + chrome means the window followed the viewport.
  expect(foreground.size).toBeGreaterThan(3)
}, 20000)

/** Average cost of one downward step, after opening the only file in a project. */
async function scrollCost(content: string, steps: number) {
  const t = await launch(fixture({ 'f.yaml': content }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  const started = performance.now()
  for (let n = 0; n < steps; n++) await press(t, i => i.pressArrow('down'))
  return (performance.now() - started) / steps
}

test('scrolling cost does not grow with file size', async () => {
  const small = Array.from({ length: 20 }, (_, i) => `k${i}: ${i}`).join('\n')
  const baseline = await scrollCost(small, 60)
  const large = await scrollCost(BIG, 60)

  // Both are dominated by the harness's frame render; what matters is that the
  // 1500-line file is not measurably worse. Re-applying the whole window per
  // step (the old behaviour) made this several times the baseline.
  expect(large).toBeLessThan(baseline * 2)
}, 60000)

test('every segment carries its line so the viewport can be filtered', async () => {
  const segs = (await computeSegments(BIG, 'yaml', 2))!
  expect(segs.length).toBeGreaterThan(1000)
  expect(segs.every(s => Number.isInteger(s.line))).toBe(true)
  const property = getSyntaxStyle().getStyleId('property')
  expect(segs.some(s => s.styleId === property)).toBe(true)
})
