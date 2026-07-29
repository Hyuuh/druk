import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const alpha = 1\nconst beta = alpha + 1\n' }

async function withOpenFile() {
  const t = await launch(fixture(PROJECT))
  await openFile(t, 'a.ts')
  return t
}

/** Drag across `word` on the editor's first row. */
async function selectOnFirstRow(t: Harness, word: string) {
  // Found from the frame: the editor's first column moves with the sidebar width.
  const row = t.captureCharFrame().split('\n')[1]!
  const from = row.indexOf(word)
  await t.mockMouse.drag(from, 1, from + word.length, 1)
  await settle(t)
}

describe('search opens on what is selected', () => {
  test('a selected word is already typed in, with its matches listed', async () => {
    const t = await withOpenFile()
    await selectOnFirstRow(t, 'alpha')

    await press(t, input => input.pressKey('f', { ctrl: true }))
    const frame = t.captureCharFrame()
    expect(frame).toContain('Search in file')
    expect(frame).toContain('alpha')
    // Both occurrences found, so the count is there without a keystroke.
    expect(frame).toContain('1 of 2')
  })

  test('project search takes it too', async () => {
    const t = await withOpenFile()
    await selectOnFirstRow(t, 'alpha')

    await press(t, input => input.pressKey('r', { ctrl: true }))
    await settle(t, 200)
    expect(t.captureCharFrame()).toContain('Search in project')
    expect(t.captureCharFrame()).toContain('1 of 2')
  })

  test('a selection made with Shift+arrows counts as much as a drag', async () => {
    const t = await withOpenFile()
    for (let i = 0; i < 5; i++) t.mockInput.pressArrow('right', { shift: true })
    await settle(t)

    await press(t, input => input.pressKey('f', { ctrl: true }))
    // "const" opens 2 matches; the point is that the field was not left empty.
    expect(t.captureCharFrame()).not.toContain('Type at least 2 characters')
    expect(t.captureCharFrame()).toContain('1 of 2')
  })

  test('a selection spanning lines is left behind — it would match nothing', async () => {
    const t = await withOpenFile()
    const row = t.captureCharFrame().split('\n')[1]!
    const from = row.indexOf('const')
    await t.mockMouse.drag(from, 1, from + 6, 2)
    await settle(t)

    await press(t, input => input.pressKey('f', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Type at least 2 characters')
  })

  test('with nothing selected the field is empty, as before', async () => {
    const t = await withOpenFile()

    await press(t, input => input.pressKey('f', { ctrl: true }))
    expect(t.captureCharFrame()).toContain('Type at least 2 characters')
  })
})
