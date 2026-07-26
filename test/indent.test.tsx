import { expect, test } from 'bun:test'

import { DEFAULTS } from '../src/core/config'
import { computeSegments, getSyntaxStyle } from '../src/languages/highlight'
import { THEMES } from '../src/themes'
import { fixture, launch, press } from './helpers'

const NESTED = 'function f() {\n  if (x) {\n    return 1\n  }\n}\n'

/** Every (line, column) carrying the indent-guide style. */
async function guideColumns(content: string, tabSize: number) {
  const segs = (await computeSegments(content, 'typescript', tabSize)) ?? []
  const guide = getSyntaxStyle().getStyleId('indent.guide')
  const lines = content.split('\n')
  return segs
    .filter(s => s.styleId === guide)
    .flatMap(s => Array.from({ length: s.end - s.start }, (_, i) => [s.line, s.start + i] as const))
    .filter(([line, col]) => lines[line]?.[col] === ' ')
}

test('guides mark every indent stop at the configured width', async () => {
  // "  if (x) {" starts at flat offset 14 -> guide at its column 0 only.
  // "    return 1" is two levels -> guides at columns 0 and 2.
  const two = await guideColumns(NESTED, 2)
  expect(two.length).toBe(4) // 1 + 2 + 1 for the closing "  }"

  // At width 4 the same source has fewer stops: nothing lands on column 2.
  const four = await guideColumns(NESTED, 4)
  expect(four.length).toBeLessThan(two.length)
})

test('tab size is configurable and shown in the palette', async () => {
  const t = await launch(fixture({ 'a.ts': NESTED }), { ...DEFAULTS, tabSize: 4 })
  await press(t, i => i.pressKey('p', { ctrl: true }))
  await press(t, i => void i.typeText('spaces'))
  const frame = t.captureCharFrame()
  expect(frame).toContain('2 spaces')
  expect(frame).toContain('* 4 spaces') // marked as active
})

test('indent guides are visible in every theme', () => {
  const rgb = (hex: string) =>
    [0, 2, 4].map(i => Number.parseInt(hex.replace('#', '').slice(i, i + 2), 16))

  for (const [id, theme] of Object.entries(THEMES)) {
    const [bg, guide] = [rgb(theme.ui.bg), rgb(theme.ui.indentGuide)]
    const delta = Math.max(...bg.map((v, i) => Math.abs(v - guide[i]!)))
    // Lower bound only: an invisible guide is a bug, a strong one is taste, and
    // themes are meant to be copied from a published palette verbatim.
    expect(`${id}:${delta >= 6}`).toBe(`${id}:true`)
  }
})
