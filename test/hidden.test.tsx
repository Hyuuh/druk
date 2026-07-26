import { expect, test } from 'bun:test'

import { DEFAULTS } from '../src/core/config'
import { fixture, launch, press } from './helpers'

const PROJECT = { 'src/main.ts': 'const a = 1\n', '.DS_Store': 'junk\n', '.gitignore': 'dist\n' }

test('everything is listed by default', async () => {
  const frame = (await launch(fixture(PROJECT))).captureCharFrame()
  expect(frame).toContain('.gitignore')
  expect(frame).toContain('.DS_Store')
})

test('the palette can hide system files', async () => {
  const t = await launch(fixture(PROJECT))
  await press(t, i => i.pressKey('p', { ctrl: true }))
  await press(t, i => void i.typeText('Hide them'))
  await press(t, i => i.pressEnter())
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('.DS_Store')
  expect(frame).toContain('.gitignore')
})

test('showHidden: false in the config hides them from the start', async () => {
  const t = await launch(fixture(PROJECT), { ...DEFAULTS, showHidden: false })
  expect(t.captureCharFrame()).not.toContain('.DS_Store')
})
