import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape } from './helpers'

const PROJECT = { 'src/main.ts': 'const a = 1\n', 'notes.md': '# hi\n' }

test('reopening a project restores tabs, active file and expanded folders', async () => {
  const dir = fixture(PROJECT)

  const first = await launch(dir)
  await press(first, i => i.pressArrow('down')) // src/
  await press(first, i => i.pressEnter()) // expand
  await press(first, i => i.pressArrow('down')) // src/main.ts
  await press(first, i => i.pressEnter()) // open
  await pressEscape(first)
  await press(first, i => i.pressArrow('down')) // notes.md
  await press(first, i => i.pressEnter()) // open

  const second = await launch(dir)
  const frame = second.captureCharFrame()
  expect(frame).toContain('main.ts') // tab restored
  expect(frame).toContain('notes.md') // tab restored
  expect(frame).toContain('# hi') // active file restored
  expect(frame).toContain('▾ src') // folder still expanded
})

test('files deleted since last time are dropped', async () => {
  const dir = fixture(PROJECT)

  const first = await launch(dir)
  await press(first, i => i.pressArrow('down'))
  await press(first, i => i.pressEnter())
  await press(first, i => i.pressArrow('down'))
  await press(first, i => i.pressEnter())
  expect(first.captureCharFrame()).toContain('main.ts')

  rmSync(join(dir, 'src/main.ts'))
  const second = await launch(dir)
  expect(second.captureCharFrame()).toContain('no open files')
})
