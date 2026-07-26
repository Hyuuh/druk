import { describe, expect, test } from 'bun:test'

import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

interface SelectionHost {
  renderer?: { getSelection: () => { getSelectedText: () => string } | null }
}

const selected = (t: Harness) =>
  (t as unknown as SelectionHost).renderer?.getSelection()?.getSelectedText() ?? null

async function withOpenFile() {
  const t = await launch(fixture({ 'a.ts': 'const alpha = 1\nconst beta = 2\n' }))
  await press(t, input => input.pressKey('o', { ctrl: true }))
  await press(t, input => void input.typeText('a.ts'))
  await press(t, input => input.pressEnter())
  return t
}

describe('mouse selection', () => {
  test('dragging in the editor still selects, so Ctrl+C has something to copy', async () => {
    const t = await withOpenFile()
    await t.mockMouse.drag(34, 1, 44, 1)
    await settle(t)
    expect(selected(t)).toContain('alpha')
  })

  test('dragging over the file tree selects nothing', async () => {
    const t = await withOpenFile()
    await t.mockMouse.drag(2, 3, 10, 3)
    await settle(t)
    expect(selected(t)).toBeNull()
  })

  test('dragging over the tab bar selects nothing', async () => {
    const t = await withOpenFile()
    await t.mockMouse.drag(2, 0, 10, 0)
    await settle(t)
    expect(selected(t)).toBeNull()
  })
})
