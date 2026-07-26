import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { launch, press, pressEscape } from './helpers'

/** A project with a real binary file next to a text one. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-'))
  writeFileSync(join(dir, '.DS_Store'), Buffer.from([0, 1, 2, 0, 3, 4]))
  writeFileSync(join(dir, 'main.ts'), 'const a = 1\n')
  return dir
}

test('opening a binary file explains why it cannot be shown', async () => {
  const t = await launch(project())
  await press(t, i => i.pressArrow('down')) // .DS_Store sorts first
  await press(t, i => i.pressEnter())

  const frame = t.captureCharFrame()
  expect(frame).toContain('This file cannot be shown')
  expect(frame).toContain('.DS_Store')
  expect(frame).toContain('binary')
})

test('a binary tab is never written back to disk', async () => {
  const dir = project()
  const before = readFileSync(join(dir, '.DS_Store'))
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('xxx'))
  await press(t, i => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, '.DS_Store'))).toEqual(before)
  expect(t.captureCharFrame()).toContain('not text')
})

test('text files still open normally afterwards', async () => {
  const t = await launch(project())
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await pressEscape(t)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  const frame = t.captureCharFrame()
  expect(frame).toContain('const a = 1')
  expect(frame).not.toContain('cannot be shown')
})
