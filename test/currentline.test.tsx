import { expect, test } from 'bun:test'

import { fixture, launch, press } from './helpers'

interface Span {
  text: string
  bg?: { buffer: Record<string, number> }
}

function backgrounds(t: Awaited<ReturnType<typeof launch>>): [number, number, number][] {
  const capture = t.captureSpans() as unknown as { lines: { spans: Span[] }[] }
  return capture.lines.flatMap(line =>
    line.spans
      .filter(span => span.bg && span.text.trim().length > 0)
      .map(span => {
        const b = span.bg!.buffer
        return [b['0']!, b['1']!, b['2']!] as [number, number, number]
      }),
  )
}

test('the current line is tinted, not filled with a bright block', async () => {
  const t = await launch(fixture({ 'a.ts': 'const a = 1\nconst b = 2\n' }))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  // GitHub Dark: canvas #0d1117, current line #161b22 — every fill stays dark.
  const tooBright = backgrounds(t).filter(([r, g, b]) => r > 120 && g > 120 && b > 120)
  expect(tooBright).toEqual([])
})
