import { describe, expect, test } from 'bun:test'

import { DEFAULTS } from '../src/core/config'
import { fixture, launch, press } from './helpers'

const PROJECT = {
  'dir/inside.ts': 'const inside = 1\n',
  'a.ts': 'const a = 1\n',
  'b.ts': 'const b = 2\n',
}

// Rows: dir, a.ts, b.ts.
describe('h/j/k/l in the tree (vim mode)', () => {
  test('j and k move the selection like the arrows', async () => {
    const t = await launch(fixture(PROJECT), { ...DEFAULTS, vim: true })

    await press(t, i => void i.typeText('j'))
    await press(t, i => void i.typeText('j'))
    await press(t, i => void i.typeText('j'))
    await press(t, i => void i.typeText('k'))
    await press(t, i => i.pressEnter())

    expect(t.captureCharFrame()).toContain('const a = 1')
  })

  test('l expands a folder and h collapses it', async () => {
    const t = await launch(fixture(PROJECT), { ...DEFAULTS, vim: true })

    await press(t, i => void i.typeText('j'))
    await press(t, i => void i.typeText('l'))
    expect(t.captureCharFrame()).toContain('inside.ts')

    await press(t, i => void i.typeText('h'))
    expect(t.captureCharFrame()).not.toContain('inside.ts')
  })

  test('without vim mode, j leaves the selection alone', async () => {
    const t = await launch(fixture(PROJECT))

    await press(t, i => void i.typeText('j'))
    await press(t, i => void i.typeText('j'))
    await press(t, i => i.pressEnter())

    expect(t.captureCharFrame()).not.toContain('const a = 1')
  })
})
