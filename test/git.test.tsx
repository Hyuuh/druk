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

// A repo with no remote at all, which the gitremote footer tests cannot cover.
test('a branch with no upstream shows without ahead/behind arrows', async () => {
  const t = await launch(repo('one\n'))
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())

  const footer = t.captureCharFrame().split('\n').at(-2)!
  expect(footer).toContain('⎇ main')
  expect(footer).not.toContain('↑')
  expect(footer).not.toContain('↓')
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

test('a folder inherits the status of its contents', async () => {
  const dir = repo('one\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub/deep.ts'), 'new\n')

  // Rendered, not just statusMap()'d: the inheritance lives in FileTree.statusOf,
  // and git reports `?? sub/` on its own, so the map alone proves nothing.
  const t = await launch(dir)
  const row = t
    .captureCharFrame()
    .split('\n')
    .find(line => line.includes('sub'))!
  expect(row).toContain('U')
})

test('a path git has to quote still gets its mark', () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'ümlaut.ts'), 'new\n')
  writeFileSync(join(dir, 'two words.ts'), 'new\n')

  // `git status --porcelain` C-quotes and octal-escapes both of these names; the
  // keys have to come back as real paths or the tree shows no mark for them.
  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'ümlaut.ts'))).toBe('untracked')
  expect(statuses.get(join(dir, 'two words.ts'))).toBe('untracked')
})

test('a rename is keyed by the path that exists on disk', () => {
  const dir = repo('one\n')
  execFileSync('git', ['mv', 'a.ts', 'renamed.ts'], { cwd: dir })

  // `-z` emits `R  new\0old\0`, so the second field must be skipped rather than
  // read as its own entry — otherwise the mark lands on the path that is gone.
  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'renamed.ts'))).toBe('modified')
  expect(statuses.has(join(dir, 'a.ts'))).toBe(false)
})
