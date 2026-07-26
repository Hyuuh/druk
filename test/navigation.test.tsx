import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press } from './helpers'

const PROJECT = {
  'src/deeply/nested/target.ts': 'const found = 1\n',
  'src/other.ts': 'const other = 2\n',
  'notes.md': 'one\ntwo\nthree\nfour\nfive\n',
}

test('the file picker opens a file by fuzzy path', async () => {
  const t = await launch(fixture(PROJECT))
  await press(t, i => i.pressKey('o', { ctrl: true }))
  expect(t.captureCharFrame()).toContain('Open file')

  await press(t, i => void i.typeText('target'))
  await press(t, i => i.pressEnter())

  const frame = t.captureCharFrame()
  expect(frame).toContain('const found = 1')
  expect(frame).toContain('target.ts')
})

test('go to line moves the cursor there', async () => {
  const dir = fixture(PROJECT)
  const t = await launch(dir)
  await press(t, i => i.pressKey('o', { ctrl: true }))
  await press(t, i => void i.typeText('notes'))
  await press(t, i => i.pressEnter())

  await press(t, i => i.pressKey('g', { ctrl: true }))
  await press(t, i => void i.typeText('4'))
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('X'))
  await press(t, i => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('one\ntwo\nthree\nXfour\nfive\n')
})
