import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'alpha.ts': 'const alpha = 1\n',
  'src/keep.ts': 'const keep = 1\n',
  'lib/other.ts': 'const other = 1\n',
}

/**
 * Open a file, then hand the keyboard back to the tree — opening moves focus to the
 * editor, where `x` and `p` are just letters to type.
 */
async function open(t: Harness, name: string) {
  await press(t, input => input.pressKey('o', { ctrl: true }))
  await press(t, input => void input.typeText(name))
  await press(t, input => input.pressEnter())
  await settle(t)
  await pressEscape(t)
  await settle(t, 80)
}

/**
 * Walk the selection down `steps` rows. The tree starts with nothing selected, so
 * the first ↓ lands on row 0 — `steps` is therefore a 1-based row number.
 */
async function selectNth(t: Harness, steps: number) {
  for (let n = 0; n < steps; n++) await press(t, input => input.pressArrow('down'))
  await settle(t)
}

describe('moving a file with x and p', () => {
  test('into a folder, with the tab following it', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')
    expect(t.captureCharFrame()).toContain('const alpha = 1')

    // Opening selected alpha.ts, so it is already the row under the cursor.
    await press(t, input => void input.typeText('x'))
    expect(t.captureCharFrame()).toContain('Cut alpha.ts')

    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'src/alpha.ts'))).toBe(true)
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(false)
    expect(t.captureCharFrame()).toContain('Moved alpha.ts to src/')
    // The tab is still open and still shows the file, now at its new path.
    expect(t.captureCharFrame().split('\n')[0]).toContain('alpha.ts')
    expect(t.captureCharFrame()).toContain('const alpha = 1')
  })

  test('unsaved edits survive the move and save to the new path', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'alpha.ts')
    // Back into the editor to make the edit, then out again: in the tree those
    // letters are commands, not text.
    await press(t, input => input.pressTab())
    await press(t, input => void input.typeText('EDIT'))
    expect(t.captureCharFrame()).toContain('unsaved')
    await pressEscape(t)
    await settle(t, 80)

    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    await press(t, input => input.pressKey('s', { ctrl: true }))
    await settle(t)
    expect(readFileSync(join(dir, 'src/alpha.ts'), 'utf8')).toContain('EDIT')
    // Nothing recreated at the old path — that is what a stale buffer would do.
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(false)
  })

  test('dropping onto a file means the folder that file is in', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    // Expand src so keep.ts has a row of its own.
    await selectNth(t, 2)
    await press(t, input => input.pressEnter())
    await settle(t)

    // Rows now: lib, src, keep.ts, alpha.ts. Cut alpha.ts, paste onto keep.ts.
    await selectNth(t, 2)
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'src/alpha.ts'))).toBe(true)
  })

  test('Esc cancels a pending cut', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await selectNth(t, 3)
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressEscape())
    await settle(t, 80)
    expect(t.captureCharFrame()).toContain('Move cancelled')

    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)
    expect(t.captureCharFrame()).toContain('Nothing taken')
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(true)
  })
})

describe('moving a folder', () => {
  test('takes the tabs inside it along', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await open(t, 'keep.ts') // src/keep.ts
    expect(t.captureCharFrame()).toContain('const keep = 1')

    // keep.ts is selected; ← walks up to its folder, src.
    await press(t, input => input.pressArrow('left'))
    await press(t, input => input.pressArrow('left'))
    await settle(t)
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('up'))
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(existsSync(join(dir, 'lib/src/keep.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src'))).toBe(false)

    // The open buffer moved with it: saving must not recreate the old tree.
    await press(t, input => input.pressKey('s', { ctrl: true }))
    await settle(t)
    expect(existsSync(join(dir, 'src'))).toBe(false)
    expect(readFileSync(join(dir, 'lib/src/keep.ts'), 'utf8')).toBe('const keep = 1\n')
  })

  test('refuses to move into itself', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    await selectNth(t, 2) // src
    await press(t, input => void input.typeText('x'))
    await press(t, input => void input.typeText('p')) // still on src
    await settle(t)

    // A folder pasted onto itself is the same refusal as into a child of itself.
    expect(t.captureCharFrame()).toContain('into itself')
    expect(existsSync(join(dir, 'src/keep.ts'))).toBe(true)
  })

  test('refuses to move into a folder inside itself', async () => {
    const dir = fixture({ 'a/b/c.ts': 'x\n', 'other.ts': 'y\n' })
    const t = await launch(dir)
    await selectNth(t, 1) // a
    await press(t, input => input.pressEnter()) // expand
    await settle(t)
    await press(t, input => void input.typeText('x')) // cut a
    await press(t, input => input.pressArrow('down')) // onto a/b
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(t.captureCharFrame()).toContain('into itself')
    expect(existsSync(join(dir, 'a/b/c.ts'))).toBe(true)
  })

  test('reports a name that is already taken instead of clobbering it', async () => {
    const dir = fixture({ 'one/dup.ts': 'first\n', 'two/dup.ts': 'second\n' })
    const t = await launch(dir)
    await selectNth(t, 1) // one
    await press(t, input => input.pressEnter())
    await settle(t)
    await press(t, input => input.pressArrow('down')) // one/dup.ts
    await press(t, input => void input.typeText('x'))
    await press(t, input => input.pressArrow('down')) // two
    await press(t, input => void input.typeText('p'))
    await settle(t)

    expect(t.captureCharFrame()).toContain('already exists')
    expect(readFileSync(join(dir, 'two/dup.ts'), 'utf8')).toBe('second\n')
    expect(readFileSync(join(dir, 'one/dup.ts'), 'utf8')).toBe('first\n')
  })
})

describe('clicking a row', () => {
  /**
   * Screen row carrying exactly `name`, or -1. Matched on the label with the tree
   * glyphs stripped, not by substring — the panel header is the temp directory's
   * name, and a random one happily contains any letter you search for.
   */
  const rowOf = (t: Harness, name: string) =>
    t
      .captureCharFrame()
      .split('\n')
      .findIndex(
        row =>
          row
            .slice(0, 28)
            .replaceAll(/[│▾▸·]/g, '')
            .trim() === name,
      )

  test('selects and opens it, and moves nothing', async () => {
    const dir = fixture(PROJECT)
    const t = await launch(dir)
    const row = rowOf(t, 'alpha.ts')

    await t.mockMouse.click(4, row)
    await settle(t)

    expect(t.captureCharFrame()).toContain('const alpha = 1')
    expect(existsSync(join(dir, 'alpha.ts'))).toBe(true)
    expect(t.captureCharFrame()).not.toContain('Moved')
  })
})
