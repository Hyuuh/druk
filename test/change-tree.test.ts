import { expect, test } from 'bun:test'

import { changeRows, parentRow, sectionedChangeRows } from '../src/core/changeTree'
import type { Change } from '../src/core/changeTree'

const changes = (...rels: string[]): Change[] =>
  rels
    .toSorted((a, b) => a.localeCompare(b))
    .map(rel => ({ path: `/root/${rel}`, rel, status: 'modified' as const }))

/** `kind:label@depth` per row — the shape a panel row renders from. */
const shape = (rows: ReturnType<typeof changeRows>) =>
  rows.map(row =>
    row.kind === 'section'
      ? `section:${row.label}@${row.count}`
      : `${row.kind === 'dir' ? 'dir' : 'file'}:${row.label}@${row.depth}`,
  )

test('the flat list is one row per change, under its whole path', () => {
  expect(shape(changeRows(changes('src/app/a.ts', 'b.ts'), 'list'))).toEqual([
    'file:b.ts@0',
    'file:src/app/a.ts@0',
  ])
})

test('the tree nests files under a folder row', () => {
  const rows = changeRows(changes('src/a.ts', 'src/b.ts', 'c.ts'), 'tree')

  expect(shape(rows)).toEqual(['file:c.ts@0', 'dir:src@0', 'file:a.ts@1', 'file:b.ts@1'])
})

test('a folder with one child folder is joined into one row', () => {
  // Two rows for `src` and `app` would spend half a narrow sidebar on folders
  // that say nothing on their own.
  const rows = changeRows(changes('src/app/a.ts', 'src/app/b.ts'), 'tree')

  expect(shape(rows)).toEqual(['dir:src/app@0', 'file:a.ts@1', 'file:b.ts@1'])
})

test('the join stops where the paths part', () => {
  const rows = changeRows(changes('src/app/a.ts', 'src/ui/b.ts'), 'tree')

  expect(shape(rows)).toEqual(['dir:src@0', 'dir:app@1', 'file:a.ts@2', 'dir:ui@1', 'file:b.ts@2'])
})

test('a collapsed folder keeps its row and hides its subtree', () => {
  const rows = changeRows(changes('src/a.ts', 'src/b.ts', 'c.ts'), 'tree', new Set(['src']))

  expect(shape(rows)).toEqual(['file:c.ts@0', 'dir:src@0'])
  // The count is what the row shows in place of the files it is hiding.
  expect(rows.find(row => row.kind === 'dir')).toMatchObject({ collapsed: true, files: 2 })
})

test('collapsing an outer folder hides the inner folders too', () => {
  const rows = changeRows(changes('a/b/c.ts', 'a/d/e.ts', 'z.ts'), 'tree', new Set(['a']))

  expect(shape(rows)).toEqual(['dir:a@0', 'file:z.ts@0'])
})

test('← walks a file out to the folder holding it', () => {
  const rows = changeRows(changes('src/app/a.ts', 'src/ui/b.ts'), 'tree')
  //             0: src   1: app   2: a.ts   3: ui   4: b.ts
  expect(parentRow(rows, 2)).toBe(1)
  expect(parentRow(rows, 1)).toBe(0)
  // Nothing outside the top level to walk to: the cursor stays put.
  expect(parentRow(rows, 0)).toBe(0)
})

test('with nothing staged the panel stays a single list', () => {
  expect(shape(sectionedChangeRows([], changes('a.ts', 'b.ts'), 'list'))).toEqual([
    'file:a.ts@0',
    'file:b.ts@0',
  ])
})

test('a non-empty index draws Staged and Changes sections', () => {
  const staged = changes('a.ts').map(c => ({ ...c, side: 'staged' as const }))
  const unstaged = changes('b.ts').map(c => ({ ...c, side: 'unstaged' as const }))
  expect(shape(sectionedChangeRows(staged, unstaged, 'list'))).toEqual([
    'section:STAGED@1',
    'file:a.ts@0',
    'section:CHANGES@1',
    'file:b.ts@0',
  ])
})

test('with nothing left unstaged the empty Changes section is omitted', () => {
  const staged = changes('a.ts').map(c => ({ ...c, side: 'staged' as const }))
  expect(shape(sectionedChangeRows(staged, [], 'list'))).toEqual([
    'section:STAGED@1',
    'file:a.ts@0',
  ])
})

test('← stops at a section rather than walking into the group above', () => {
  const staged = changes('a.ts').map(c => ({ ...c, side: 'staged' as const }))
  const unstaged = changes('src/b.ts').map(c => ({ ...c, side: 'unstaged' as const }))
  const rows = sectionedChangeRows(staged, unstaged, 'tree')
  // STAGED, a.ts, CHANGES, src, b.ts — ← on b.ts lands on src, not on a.ts.
  const b = rows.findIndex(row => row.kind === 'file' && row.change.rel === 'src/b.ts')
  expect(parentRow(rows, b)).toBe(rows.findIndex(row => row.kind === 'dir'))
  // ← on a top-level staged file has nowhere to go inside its section.
  expect(parentRow(rows, 1)).toBe(1)
})
