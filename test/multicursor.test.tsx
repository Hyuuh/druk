import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { nextMatch, wordRangeAt } from '../src/editor/multicursor'
import { fixture, launch, press, pressEscape } from './helpers'
import type { Harness } from './helpers'

async function openedFile(dir: string) {
  const t = await launch(dir)
  await press(t, input => input.pressArrow('down'))
  await press(t, input => input.pressEnter())
  return t
}

const addCursor = (t: Harness) => press(t, input => input.pressKey('d', { ctrl: true }))

describe('finding occurrences', () => {
  test('wordRangeAt covers the whole word, from anywhere inside it', () => {
    const text = 'let value = 1'
    expect(wordRangeAt(text, 0)).toEqual({ start: 0, end: 3 })
    expect(wordRangeAt(text, 2)).toEqual({ start: 0, end: 3 })
    // Just past the last character still counts as inside.
    expect(wordRangeAt(text, 3)).toEqual({ start: 0, end: 3 })
    expect(wordRangeAt(text, 4)).toEqual({ start: 4, end: 9 })
    expect(wordRangeAt('  ', 0)).toBeNull()
  })

  test('nextMatch walks forward and wraps once', () => {
    const text = 'foo bar foo baz'
    expect(nextMatch(text, 'foo', 0)).toEqual({ start: 0, end: 3 })
    expect(nextMatch(text, 'foo', 1)).toEqual({ start: 8, end: 11 })
    expect(nextMatch(text, 'foo', 12)).toEqual({ start: 0, end: 3 })
    expect(nextMatch(text, 'nope', 0)).toBeNull()
  })
})

describe('Ctrl+D', () => {
  test('selects the word first, then each further occurrence', async () => {
    const dir = fixture({ 'a.ts': 'let x = 1\nlet y = 2\nlet z = 3\n' })
    const t = await openedFile(dir)

    await addCursor(t) // selects the first "let"
    await addCursor(t)
    await addCursor(t)
    await press(t, input => void input.typeText('var'))
    await press(t, input => input.pressKey('s', { ctrl: true }))

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('var x = 1\nvar y = 2\nvar z = 3\n')
  })

  test('the selections are painted, not just the one the buffer owns', async () => {
    const t = await openedFile(fixture({ 'a.ts': 'let x = 1\nlet y = 2\n' }))
    await addCursor(t)
    await addCursor(t)

    const spans = t.captureSpans() as unknown as {
      lines: { spans: { text: string; bg?: { buffer: Uint8Array } }[] }[]
    }
    const highlighted = spans.lines.flatMap(line =>
      line.spans.filter(span => span.text === 'let' && span.bg).map(span => span.text),
    )
    expect(highlighted.length).toBeGreaterThan(1)
  })

  test('typing keeps going at every caret after the replacement', async () => {
    const dir = fixture({ 'a.ts': 'let x = 1\nlet y = 2\n' })
    const t = await openedFile(dir)
    await addCursor(t)
    await addCursor(t)
    await press(t, input => void input.typeText('ab'))
    await press(t, input => input.pressKey('s', { ctrl: true }))

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('ab x = 1\nab y = 2\n')
  })

  test('backspace deletes at every caret', async () => {
    const dir = fixture({ 'a.ts': 'let x = 1\nlet y = 2\n' })
    const t = await openedFile(dir)
    await addCursor(t)
    await addCursor(t)
    await press(t, input => void input.typeText('Q')) // replaces both words
    await press(t, input => input.pressBackspace())
    await press(t, input => input.pressKey('s', { ctrl: true }))

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe(' x = 1\n y = 2\n')
  })

  test('Esc drops the extra selections and leaves the text alone', async () => {
    const dir = fixture({ 'a.ts': 'let x = 1\nlet y = 2\n' })
    const t = await openedFile(dir)
    await addCursor(t)
    await addCursor(t)
    await pressEscape(t)
    await press(t, input => void input.typeText('Z'))
    await press(t, input => input.pressKey('s', { ctrl: true }))

    // Only the last selection's caret survives, collapsed to its end.
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('let x = 1\nletZ y = 2\n')
  })

  test('does nothing when the cursor is not inside a word', async () => {
    const dir = fixture({ 'a.ts': '   \n' })
    const t = await openedFile(dir)
    await addCursor(t)
    await press(t, input => void input.typeText('Z'))
    await press(t, input => input.pressKey('s', { ctrl: true }))

    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('Z   \n')
  })
})
