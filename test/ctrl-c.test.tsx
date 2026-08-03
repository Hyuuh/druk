import { describe, expect, test } from 'bun:test'

import { fixture, launch, openFile, press, runCommand, settle } from './helpers'
import type { Harness } from './helpers'

const FILE = { 'a.ts': 'const alpha = 1\nconst beta = 2\n' }

async function openedFile(dir: string) {
  const t = await launch(dir)
  await openFile(t, 'a.ts')
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
    await t.mockMouse.drag(35, 1, 45, 1)
    await settle(t)
    expect(selectedText(t)).toBeTruthy()

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    // The copy path owns the key here; quitting mid-copy would be the bug. The
    // frame is still live, which is what makes this assertion mean anything.
    expect(exited).toBe(0)
    expect(t.captureCharFrame()).toContain('const alpha = 1')
  })

  // The editor keeps the focus slot while a page or a viewer is drawn over it, but
  // its textarea has stopped taking keys — so deferring Ctrl+C to it on the focus
  // slot alone left the key owned by nobody. The unsaved edit is what makes these
  // assertable: the prompt proves the quit path ran without tearing the renderer
  // down, which the real-quit cases below have to be last to do.

  test('still quits with a page over the editor', async () => {
    const t = await openedFile(fixture(FILE))
    await press(t, input => void input.typeText('EDIT'))
    await runCommand(t, 'Settings')

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    expect(exited).toBe(0)
    expect(t.captureCharFrame()).toContain('Unsaved changes')
  })

  test('still quits with a file rendered instead of edited', async () => {
    const t = await launch(fixture({ 'a.md': '# Title\n' }))
    await openFile(t, 'a.md')
    await press(t, input => void input.typeText('EDIT'))
    await runCommand(t, 'Markdown: rendered / source')

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    expect(exited).toBe(0)
    expect(t.captureCharFrame()).toContain('Unsaved changes')
  })

  test('quits when nothing is selected', async () => {
    const t = await openedFile(fixture(FILE))
    expect(selectedText(t)).toBeNull()

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    expect(exited).toBe(1)
  })

  // Last: no buffer exists to prompt over, so this one quits for real. The welcome
  // screen holds the editor's focus slot with no textarea behind it at all.
  test('quits from the welcome screen', async () => {
    const t = await launch(fixture(FILE))
    await runCommand(t, 'Toggle sidebar')
    await settle(t)

    const exited = await exitsDuring(() => press(t, input => input.pressKey('c', { ctrl: true })))

    expect(exited).toBe(1)
  })
})
