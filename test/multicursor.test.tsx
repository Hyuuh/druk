import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { nextOccurrence } from '../src/editor/multicursor'
import { fixture, launch, press, pressEscape } from './helpers'

test('nextOccurrence walks forward and wraps once', () => {
  const text = 'foo bar foo baz'
  expect(nextOccurrence(text, 'foo', 0)).toBe(0)
  expect(nextOccurrence(text, 'foo', 1)).toBe(8)
  expect(nextOccurrence(text, 'foo', 9)).toBe(0)
  expect(nextOccurrence(text, 'nope', 0)).toBeNull()
})

test('Ctrl+D adds a cursor and typing hits both', async () => {
  const dir = fixture({ 'a.ts': 'let x = 1\nlet y = 2\n' })
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  await press(t, i => i.pressKey('d', { ctrl: true })) // second "let"
  await press(t, i => void i.typeText('Z'))
  await press(t, i => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('Zlet x = 1\nZlet y = 2\n')
})

test('Escape drops the extra cursors', async () => {
  const dir = fixture({ 'a.ts': 'let x = 1\nlet y = 2\n' })
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  await press(t, i => i.pressKey('d', { ctrl: true }))
  await pressEscape(t)
  await press(t, i => void i.typeText('Z'))
  await press(t, i => i.pressKey('s', { ctrl: true }))

  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('Zlet x = 1\nlet y = 2\n')
})
