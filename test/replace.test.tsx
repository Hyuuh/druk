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

test('the query is matched literally, not as a regex', () => {
  expect(replaceAll('a.b axb', 'a.b', 'Z')).toBe('Z axb')
  expect(replaceAll('cost $5', '$5', 'free')).toBe('cost free')
})

test('the replacement is inserted literally', () => {
  expect(replaceAll('foo', 'foo', '$&$1')).toBe('$&$1')
})

test('a character that changes length when lowercased does not shift the match', () => {
  // U+0130 lowercases to two code units, so offsets from a lowercased copy drift.
  expect(replaceAll('İstanbul FOO', 'foo', 'BAR')).toBe('İstanbul BAR')
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
