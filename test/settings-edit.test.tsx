import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { CONFIG_FILE } from '../src/core/config'
import { fixture, launch, press, pressEscape, pressTimes, runCommand } from './helpers'
import type { Harness } from './helpers'

const PROJECT = { 'a.ts': 'const a = 1\n' }

const saved = () => JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))

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

test('sidebar width takes a number or auto from the page', async () => {
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
})

test('a server command is overridden and restored from the page', async () => {
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
})
