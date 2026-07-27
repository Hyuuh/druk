import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'a.ts': 'const a = 1\n',
  'b.ts': 'const b = 2\n',
  'c.ts': 'const c = 3\n',
  'd.ts': 'const d = 4\n',
  'keep/inside.ts': 'const inside = 5\n',
}

/**
 * Terminals send Shift+arrow as CSI 1;2A / 1;2B. `pressArrow` types the plain
 * sequence, so the modifier has to be driven as raw bytes — the same trap as
 * Shift+Tab in test/indent-key.test.tsx.
 */
const SHIFT_UP = `${String.fromCharCode(27)}[1;2A`
const SHIFT_DOWN = `${String.fromCharCode(27)}[1;2B`

const shiftDown = (t: Harness) => press(t, input => void input.pressKeys([SHIFT_DOWN]))
const shiftUp = (t: Harness) => press(t, input => void input.pressKeys([SHIFT_UP]))

/** Tree row labels in order, with the tree glyphs stripped. */
const rows = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .slice(3)
    .map(row =>
      row
        .slice(0, 28)
        .replaceAll(/[│▾▸·→▌]/g, '')
        .trim(),
    )
    .filter(Boolean)

describe('Shift+↑/↓ in the tree', () => {
  test('deletes every row in the range, not just the cursor', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)

    // Rows: keep, a.ts, b.ts, c.ts, d.ts. Land on a.ts, then take b.ts and c.ts.
    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressArrow('down'))
    await shiftDown(t)
    await shiftDown(t)
    await settle(t)

    await press(t, input => void input.typeText('d'))
    await settle(t)
    expect(t.captureCharFrame()).toContain('Delete these 3 items')

    await press(t, input => input.pressEnter())
    await settle(t)
    expect(existsSync(join(dir, 'a.ts'))).toBe(false)
    expect(existsSync(join(dir, 'b.ts'))).toBe(false)
    expect(existsSync(join(dir, 'c.ts'))).toBe(false)
    // Outside the range, untouched.
    expect(existsSync(join(dir, 'd.ts'))).toBe(true)
    expect(existsSync(join(dir, 'keep/inside.ts'))).toBe(true)
  })

  test('moves the whole range with x and p', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)

    await press(t, input => input.pressArrow('down')) // keep/
    await press(t, input => input.pressArrow('down')) // a.ts
    await shiftDown(t) // + b.ts
    await settle(t)

    await press(t, input => void input.typeText('x'))
    expect(t.captureCharFrame()).toContain('Cut 2 items')

    // Back up to the folder and drop them in.
    await press(t, input => input.pressArrow('up'))
    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'keep/a.ts'))).toBe(true)
    expect(existsSync(join(dir, 'keep/b.ts'))).toBe(true)
    expect(existsSync(join(dir, 'a.ts'))).toBe(false)
  })

  test('reversing direction shrinks the range rather than stranding an end', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressArrow('down')) // a.ts is the anchor

    await shiftDown(t)
    await shiftDown(t) // a.ts…c.ts
    await shiftUp(t) // back to a.ts…b.ts
    await settle(t)

    await press(t, input => void input.typeText('d'))
    await settle(t)
    expect(t.captureCharFrame()).toContain('Delete these 2 items')
  })

  test('a plain arrow drops the range', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await press(t, input => input.pressArrow('down'))
    await press(t, input => input.pressArrow('down'))
    await shiftDown(t)
    await settle(t)

    await press(t, input => input.pressArrow('down'))
    await settle(t)
    await press(t, input => void input.typeText('d'))
    await settle(t)

    // One row again, so the confirm names it instead of counting.
    const frame = t.captureCharFrame()
    expect(frame).not.toContain('items')
    expect(frame).toContain('Delete "')
  })

  test('Esc drops the range but keeps the file list intact', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    const before = rows(t)

    await press(t, input => input.pressArrow('down'))
    await shiftDown(t)
    await settle(t)
    await pressEscape(t)
    await settle(t, 80)

    expect(rows(t)).toEqual(before)
    await press(t, input => void input.typeText('d'))
    await settle(t)
    expect(t.captureCharFrame()).not.toContain('items')
  })
})
