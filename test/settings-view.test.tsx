import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { CONFIG_FILE } from '../src/core/config'
import { fixture, launch, press, pressEscape, runCommand, toggleSetting } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

async function openA(t: Harness) {
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
}

test('the palette opens the settings page over the editor slot', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  const frame = t.captureCharFrame()
  expect(frame).toContain('Settings')
  expect(frame).toContain('Theme')
  expect(frame).toContain('Vim mode')
  expect(frame).toContain('Diff layout')
  // The tree stays put beside the page.
  expect(frame).toContain('a.ts')
})

test('Enter flips a boolean, the row and the config file follow', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressArrow('down')) // Theme → Vim mode
  await press(t, i => i.pressEnter())
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('Vim mode'))!
  expect(row.trimEnd().endsWith('on')).toBe(true)
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim).toBe(true)
  // Flip it back: the page is still up and the same key keeps working.
  await press(t, i => i.pressEnter())
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim).toBe(false)
})

test('arrows cycle a multi-value setting in both directions', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressArrow('down')) // Tab size
  const size = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('Tab size'))!
      .trimEnd()
  expect(size().endsWith('2')).toBe(true)
  await press(t, i => i.pressArrow('right'))
  expect(size().endsWith('4')).toBe(true)
  await press(t, i => i.pressArrow('left'))
  expect(size().endsWith('2')).toBe(true)
  // Wraps below the first entry instead of dying.
  await press(t, i => i.pressArrow('left'))
  expect(size().endsWith('8')).toBe(true)
})

test('the theme row applies live and reports in the status bar', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressArrow('right'))
  expect(t.captureCharFrame()).toContain('Theme:')
})

test('Esc closes the page back to the file', async () => {
  const t = await launch(fixture(PROJECT))
  await openA(t)
  await runCommand(t, 'Settings')
  expect(t.captureCharFrame()).toContain('Vim mode')
  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Vim mode')
  expect(frame).toContain('const a = 1')
})

test('Ctrl+W closes the page before any file tab', async () => {
  const t = await launch(fixture(PROJECT))
  await openA(t)
  await runCommand(t, 'Settings')
  await press(t, i => i.pressKey('w', { ctrl: true }))
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Vim mode')
  // The tab survived — only the page went.
  expect(frame).toContain('const a = 1')
})

test('opening a file from the fuzzy picker closes the page', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressKey('o', { ctrl: true }))
  await press(t, i => void i.typeText('a.ts'))
  await press(t, i => i.pressEnter())
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Vim mode')
  expect(frame).toContain('const a = 1')
})

test('the toggleSetting helper reaches a row by label', async () => {
  const t = await launch(fixture(PROJECT))
  await toggleSetting(t, 'Trim trailing whitespace on save')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).trimOnSave).toBe(true)
})

test('Enter on the theme row opens a filterable list and picks by search', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressEnter()) // Theme is the first row
  const frame = t.captureCharFrame()
  expect(frame).toContain('Type to filter')
  expect(frame).toContain('GitHub Dark')
  // Nord is far down a 26-entry list — the filter is how you reach it at all.
  expect(frame).not.toContain('Nord')
  await press(t, i => void i.typeText('nord'))
  expect(t.captureCharFrame()).toContain('Nord')
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).theme).toBe('nord')
})

test('the list starts on the value in force, so bare Enter changes nothing', async () => {
  const t = await launch(fixture(PROJECT), { theme: 'gruvbox' })
  await runCommand(t, 'Settings')
  const theme = () =>
    t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes('Theme'))!
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(theme()).toContain('Gruvbox')
})

test('Esc backs out of the list to the page without changing anything', async () => {
  const t = await launch(fixture(PROJECT), { theme: 'nord' })
  await runCommand(t, 'Settings')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressArrow('down'))
  await pressEscape(t)
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('Type to filter')
  expect(frame).toContain('Vim mode') // still on the page
  expect(frame.split('\n').find(line => line.includes('Theme'))!).toContain('Nord')
})

test('booleans still flip on Enter without a list', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await press(t, i => i.pressArrow('down')) // Vim mode
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).not.toContain('Type to filter')
  expect(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')).vim).toBe(true)
})
