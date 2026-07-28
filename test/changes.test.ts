import { describe, expect, test } from 'bun:test'

import type { LineChange } from '../src/core/git'
import { changeRows } from '../src/editor/changes'

const marks = (entries: Array<[number, LineChange]>) => new Map<number, LineChange>(entries)

describe('git changes down the track', () => {
  test('a changed line marks the row that stands for it', () => {
    const rows = changeRows(marks([[0, 'added']]), 100, 10)

    expect(rows[0]).toBe('added')
    expect(rows.filter(Boolean)).toHaveLength(1)
  })

  test('the whole file is covered, not just the visible part', () => {
    // Line 950 of 1000 belongs near the bottom of a 20-row track — the point of
    // the column is seeing changes you would have to scroll to find.
    const rows = changeRows(marks([[950, 'modified']]), 1000, 20)

    expect(rows.at(-1)).toBe('modified')
    expect(rows[0]).toBeUndefined()
  })

  test('the strongest change wins when a row covers several lines', () => {
    const rows = changeRows(
      marks([
        [0, 'added'],
        [1, 'deleted'],
        [2, 'modified'],
      ]),
      30,
      10,
    )

    expect(rows[0]).toBe('deleted')
  })

  test('an unchanged file leaves an empty track', () => {
    expect(changeRows(new Map(), 100, 10).some(Boolean)).toBe(false)
  })

  test('lines outside the file are ignored rather than clamped onto a row', () => {
    // A stale diff can name a line past the end after an edit shortens the file.
    const rows = changeRows(marks([[500, 'added']]), 100, 10)

    expect(rows.some(Boolean)).toBe(false)
  })

  test('nothing to draw on is an empty result, not a crash', () => {
    expect(changeRows(marks([[1, 'added']]), 100, 0)).toEqual([])
    expect(changeRows(marks([[1, 'added']]), 0, 10).some(Boolean)).toBe(false)
  })
})
