import { describe, expect, test } from 'bun:test'

import { changedFiles, parseDiff } from '../src/core/diff'

const rowsOf = (diff: string, kind: string) =>
  parseDiff(diff)
    .filter(row => row.kind === kind)
    .map(row => row.text)

describe('parseDiff', () => {
  test('collapses git’s four-line preamble into one named row', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 4cb29ea..18e24a3 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+CHANGED',
    ].join('\n')

    expect(rowsOf(diff, 'file')).toEqual(['src/app.ts'])
    expect(rowsOf(diff, 'hunk')).toEqual(['@@ -1,2 +1,2 @@'])
    expect(rowsOf(diff, 'added')).toEqual(['+CHANGED'])
    expect(rowsOf(diff, 'removed')).toEqual(['-two'])
    // The path noise is gone rather than dimmed.
    expect(parseDiff(diff).some(row => row.text.includes('index 4cb29ea'))).toBe(false)
  })

  test('keeps every file apart in a multi-file diff', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      'index 1..2 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-one',
      '+ONE',
      'diff --git a/b.ts b/b.ts',
      'index 3..4 100644',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1 @@',
      '-two',
      '+TWO',
    ].join('\n')

    expect(rowsOf(diff, 'file')).toEqual(['a.ts', 'b.ts'])
    expect(changedFiles(parseDiff(diff))).toBe(2)
  })

  test('says when a file is new or deleted', () => {
    const created = [
      'diff --git a/fresh.ts b/fresh.ts',
      'new file mode 100644',
      'index 0000000..d5a09df',
      '--- /dev/null',
      '+++ b/fresh.ts',
      '@@ -0,0 +1 @@',
      '+brand new',
    ].join('\n')
    const removed = [
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      'index d5a09df..0000000',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
    ].join('\n')

    expect(rowsOf(created, 'file')).toEqual(['fresh.ts  (new file)'])
    expect(rowsOf(removed, 'file')).toEqual(['old.ts  (deleted)'])
  })

  test('shows both names for a rename', () => {
    const diff = [
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 100%',
      'rename from old/name.ts',
      'rename to new/name.ts',
    ].join('\n')

    expect(rowsOf(diff, 'file')).toEqual(['old/name.ts → new/name.ts'])
  })

  test('an empty diff has no rows', () => {
    expect(parseDiff('')).toEqual([])
    expect(changedFiles(parseDiff(''))).toBe(0)
  })
})
