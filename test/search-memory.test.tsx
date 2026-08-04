import { expect, test } from 'bun:test'

import { fixture, launch, press, pressEscape, pressTimes, settle, untilFrame } from './helpers'
import type { Harness } from './helpers'

const FILE = ['const alpha = 1', 'const beta = 2', 'const alpha2 = 3', 'let alpha3 = 4', ''].join(
  '\n',
)
const PROJECT = { 'a.ts': FILE }

const SIZE = { width: 100, height: 30 }

async function openFileFromTree(t: Harness) {
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
}

const openSearch = (t: Harness) => press(t, i => i.pressKey('f', { ctrl: true }))

test('reopening the search carries the last query', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, i => void i.typeText('alpha'))
  await settle(t)
  await pressEscape(t)
  expect(t.captureCharFrame()).not.toContain('Search…')

  await openSearch(t)
  await settle(t)
  // The box comes back with the query still in it, results and all.
  expect(t.captureCharFrame()).toContain('alpha')
  expect(t.captureCharFrame()).toContain('const alpha2 = 3')
})

test('the remembered query is selected, so typing replaces it', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, i => void i.typeText('alpha'))
  await settle(t)
  await pressEscape(t)

  await openSearch(t)
  await press(t, i => void i.typeText('beta'))
  await settle(t)

  // Typing over a selected prefill replaces it — not `alphabeta`. The count is
  // what says so: the panel previews the whole file below the results, so the
  // other lines are on screen either way.
  const frame = t.captureCharFrame()
  expect(frame).not.toContain('alphabeta')
  expect(frame).toContain('1 of 1')
})

test('reopening lands on the row it was left on', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, i => void i.typeText('alpha'))
  await settle(t)
  // Walk to the third hit, then close without picking it.
  await pressTimes(t, 2, i => i.pressArrow('down'))
  await settle(t)
  await pressEscape(t)

  await openSearch(t)
  await settle(t)
  // Enter picks whatever is selected: the row we left on, `let alpha3 = 4`.
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'Ln 4, Col 5')
})

test('a selection beats the remembered query and starts from its first hit', async () => {
  const t = await launch(fixture(PROJECT), {}, SIZE)
  await openFileFromTree(t)

  await openSearch(t)
  await press(t, i => void i.typeText('alpha'))
  await settle(t)
  await pressTimes(t, 2, i => i.pressArrow('down'))
  await pressEscape(t)

  // `beta` selected in the editor is this moment's intent; it wins, and brings
  // no row back with it.
  await openSearch(t)
  await press(t, i => void i.typeText('beta'))
  await settle(t)
  await press(t, i => i.pressEnter())
  await untilFrame(t, 'Ln 2, Col 7')
})
