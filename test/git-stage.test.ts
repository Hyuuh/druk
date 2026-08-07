import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  commitIndex,
  indexSidesMap,
  indexText,
  refText,
  stagePaths,
  stagedPaths,
  unstagePaths,
} from '../src/core/git'

function repo(committed: string) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-stage-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.ts'), committed)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return dir
}

const porcelain = (dir: string) =>
  execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()

test('indexSidesMap splits staged and unstaged columns', () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')
  execFileSync('git', ['add', 'a.ts'], { cwd: dir })
  writeFileSync(join(dir, 'a.ts'), 'three\n')
  writeFileSync(join(dir, 'b.ts'), 'new\n')

  const sides = indexSidesMap(dir)
  expect(sides.get(join(dir, 'a.ts'))).toEqual({ staged: 'modified', unstaged: 'modified' })
  expect(sides.get(join(dir, 'b.ts'))).toEqual({ staged: null, unstaged: 'untracked' })
})

test('stagePaths and unstagePaths move a path between the sides', async () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')
  const path = join(dir, 'a.ts')

  expect((await stagePaths(dir, [path])).ok).toBe(true)
  expect(stagedPaths(dir).has(path)).toBe(true)
  expect(indexSidesMap(dir).get(path)).toEqual({ staged: 'modified', unstaged: null })

  expect((await unstagePaths(dir, [path])).ok).toBe(true)
  expect(stagedPaths(dir).has(path)).toBe(false)
  expect(indexSidesMap(dir).get(path)).toEqual({ staged: null, unstaged: 'modified' })
})

test('commitIndex commits the index without pulling later working-tree edits', async () => {
  const dir = repo('one\n')
  const path = join(dir, 'a.ts')
  writeFileSync(path, 'two\n')
  execFileSync('git', ['add', 'a.ts'], { cwd: dir })
  writeFileSync(path, 'three\n')

  expect((await commitIndex(dir, 'staged only')).ok).toBe(true)
  const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir }).toString().trim()
  expect(subject).toBe('staged only')
  expect(execFileSync('git', ['show', 'HEAD:a.ts'], { cwd: dir }).toString()).toBe('two\n')
  expect(porcelain(dir)).toContain(' M a.ts')
})

test('indexText is the staged blob, distinct from HEAD and the working tree', () => {
  const dir = repo('one\n')
  writeFileSync(join(dir, 'a.ts'), 'two\n')
  execFileSync('git', ['add', 'a.ts'], { cwd: dir })
  writeFileSync(join(dir, 'a.ts'), 'three\n')

  expect(refText(dir, 'a.ts', 'HEAD')).toBe('one\n')
  expect(indexText(dir, 'a.ts')).toBe('two\n')
  expect(indexText(dir, 'missing.ts')).toBeNull()
})
