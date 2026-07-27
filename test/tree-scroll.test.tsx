import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

/** Enough top-level files that the tree scrolls. */
function manyFiles(count: number) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-tree-'))
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.ts`), `const a${i} = ${i}\n`)
  }
  return dir
}

/** Name on the first tree row, i.e. where the sidebar is scrolled to. */
const topRow = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(3, 19)
    .map(row => row.slice(0, 28).trim())
    .find(Boolean) ?? ''

const rowNames = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(1, 19)
    .map(row => row.slice(0, 30))

describe('the sidebar only scrolls when the selection moves', () => {
  test('changing focus leaves a scrolled tree where it is', async () => {
    const t = await launch(manyFiles(300))
    await press(t, input => input.pressArrow('down')) // select f000
    await press(t, input => input.pressEnter()) // open it, focus the editor

    for (let n = 0; n < 40; n++) await t.mockMouse.scroll(4, 8, 'down')
    await settle(t)
    const scrolled = topRow(t)
    expect(scrolled).not.toBe('· f000.ts')

    // Esc only moves focus to the tree. Nothing was chosen, so nothing should move —
    // this used to snap the view back to the selection.
    await pressEscape(t)
    await settle(t)
    expect(topRow(t)).toBe(scrolled)

    // Tab back to the editor: still no movement.
    await press(t, input => input.pressTab())
    await settle(t)
    expect(topRow(t)).toBe(scrolled)
  })

  test('an arrow key still brings the cursor back into view', async () => {
    const t = await launch(manyFiles(300))
    await press(t, input => input.pressArrow('down')) // select f000

    for (let n = 0; n < 40; n++) await t.mockMouse.scroll(4, 8, 'down')
    await settle(t)
    expect(topRow(t)).not.toBe('· f000.ts')

    // Navigating changes the selection, which is what earns a scroll.
    await press(t, input => input.pressArrow('down'))
    await settle(t, 20)
    expect(rowNames(t).join('\n')).toContain('f001.ts')
  })

  test('opening a nested file from the picker scrolls it into view', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 30; i++) files[`deep/nested/f${i}.ts`] = `const a${i} = 1\n`
    const t = await launch(fixture(files))

    await press(t, input => input.pressKey('o', { ctrl: true }))
    await press(t, input => void input.typeText('f21.ts'))
    await press(t, input => input.pressEnter())
    // Revealing expands the parents, so the row index settles after layout does.
    await settle(t, 20)

    expect(rowNames(t).join('\n')).toContain('f21.ts')
  })

  test('a scrolled tree is not yanked back by a git refresh', async () => {
    const dir = manyFiles(300)
    const t = await launch(dir)
    await press(t, input => input.pressArrow('down'))

    for (let n = 0; n < 40; n++) await t.mockMouse.scroll(4, 8, 'down')
    await settle(t)
    const scrolled = topRow(t)

    // The watcher rebuilds the node list; the index of the selection is unchanged.
    writeFileSync(join(dir, 'touched.ts'), 'const touched = 1\n')
    await settle(t, 400)
    expect(topRow(t)).toBe(scrolled)
  })
})

describe('a terminal taller than the row window', () => {
  /**
   * The window used to be a flat 200 rows, so on a very tall terminal the bottom of
   * the tree had no renderables at all and simply came up blank.
   */
  test('renders rows all the way down, not just the first 200', async () => {
    const t = await launch(manyFiles(300), {}, { height: 240 })
    await settle(t)
    const frame = t.captureCharFrame().split('\n')

    // Row 3 is the first file; the viewport reaches well past row 200.
    expect(frame.length).toBeGreaterThan(230)
    expect(frame.some(row => row.includes('f000.ts'))).toBe(true)
    expect(frame.some(row => row.includes('f210.ts'))).toBe(true)
    expect(frame.some(row => row.includes('f230.ts'))).toBe(true)
  })
})
