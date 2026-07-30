import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { CONFIG_FILE } from '../src/core/config'
import { fixture, launch, press, pressEscape, pressTimes, runCommand } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

const saved = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))

/**
 * Rows near the end of the page. `gotoRow` costs one flush per arrow key — it
 * has to read the frame to know when to stop — so a row 20 down is already a
 * second of rendering on an idle machine, and several under a loaded suite.
 */
const LATE_ROW = 15_000

/** Walk the settings page's selection down until it sits on `label`. */
async function gotoRow(t: Harness, label: string) {
  for (let step = 0; step < 30; step++) {
    const row = t
      .captureCharFrame()
      .split('\n')
      .find(line => line.includes(label))
    if (row?.includes('▌')) return
    await press(t, i => i.pressArrow('down'))
  }
  throw new Error(`row not reached: ${label}`)
}

/** Empty the editor's prefilled field. */
const clear = (t: Harness) => pressTimes(t, 60, i => i.pressBackspace())

test('a formatter is added from the page, no config.json involved', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('+ Add formatter…')
  await press(t, i => void i.typeText('add'))
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('ts,tsx = prettier --write'))
  await press(t, i => i.pressEnter())

  expect(saved().formatters).toEqual({ 'ts,tsx': ['prettier', '--write'] })
  const frame = t.captureCharFrame()
  expect(frame).toContain('1 configured')
  expect(frame).toContain('Formatter: ts,tsx = prettier --write')
})

test('the formatter field explains the syntax it wants', async () => {
  // Wide enough that the hint lines are not wrapped by the modal: the point of
  // the test is that they read as written.
  const t = await launch(fixture(PROJECT), {}, { width: 140, height: 30 })
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter()) // "+ Add formatter…" is the only option
  const frame = t.captureCharFrame()
  expect(frame).toContain('extensions = command')
  // The two things a command's author cannot guess: that the tool has to write
  // the file rather than print it, and what happens to the path.
  expect(frame).toContain('The tool must rewrite the file itself')
  expect(frame).toContain('Its path is appended, or replaces {}')
  expect(frame).toContain('Enter apply · Esc cancel')
  // The example command sits in the field itself, as its placeholder.
  expect(frame).toContain('prettier --write')
})

test('a formatter command can carry the {} token', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('css = stylelint --fix {} --quiet'))
  await press(t, i => i.pressEnter())

  expect(saved().formatters).toEqual({ css: ['stylelint', '--fix', '{}', '--quiet'] })
})

test('a command of nothing but the token is refused', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('ts = {}'))
  await press(t, i => i.pressEnter())

  // launch() never persists, so what the file holds is whatever an earlier test
  // in this process wrote — it just must not have gained the refused entry.
  expect(saved().formatters ?? {}).not.toHaveProperty('ts')
  expect(t.captureCharFrame()).toContain('needs a program')
})

test('an existing entry opens prefilled and edits in place', async () => {
  const t = await launch(fixture(PROJECT), { formatters: { ts: ['oxfmt'] } })
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('ts = oxfmt')
  await press(t, i => i.pressEnter()) // the entry is the first option
  await press(t, i => void i.typeText(' --check'))
  await press(t, i => i.pressEnter())

  expect(saved().formatters).toEqual({ ts: ['oxfmt', '--check'] })
})

test('an emptied entry is removed', async () => {
  const t = await launch(fixture(PROJECT), { formatters: { ts: ['oxfmt'] } })
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter())
  await clear(t)
  await press(t, i => i.pressEnter())

  expect(saved().formatters).toEqual({})
  expect(t.captureCharFrame()).toContain('Formatter for "ts" removed')
})

test('bad syntax warns and changes nothing', async () => {
  const t = await launch(fixture(PROJECT))
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter()) // "+ Add formatter…" is the only option
  await press(t, i => void i.typeText('prettier --write'))
  await press(t, i => i.pressEnter())

  expect(saved().formatters ?? {}).toEqual({})
  expect(t.captureCharFrame()).toContain('Formatter syntax: extensions = command')
})

test('Esc leaves the editor without applying', async () => {
  const t = await launch(fixture(PROJECT), { formatters: { ts: ['oxfmt'] } })
  await runCommand(t, 'Settings')
  await gotoRow(t, 'Formatters')
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText(' --junk'))
  await pressEscape(t)

  // Nothing was applied: launch never persists, so the file (if an earlier test
  // in this process wrote one) must not have picked the typed junk up.
  expect(JSON.stringify(saved().formatters ?? {})).not.toContain('--junk')
  // The page is still up, not closed by the Esc that closed the editor.
  expect(t.captureCharFrame()).toContain('Formatters')
})

test(
  'sidebar width takes a number or auto from the page',
  async () => {
    const t = await launch(fixture(PROJECT))
    await runCommand(t, 'Settings')
    await gotoRow(t, 'Sidebar width')
    await press(t, i => i.pressEnter())
    await clear(t)
    await press(t, i => void i.typeText('40'))
    await press(t, i => i.pressEnter())
    expect(saved().sidebarWidth).toBe(40)

    await press(t, i => i.pressEnter())
    await clear(t)
    await press(t, i => void i.typeText('auto'))
    await press(t, i => i.pressEnter())
    expect(saved().sidebarWidth).toBe('auto')
  },
  LATE_ROW,
)

test(
  'a server command is overridden and restored from the page',
  async () => {
    const t = await launch(fixture(PROJECT))
    await runCommand(t, 'Settings')
    await gotoRow(t, 'Server commands')
    await press(t, i => i.pressEnter())
    await press(t, i => void i.typeText('typescript'))
    await press(t, i => i.pressEnter())
    await clear(t)
    await press(t, i => void i.typeText('my-ls --stdio'))
    await press(t, i => i.pressEnter())
    expect(saved().lspServers).toEqual({ typescript: ['my-ls', '--stdio'] })
    expect(t.captureCharFrame()).toContain('1 custom')

    await press(t, i => i.pressEnter())
    await press(t, i => void i.typeText('typescript'))
    await press(t, i => i.pressEnter())
    await clear(t)
    await press(t, i => i.pressEnter())
    expect(saved().lspServers).toEqual({})
    expect(t.captureCharFrame()).toContain('back on its default command')
  },
  LATE_ROW,
)
