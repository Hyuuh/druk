import { describe, expect, test } from 'bun:test'

import { unifiedDiff } from '../src/core/diff'
import {
  enclosingScope,
  layoutDiff,
  movedLines,
  parseHunks,
  splitLines,
  wordRanges,
} from '../src/core/diffModel'
import type { GapRow, LineRow, PaneRow } from '../src/core/diffModel'

const numbered = (count: number, at = 1) =>
  Array.from({ length: count }, (_, i) => `line ${i + at}`)

function layout(
  oldText: string,
  newText: string,
  view: 'unified' | 'split' = 'unified',
  expanded: number[] = []
) {
  const diff = unifiedDiff('a.ts', oldText, newText)
  return layoutDiff({
    complete: !diff.truncated,
    expanded: new Set(expanded),
    hunks: parseHunks(diff.patch),
    newLines: splitLines(newText),
    oldLines: splitLines(oldText),
    view,
  })
}

const describeRow = (row: PaneRow) =>
  row.kind === 'gap'
    ? `gap ${row.count}`
    : row.kind === 'pad'
      ? 'pad'
      : `${row.type} ${row.side}:${row.line}`

describe('parseHunks', () => {
  test('reads both sides of every hunk with 0-based line indexes', () => {
    const hunks = parseHunks(
      ['@@ -2,3 +2,3 @@', ' b', '-c', '+C', ' d', '@@ -0,0 +1,1 @@', '+x'].join(
        '\n'
      )
    )
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({
      newEnd: 4,
      newStart: 1,
      oldEnd: 4,
      oldStart: 1,
    })
    expect(hunks[0]!.lines.map((l) => l.kind)).toEqual([
      'same',
      'del',
      'add',
      'same',
    ])
    expect(hunks[1]).toMatchObject({ newStart: 0, oldEnd: 0, oldStart: 0 })
  })
})

describe('layoutDiff', () => {
  test('folds the unchanged stretches between, before and after the hunks', () => {
    const before = numbered(30)
    const after = [...before]
    after[1] = 'changed 2'
    after[20] = 'changed 21'
    const out = layout(`${before.join('\n')}\n`, `${after.join('\n')}\n`)
    const gaps = out.left.filter((row): row is GapRow => row.kind === 'gap')
    // Hunk one is lines 1–5; hunk two 18–24; then the tail 25–30.
    expect(gaps.map((gap) => gap.count)).toEqual([12, 6])
    expect(out.hunkRows).toHaveLength(2)
    expect(describeRow(out.left[out.hunkRows[1]!]!)).toBe('gap 12')
  })

  test('an opened gap becomes the context rows it stood for', () => {
    const before = numbered(30)
    const after = [...before]
    after[20] = 'changed 21'
    const text = (lines: string[]) => `${lines.join('\n')}\n`
    const shut = layout(text(before), text(after))
    expect(describeRow(shut.left[0]!)).toBe('gap 17')
    const open = layout(text(before), text(after), 'unified', [0])
    expect(open.left.some((row) => row.kind === 'gap' && row.gap === 0)).toBe(
      false
    )
    expect(describeRow(open.left[0]!)).toBe('same new:0')
  })

  test('split pads the shorter side of a change block row for row', () => {
    const out = layout('a\nb\nc\n', 'a\nB\nX\nY\nc\n', 'split')
    expect(out.left.map(describeRow)).toEqual([
      'same old:0',
      'del old:1',
      'pad',
      'pad',
      'same old:2',
    ])
    expect(out.right!.map(describeRow)).toEqual([
      'same new:0',
      'add new:1',
      'add new:2',
      'add new:3',
      'same new:4',
    ])
  })

  test('a paired change carries the words that differ', () => {
    const out = layout('const total = a + b\n', 'const total = a - b\n')
    const [del, add] = out.left as LineRow[]
    expect(del!.words).toEqual([[16, 17]])
    expect(add!.words).toEqual([[16, 17]])
  })
})

describe('wordRanges', () => {
  test('joins changed words separated only by whitespace', () => {
    const ranges = wordRanges('call(one two, x)', 'call(three four, x)')!
    expect(ranges.new).toEqual([[5, 15]])
  })

  test('unrelated lines get no word ranges', () => {
    expect(wordRanges('import a from "b"', 'return 42')).toBeNull()
  })
})

describe('enclosingScope', () => {
  test('names the nearest less indented line above', () => {
    const lines = [
      'export function outer() {',
      '  const a = 1',
      '',
      '  if (a) {',
      '    return a',
      '  }',
      '  return 2',
      '}',
    ]
    expect(enclosingScope(lines, 4)).toBe('if (a) {')
    expect(enclosingScope(lines, 6)).toBe('export function outer() {')
    expect(enclosingScope(lines, 0)).toBeNull()
  })
})

describe('movedLines', () => {
  test('a block deleted in one place and added in another is moved', () => {
    const block = ['function helper(value) {', '  return value * 2', '}']
    const rest = numbered(6)
    const before = [...block, ...rest]
    const after = [...rest, ...block]
    const diff = unifiedDiff(
      'a.ts',
      `${before.join('\n')}\n`,
      `${after.join('\n')}\n`
    )
    const moved = movedLines(parseHunks(diff.patch), before, after)
    expect([...moved.old]).toEqual([0, 1, 2])
    expect([...moved.new]).toEqual([6, 7, 8])
  })

  test('short lines are never called moved', () => {
    const before = ['a', '}', 'b']
    const after = ['b', '}', 'a']
    const diff = unifiedDiff(
      'a.ts',
      `${before.join('\n')}\n`,
      `${after.join('\n')}\n`
    )
    const moved = movedLines(parseHunks(diff.patch), before, after)
    expect(moved.old.size).toBe(0)
  })
})
