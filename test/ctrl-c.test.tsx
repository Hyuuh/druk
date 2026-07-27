import { describe, expect, test } from 'bun:test'

import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

const FILE = { 'a.ts': 'const alpha = 1\nconst beta = 2\n' }

async function openedFile(dir: string) {
  const t = await launch(dir)
  await press(t, input => input.pressKey('o', { ctrl: true }))
  await press(t, input => void input.typeText('a.ts'))
  await press(t, input => input.pressEnter())
  return t
}

const selectedText = (t: Harness) =>
  (
    t as unknown as { renderer: { getSelection: () => { getSelectedText: () => string } | null } }
  ).renderer
    .getSelection()
    ?.getSelectedText() ?? null

/** Count exits while keeping the process alive. */
async function exitsDuring(run: () => Promise<void>) {
  let exited = 0
  const realExit = process.exit
  // @ts-expect-error — swapped only for the duration of the call
  process.exit = () => {
    exited++
  }
  try {
    await run()
  } finally {
    process.exit = realExit
  }
  return exited
}

describe('Ctrl+C', () => {
  // The quit-for-real case destroys the renderer, which the harness shares across
  // launches in one process — so it has to run last or it blanks the frames below.

  test('asks first when a buffer is unsaved, rather than dropping the work', async () => {
    const t = await openedFile(fixture(FILE))
    await press(t, input => void input.typeText('EDIT'))
    expect(t.captureCharFrame()).toContain('EDITconst alpha = 1')

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    expect(exited).toBe(0)
    const frame = t.captureCharFrame()
    expect(frame).toContain('Unsaved changes')
    expect(frame).toContain('a.ts')
  })

  test('copies instead of quitting while text is selected', async () => {
    const t = await openedFile(fixture(FILE))
    await t.mockMouse.drag(34, 1, 44, 1)
    await settle(t)
    expect(selectedText(t)).toBeTruthy()

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    // The copy path owns the key here; quitting mid-copy would be the bug. The
    // frame is still live, which is what makes this assertion mean anything.
    expect(exited).toBe(0)
    expect(t.captureCharFrame()).toContain('const alpha = 1')
  })

  test('quits when nothing is selected', async () => {
    const t = await openedFile(fixture(FILE))
    expect(selectedText(t)).toBeNull()

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    expect(exited).toBe(1)
  })
})
