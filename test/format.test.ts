import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { formatterFor, runFormatter } from '../src/core/format'

/** A command whose script file sees the target path as argv[2], as real ones do. */
function script(code: string): { command: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'druk-fmt-'))
  const file = join(dir, 'tool.js')
  writeFileSync(file, code)
  return { command: [process.execPath, file], dir }
}

describe('formatterFor', () => {
  test('matches the extension in a comma-separated key', () => {
    const formatters = { 'ts,tsx': ['prettier', '--write'] }
    expect(formatterFor('/p/a.ts', formatters)).toEqual(['prettier', '--write'])
    expect(formatterFor('/p/a.tsx', formatters)).toEqual(['prettier', '--write'])
    expect(formatterFor('/p/a.go', formatters)).toBeNull()
  })

  test('matching is case-insensitive and tolerates spaces around commas', () => {
    const formatters = { 'TS, go': ['fmt'] }
    expect(formatterFor('/p/a.ts', formatters)).toEqual(['fmt'])
    expect(formatterFor('/p/A.GO', formatters)).toEqual(['fmt'])
  })

  test('a specific key beats the catch-all, which covers the rest', () => {
    const formatters = { '*': ['generic'], 'go': ['gofmt', '-w'] }
    expect(formatterFor('/p/a.go', formatters)).toEqual(['gofmt', '-w'])
    expect(formatterFor('/p/a.rb', formatters)).toEqual(['generic'])
  })

  test('an empty command disables its entry', () => {
    expect(formatterFor('/p/a.ts', { ts: [] })).toBeNull()
    expect(formatterFor('/p/a.ts', { '*': [] })).toBeNull()
  })

  test('a file with no extension only matches the catch-all', () => {
    expect(formatterFor('/p/Makefile', { '': ['fmt'], 'ts': ['fmt'] })).toBeNull()
    expect(formatterFor('/p/Makefile', { '*': ['generic'] })).toEqual(['generic'])
  })
})

describe('runFormatter', () => {
  test('a missing binary reports name and PATH, not a stack', async () => {
    const error = await runFormatter(['druk-no-such-formatter'], '/p/a.ts', '/tmp')
    expect(error).toBe('druk-no-such-formatter is not installed, or not on PATH')
  })

  test('a failing command reports the first stderr line', async () => {
    const { command, dir } = script('console.error("boom\\nmore"); process.exit(2)')
    const error = await runFormatter(command, '/p/a.ts', dir)
    expect(error).toBe('boom')
  })

  test('success resolves null', async () => {
    const { command, dir } = script('process.exit(0)')
    const error = await runFormatter(command, '/p/a.ts', dir)
    expect(error).toBeNull()
  })
})
