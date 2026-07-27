import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launch, press, settle } from './helpers'

/** A project with a real binary file next to a text one. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-'))
  writeFileSync(join(dir, '.DS_Store'), Buffer.from([0, 1, 2, 0, 3, 4]))
  writeFileSync(join(dir, 'main.ts'), 'const a = 1\n')
  return dir
}

test('a binary file is listed but does not open', async () => {
  const t = await launch(project())
  expect(t.captureCharFrame()).toContain('.DS_Store')

  await press(t, i => i.pressArrow('down')) // .DS_Store sorts first
  await press(t, i => i.pressEnter())
  await settle(t)

  const frame = t.captureCharFrame()
  // Over the pane, where the file would have appeared — not a footnote in the bar.
  expect(frame).toContain('.DS_Store cannot be shown')
  expect(frame).toContain('binary')
  // Still no tab and no buffer: the refusal is drawn, not opened.
  expect(frame.split('\n')[0]).not.toContain('.DS_Store')
})

test('the refusal covers the file that was open, and leaves when a key is pressed', async () => {
  const t = await launch(project())
  await press(t, i => i.pressKey('o', { ctrl: true }))
  await press(t, i => void i.typeText('main.ts'))
  await press(t, i => i.pressEnter())
  await settle(t)
  expect(t.captureCharFrame()).toContain('const a = 1')

  await press(t, i => i.pressKey('o', { ctrl: true }))
  await press(t, i => void i.typeText('.DS_Store'))
  await press(t, i => i.pressEnter())
  await settle(t)

  // The point of drawing it here: the open file is not still sitting there looking
  // like the thing that was asked for.
  expect(t.captureCharFrame()).not.toContain('const a = 1')
  expect(t.captureCharFrame()).toContain('cannot be shown')

  await press(t, i => i.pressArrow('down'))
  await settle(t)
  expect(t.captureCharFrame()).toContain('const a = 1')
  expect(t.captureCharFrame()).not.toContain('cannot be shown')
})

test('it can never be written back to disk, because it is never a buffer', async () => {
  const dir = project()
  const before = readFileSync(join(dir, '.DS_Store'))
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  // Typing goes nowhere in particular: there is nothing open to type into.
  await press(t, i => void i.typeText('xxx'))
  await press(t, i => i.pressKey('s', { ctrl: true }))
  await settle(t)

  expect(readFileSync(join(dir, '.DS_Store'))).toEqual(before)
})

test('text files still open normally afterwards', async () => {
  const t = await launch(project())
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter()) // refused
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await settle(t)

  const frame = t.captureCharFrame()
  // The refusal went away with the next key, so the file is visible again.
  expect(frame).toContain('const a = 1')
  expect(frame).not.toContain('cannot be shown')
  expect(frame.split('\n')[0]).toContain('main.ts')
  expect(frame.split('\n')[0]).not.toContain('.DS_Store')
})
