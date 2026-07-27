import { describe, expect, test } from 'bun:test'

import { contextAround, contextIn } from '../src/core/search'
import { fixture, launch, press, settle } from './helpers'
import type { Harness } from './helpers'

const PROJECT = {
  'src/alpha.ts': 'const capture = 1\nfunction captureAll() {\n  return capture\n}\n',
  'src/beta.ts': '// capture notes\nconst other = 2\n',
  'docs/long.md': `${'x'.repeat(200)}capture${'y'.repeat(60)}\nplain line\n`,
}

/** Open the project search and let the debounced scan land. */
async function search(query: string, size: { width?: number; height?: number } = {}) {
  const t = await launch(fixture(PROJECT), {}, { width: 100, height: 30, ...size })
  await press(t, input => input.pressKey('r', { ctrl: true }))
  await press(t, input => void input.typeText(query))
  await settle(t, 300)
  return t
}

/** Rows inside the panel border, trimmed. */
const panel = (t: Harness) =>
  t
    .captureCharFrame()
    .split('\n')
    .filter(row => row.includes('│'))
    .map(row => row.slice(row.indexOf('│') + 1, row.lastIndexOf('│')).trimEnd())

describe('project search results', () => {
  test('group under one heading per file, with a count', async () => {
    const t = await search('capture')
    const rows = panel(t)

    // The path is a heading, not a column repeated on every match row.
    expect(rows.some(row => row.includes('src/alpha.ts') && row.includes('3 matches'))).toBe(true)
    expect(rows.some(row => row.includes('src/beta.ts') && row.includes('1 match'))).toBe(true)
    // Three matches in alpha.ts, and its path appears once.
    expect(rows.filter(row => row.includes('src/alpha.ts')).length).toBe(1)
  })

  test('the summary counts files as well as matches', async () => {
    const t = await search('capture')
    expect(panel(t).some(row => row.includes('1 of 5 in 3 files'))).toBe(true)
  })

  test('a match far along a line is still on screen', async () => {
    const t = await search('capture')
    const rows = panel(t)

    // The hit sits at column 200. Slicing from column 0 — what the old fixed
    // 38-column window did — would show only filler and never the query itself.
    const row = rows.find(r => r.includes('…'))
    expect(row).toBeDefined()
    expect(row).toContain('capture')
  })

  test('match rows carry the line number instead of the path', async () => {
    const t = await search('capture')
    const rows = panel(t)
    const alpha = rows.indexOf(rows.find(r => r.includes('src/alpha.ts'))!)

    expect(rows[alpha + 1]).toContain('const capture = 1')
    expect(rows[alpha + 1]).toMatch(/^\s+1\s/)
    expect(rows[alpha + 2]).toMatch(/^\s+2\s/)
  })
})

describe('the preview under the results', () => {
  test('shows the lines around the selected match', async () => {
    const t = await search('other') // src/beta.ts line 2
    const rows = panel(t)

    // Line 1 is context, not a match, so it can only have come from the preview.
    expect(rows.some(row => row.includes('// capture notes'))).toBe(true)
    expect(rows.some(row => row.includes('const other = 2'))).toBe(true)
  })

  test('follows the selection', async () => {
    const t = await search('capture')
    // Selection starts on the docs/long.md hit, so its neighbour is previewed.
    expect(panel(t).some(row => row.includes('plain line'))).toBe(true)

    // Last of the five matches is in src/beta.ts, whose neighbour is `const other`.
    // Neither line is a match, so each can only be coming from the preview.
    await press(t, input => input.pressArrow('up'))
    await settle(t)
    const rows = panel(t)
    expect(rows.some(row => row.includes('5 of 5'))).toBe(true)
    expect(rows.some(row => row.includes('const other = 2'))).toBe(true)
    expect(rows.some(row => row.includes('plain line'))).toBe(false)
  })

  test('gives way on a terminal with no room for it', async () => {
    const t = await search('capture', { height: 16 })
    const rows = panel(t)

    // Results and the footer survive; the preview is what goes.
    expect(rows.some(row => row.includes('src/alpha.ts'))).toBe(true)
    expect(rows.some(row => row.includes('Enter jump'))).toBe(true)
    expect(rows.some(row => row.includes('plain line'))).toBe(false)
    // And the whole panel still fits the screen.
    expect(t.captureCharFrame().split('\n').length).toBeLessThanOrEqual(17)
  })
})

describe('contextAround', () => {
  const TEXT = 'one\ntwo\nthree\nfour\nfive\n'

  test('clamps at the top of the file', () => {
    expect(contextIn(TEXT, 0, 2)).toEqual({ start: 0, lines: ['one', 'two', 'three'] })
  })

  test('clamps at the end of the file', () => {
    expect(contextIn(TEXT, 4, 2)).toEqual({ start: 2, lines: ['three', 'four', 'five', ''] })
  })

  test('reads from disk, and answers null when the file is gone', () => {
    const dir = fixture({ 'a.ts': TEXT })
    expect(contextAround(`${dir}/a.ts`, 2, 1)).toEqual({
      start: 1,
      lines: ['two', 'three', 'four'],
    })
    expect(contextAround(`${dir}/gone.ts`, 2, 1)).toBeNull()
  })
})
