import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { currentBranch, diffLines, statusMap } from '../src/core/git'
import { launch, press } from './helpers'

/** A real repository with one committed file. */
function repo(committed: string) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-git-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.ts'), committed)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

test('reports the branch', () => {
  expect(currentBranch(repo('one\n'))).toBe('main')
})

test('marks modified and added lines', () => {
  const dir = repo('one\ntwo\nthree\n')
  writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nthree\nfour\n')

  const marks = diffLines(join(dir, 'a.ts'))
  expect(marks.get(1)).toBe('modified') // "two" -> "CHANGED"
  expect(marks.get(3)).toBe('added') // new final line
  expect(marks.get(0)).toBeUndefined() // untouched
})

test('a hunk that grows marks rewrites and additions separately', () => {
  const dir = repo('one\ntwo\n')
  writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nEXTRA\n')

  const marks = diffLines(join(dir, 'a.ts'))
  expect(marks.get(1)).toBe('modified')
  expect(marks.get(2)).toBe('added')
})

test('is empty outside a repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'druk-'))
  writeFileSync(join(dir, 'a.ts'), 'x\n')
  expect(diffLines(join(dir, 'a.ts')).size).toBe(0)
  expect(currentBranch(dir)).toBeNull()
})

test('the branch shows in the status bar', async () => {
  const t = await launch(repo('one\n'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('main')
})

test('status marks reach the file tree', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'changed\n') // modified
  writeFileSync(join(dir, 'fresh.ts'), 'new\n') // untracked

  const t = await launch(dir)
  const frame = t.captureCharFrame()
  const row = (name: string) => frame.split('\n').find(line => line.includes(name)) ?? ''

  expect(row('a.ts')).toContain('M')
  expect(row('fresh.ts')).toContain('U')
})

test('a folder inherits the status of its contents', () => {
  const dir = repo('one\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub/deep.ts'), 'new\n')

  const statuses = statusMap(dir)
  // git reports the directory for untracked trees; either shape must mark it.
  const marked = [...statuses.keys()].some(path => path.includes('sub'))
  expect(marked).toBe(true)
})
