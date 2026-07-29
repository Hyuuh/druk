import { describe, expect, test } from 'bun:test'

import { fixture, launch, pressTimes, settle } from './helpers'
import type { Harness } from './helpers'

/** More entries than rows, so the thumb is as small as the file count makes it. */
const MANY = Object.fromEntries(
  Array.from({ length: 400 }, (_, index) => [`file-${String(index).padStart(3, '0')}.ts`, 'x\n']),
)

/** The sidebar's scrollbar column: its glyphs, top to bottom. */
function thumb(t: Harness, sidebarWidth = 30) {
  const rows = t
    .captureCharFrame()
    .split('\n')
    .filter(row => row.length > 0)
    // Past the tab bar, the sidebar's view tabs and the tree's two-row header,
    // where the track starts.
    .slice(4, -1)
  const column = rows.map(row => row[sidebarWidth - 1] ?? ' ')
  const filled = column.flatMap((glyph, row) => ('█▀▄'.includes(glyph) ? [row] : []))
  return { column, filled }
}

describe('the sidebar scrollbar', () => {
  test('is tall enough to see and to grab', async () => {
    const t = await launch(fixture(MANY), {}, { width: 100, height: 24 })
    await settle(t)

    // OpenTUI's own floor is half a row, which on a tree this long left a single
    // half-block: visible only if you knew where to look.
    expect(thumb(t).filled.length).toBeGreaterThanOrEqual(3)
  })

  test('still sits at the top before anything scrolls', async () => {
    const t = await launch(fixture(MANY), {}, { width: 100, height: 24 })
    await settle(t)

    expect(thumb(t).filled[0]).toBe(0)
  })

  test('moves down as the tree scrolls', async () => {
    const t = await launch(fixture(MANY), {}, { width: 100, height: 24 })
    await settle(t)
    const before = thumb(t).filled[0] ?? 0

    await pressTimes(t, 120, input => input.pressArrow('down'))

    expect(thumb(t).filled[0] ?? 0).toBeGreaterThan(before)
  }, 30000)

  test('a tree that fits shows no thumb at all', async () => {
    const t = await launch(
      fixture({ 'a.ts': 'x\n', 'b.ts': 'x\n' }),
      {},
      { width: 100, height: 24 },
    )
    await settle(t)

    expect(thumb(t).filled).toEqual([])
  })
})
