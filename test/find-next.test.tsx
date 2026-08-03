import { expect, test } from 'bun:test'

import { fixture, launch, press, pressEscape, runCommand, settle, untilFrame } from './helpers'
import type { Harness } from './helpers'

const FILE = ['const alpha = 1', 'const beta = 2', 'const alpha2 = 3', 'let alpha3 = 4', ''].join(
  '\n',
)
const PROJECT = { 'a.ts': FILE }

const SIZE = { width: 100, height: 30 }

/** Open the file, search for `query`, close the panel again. */
async function searched(t: Harness, query: string) {
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter()) // open a.ts from the tree
  await press(t, i => i.pressKey('f', { ctrl: true }))
  await press(t, i => void i.typeText(query))
  await settle(t)
  await pressEscape(t)
}

test('find next walks the last search from the cursor and wraps', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await searched(t, 'alpha')

  await runCommand(t, 'Find next')
  await untilFrame(t, '1 of 3') // the panel leaves the cursor at 1:1; the first hit is after it
  expect(t.captureCharFrame()).toContain('Ln 1, Col 7')

  await runCommand(t, 'Find next')
  await untilFrame(t, '2 of 3')
  expect(t.captureCharFrame()).toContain('Ln 3, Col 7')

  await runCommand(t, 'Find next')
  await untilFrame(t, '3 of 3')
  await runCommand(t, 'Find next')
  await untilFrame(t, '1 of 3') // wrapped
  expect(t.captureCharFrame()).toContain('Ln 1, Col 7')
})

test('find previous mirrors it, wrapping backward', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await searched(t, 'alpha')

  await runCommand(t, 'Find previous')
  await untilFrame(t, '3 of 3') // nothing before 1:1 → wraps to the last hit
  expect(t.captureCharFrame()).toContain('Ln 4, Col 5')
})

test('a flag toggled after the last keystroke is remembered', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressKey('f', { ctrl: true }))
  await press(t, i => void i.typeText('ALPHA'))
  await press(t, i => i.pressKey('c', { ctrl: true })) // case-sensitive on, after typing
  await settle(t)
  await pressEscape(t)

  await runCommand(t, 'Find next')
  await untilFrame(t, 'No matches') // ALPHA case-sensitively matches nothing
})

test('never searched and nothing selected refuses gently', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  await runCommand(t, 'Find next')
  await untilFrame(t, 'No search to repeat')
  expect(t.captureCharFrame()).toContain('Ln 1, Col 1')
})
