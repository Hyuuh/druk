import { describe, expect, test } from 'bun:test'

import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

/**
 * Switching files reuses one textarea, so the gutter's cached paint must be
 * invalidated when the new text rewraps — these tests pin that. Every case
 * failed before the gutter was subscribed to 'line-info-change': the old
 * file's wrap layout stayed painted over the new file's lines.
 */

/** Rows as [gutter number, line index] — content lines are all `line N`. */
function numbered(t: Harness): Array<[number, number]> {
  return (
    t
      .captureCharFrame()
      .split('\n')
      // Unanchored: the tree sits left of the gutter, so rows don't start with it.
      .map(row => /(\d+)\s+line (\d+)/.exec(row))
      .filter(match => match !== null)
      .map(match => [Number(match[1]), Number(match[2])] as [number, number])
  )
}

function expectNumbersMatchLines(t: Harness) {
  const rows = numbered(t)
  expect(rows.length).toBeGreaterThan(3)
  for (const [shown, line] of rows) expect(shown).toBe(line + 1)
}

async function open(t: Harness, name: string) {
  await press(t, input => input.pressKey('o', { ctrl: true }))
  await press(t, input => void input.typeText(name))
  await press(t, input => input.pressEnter())
  await settle(t)
}

/** Every fifth line wraps, so the gutter has continuation rows to get wrong. */
const wrapped = `${Array.from({ length: 40 }, (_, i) =>
  i % 5 === 0 ? `line ${i} ${'x'.repeat(120)}` : `line ${i}`,
).join('\n')}\n`

/** Same line count as `wrapped`, so nothing else forces the gutter to repaint. */
const plain = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}\n`

describe('line numbers after switching files', () => {
  test('plain -> wrapped keeps numbers on logical lines', async () => {
    const t = await launch(fixture({ 'a.ts': plain, 'b.ts': wrapped }))
    await open(t, 'a.ts')
    await open(t, 'b.ts')
    expectNumbersMatchLines(t)
  })

  test('wrapped -> plain drops the stale wrap layout', async () => {
    const t = await launch(fixture({ 'a.ts': wrapped, 'b.ts': plain }))
    await open(t, 'a.ts')
    await open(t, 'b.ts')
    expectNumbersMatchLines(t)
  })

  test('switching away from a scrolled wrapped file', async () => {
    const t = await launch(fixture({ 'a.ts': wrapped, 'b.ts': plain }))
    await open(t, 'a.ts')
    for (let i = 0; i < 30; i++) t.mockInput.pressKey('down')
    await settle(t)
    await open(t, 'b.ts')
    expectNumbersMatchLines(t)
  })
})
