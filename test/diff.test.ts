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
    expect(diff.lines).toBe(8000)
    expect(diff.truncated).toBe(false)
  })

  test('maxLines cuts the patch body but not the counts', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `alpha ${i}`).join('\n')
    const b = Array.from({ length: 4000 }, (_, i) => `beta ${i}`).join('\n')
    const diff = unifiedDiff('a.ts', `${a}\n`, `${b}\n`, 100)
    // The counts are the change's, the body is the cap's.
    expect(diff.adds).toBe(4000)
    expect(diff.dels).toBe(4000)
    expect(diff.lines).toBe(100)
    expect(diff.truncated).toBe(true)
    const body = diff.patch
      .split('\n')
      .filter(l => /^[ +-]/.test(l) && !l.startsWith('+++') && !l.startsWith('---'))
    expect(body).toHaveLength(100)
    // The cut hunk's header names what was emitted, so the patch still parses.
    expect(diff.patch).toContain('@@ -1,100 +0,0 @@')
  })

  test('a diff under maxLines is not truncated', () => {
    const diff = unifiedDiff('a.ts', 'one\ntwo\n', 'one\nTWO\n', 100)
    expect(diff.truncated).toBe(false)
    expect(diff.lines).toBe(3)
  })

  test('a rewrite keeps its context rows and hunk arithmetic', () => {
    // Shared prefix and suffix around a >MAX_EDIT_DISTANCE middle: the rewrite
    // fast path must emit the same shape the generic emitter would.
    const shared = ['keep0', 'keep1', 'keep2', 'keep3', 'keep4']
    const a = [...shared, ...Array.from({ length: 3000 }, (_, i) => `alpha ${i}`), ...shared]
    const b = [...shared, ...Array.from({ length: 3000 }, (_, i) => `beta ${i}`), ...shared]
    const diff = unifiedDiff('a.ts', `${a.join('\n')}\n`, `${b.join('\n')}\n`)
    expect(diff.adds).toBe(3000)
    expect(diff.dels).toBe(3000)
    // Three context rows each side: 5 shared lines, CONTEXT takes 3.
    expect(diff.patch).toContain('@@ -3,3006 +3,3006 @@')
    expect(diff.patch).toContain(' keep2\n keep3\n keep4\n-alpha 0')
    expect(diff.patch).toContain('+beta 2999\n keep0\n keep1\n keep2\n')
    expect(diff.lines).toBe(6006)
    expect(diff.truncated).toBe(false)
  })

  test('maxLines keeps whole earlier hunks and drops later ones', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line${i}`)
    const changed = [...lines]
    changed[0] = 'FIRST'
    changed[59] = 'LAST'
    const diff = unifiedDiff('a.ts', `${lines.join('\n')}\n`, `${changed.join('\n')}\n`, 6)
    // The first hunk (5 rows) fits; the second begins and is cut after one row.
    expect(diff.patch).toContain('+FIRST')
    expect(diff.patch).not.toContain('+LAST')
    expect(diff.adds).toBe(2)
    expect(diff.dels).toBe(2)
    expect(diff.truncated).toBe(true)
  })
})
