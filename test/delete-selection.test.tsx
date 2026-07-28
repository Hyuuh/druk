import { describe, expect, test } from 'bun:test'

import { ui } from '../src/themes'
import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

interface Frame {
  lines: { spans: { text: string; bg?: { buffer: Uint8Array } }[] }[]
}

const hex = (bg?: { buffer: Uint8Array }) =>
  bg ? `#${Array.from(bg.buffer.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('')}` : ''

/** The tree row currently under the cursor, focused or not. */
function selectedRow(t: Harness): string {
  const marks = new Set([ui.treeSelectedBg.toLowerCase(), ui.treeFocusBg.toLowerCase()])
  for (const line of (t.captureSpans() as unknown as Frame).lines) {
    if (marks.has(hex(line.spans[0]?.bg))) {
      return line.spans
        .map(span => span.text)
        .join('')
        .trim()
    }
  }
  return ''
}

const project = { 'a.ts': 'a\n', 'b.ts': 'b\n', 'c.ts': 'c\n' }

/** Move to `name` in the tree, then delete it and confirm. */
async function deleteRow(t: Harness, downs: number) {
  for (let step = 0; step < downs; step++) await press(t, input => input.pressArrow('down'))
  await press(t, input => void input.typeText('d'))
  await press(t, input => input.pressEnter())
  await settle(t)
}

describe('deleting from the tree', () => {
  test('lands on the file that took its place', async () => {
    const t = await launch(fixture(project))
    await deleteRow(t, 2) // b.ts

    expect(selectedRow(t)).toContain('c.ts')
  })

  test('so the next arrow key carries on from there', async () => {
    const t = await launch(fixture(project))
    await deleteRow(t, 2) // b.ts, leaving a.ts and c.ts

    // Without a selection this used to jump back to the top of the tree.
    await press(t, input => input.pressArrow('up'))
    expect(selectedRow(t)).toContain('a.ts')
  })

  test('falls back to the last row when the last file goes', async () => {
    const t = await launch(fixture(project))
    await deleteRow(t, 3) // c.ts, the bottom row

    expect(selectedRow(t)).toContain('b.ts')
  })

  test('an empty project leaves nothing selected, and does not crash', async () => {
    const t = await launch(fixture({ 'only.ts': 'x\n' }))
    await deleteRow(t, 1)

    expect(selectedRow(t)).toBe('')
    await press(t, input => input.pressArrow('down'))
    expect(t.captureCharFrame()).toContain('explorer')
  })

  test('deleting an expanded folder lands after everything it held', async () => {
    const t = await launch(fixture({ 'src/one.ts': '1\n', 'src/two.ts': '2\n', 'z.ts': 'z\n' }))
    await press(t, input => input.pressArrow('down')) // src/
    await press(t, input => input.pressEnter()) // expand it
    await deleteRow(t, 0) // still on src/, delete the folder and its files

    expect(selectedRow(t)).toContain('z.ts')
  })
})
