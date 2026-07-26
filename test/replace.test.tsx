import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { replaceAll } from '../src/core/search'
import { fixture, launch, press } from './helpers'

test('replaceAll swaps every occurrence, ignoring case', () => {
  expect(replaceAll('a Foo b foo c', 'foo', 'bar')).toBe('a bar b bar c')
  expect(replaceAll('nothing here', 'foo', 'bar')).toBe('nothing here')
  expect(replaceAll('abc', '', 'x')).toBe('abc')
})

test('replace all rewrites the open file', async () => {
  const dir = fixture({ 'a.ts': 'const old = 1\nconst old2 = old + 1\n' })
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  await press(t, i => i.pressKey('f', { ctrl: true }))
  await press(t, i => void i.typeText('old'))
  await press(t, i => i.pressTab()) // switch to the replacement field
  await press(t, i => void i.typeText('fresh'))
  await press(t, i => i.pressEnter())
  await press(t, i => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe(
    'const fresh = 1\nconst fresh2 = fresh + 1\n',
  )
})
