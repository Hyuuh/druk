import { describe, expect, test } from 'bun:test'

import { unifiedDiff } from '../src/core/diff'

describe('unifiedDiff', () => {
  test('an unchanged file produces an empty patch', () => {
    const diff = unifiedDiff('a.ts', 'a\nb\n', 'a\nb\n')
    expect(diff.patch).toBe('')
    expect(diff.adds).toBe(0)
    expect(diff.dels).toBe(0)
  })

  test('a modified line emits one hunk with context and counts', () => {
    const diff = unifiedDiff('a.ts', 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')
    expect(diff.adds).toBe(1)
    expect(diff.dels).toBe(1)
    expect(diff.patch).toBe(
      ['--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three', ''].join(
        '\n',
      ),
    )
  })

  test('a new file diffs from /dev/null with a -0,0 hunk', () => {
    const diff = unifiedDiff('new.ts', '', 'a\nb\n')
    expect(diff.adds).toBe(2)
    expect(diff.dels).toBe(0)
    expect(diff.patch).toBe(
      ['--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,2 @@', '+a', '+b', ''].join('\n'),
    )
  })

  test('a deleted file diffs to /dev/null', () => {
    const diff = unifiedDiff('gone.ts', 'a\nb\n', '')
    expect(diff.dels).toBe(2)
    expect(diff.patch).toContain('+++ /dev/null')
    expect(diff.patch).toContain('@@ -1,2 +0,0 @@')
  })

  test('far-apart changes land in separate hunks, close ones share', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`)
    const far = [...lines]
    far[0] = 'FIRST'
    far[29] = 'LAST'
    const twoHunks = unifiedDiff('a.ts', `${lines.join('\n')}\n`, `${far.join('\n')}\n`)
    expect(twoHunks.patch.match(/^@@ /gm)).toHaveLength(2)
    // The middle of the file is not in the patch at all.
    expect(twoHunks.patch).not.toContain('line15')

    const near = [...lines]
    near[0] = 'FIRST'
    near[4] = 'FIFTH'
    const oneHunk = unifiedDiff('a.ts', `${lines.join('\n')}\n`, `${near.join('\n')}\n`)
    expect(oneHunk.patch.match(/^@@ /gm)).toHaveLength(1)
  })

  test('hunk positions stay correct after earlier insertions', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`)
    const changed = [...lines]
    changed.splice(2, 0, 'INSERTED') // shifts everything below down one
    changed[25] = 'CHANGED' // line24 in the original
    const diff = unifiedDiff('a.ts', `${lines.join('\n')}\n`, `${changed.join('\n')}\n`)
    // Second hunk: old side still counts from the original file, new side is shifted.
    expect(diff.patch).toContain('@@ -22,7 +23,7 @@')
    expect(diff.patch).toContain('-line24')
    expect(diff.patch).toContain('+CHANGED')
  })
})

describe('scale', () => {
  test('a small edit in a large file stays exact', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`)
    const changed = [...lines]
    changed[2500] = 'CHANGED'
    const diff = unifiedDiff('a.ts', `${lines.join('\n')}\n`, `${changed.join('\n')}\n`)
    expect(diff.adds).toBe(1)
    expect(diff.dels).toBe(1)
  })

  test('two unrelated texts fall back to a rewrite rather than hanging', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `alpha ${i}`).join('\n')
    const b = Array.from({ length: 4000 }, (_, i) => `beta ${i}`).join('\n')
    const started = performance.now()
    const diff = unifiedDiff('a.ts', `${a}\n`, `${b}\n`)
    expect(performance.now() - started).toBeLessThan(5000)
    expect(diff.dels).toBe(4000)
    expect(diff.adds).toBe(4000)
  })
})
