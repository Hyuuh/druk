import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  checkoutBranch,
  createBranch,
  currentBranch,
  deleteBranch,
  listBranches,
} from '../src/core/git'
import { launch, press, pressEscape } from './helpers'

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-branch-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.ts'), 'const main = 1\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return { dir, git }
}

test('lists local branches with the current one marked', () => {
  const { dir, git } = repo()
  git('branch', 'feature')

  const branches = listBranches(dir)
  expect(branches.map(b => b.name).toSorted()).toEqual(['feature', 'main'])
  expect(branches.find(b => b.name === 'main')?.current).toBe(true)
  expect(branches.every(b => !b.remote)).toBe(true)
})

test('remote-tracking branches are listed and checked out as local ones', () => {
  const origin = repo()
  const { dir } = repo()
  execFileSync('git', ['remote', 'add', 'origin', origin.dir], { cwd: dir })
  origin.git('branch', 'shipped')
  execFileSync('git', ['fetch', '-q', 'origin'], { cwd: dir })

  const remote = listBranches(dir).find(b => b.name === 'origin/shipped')
  expect(remote?.remote).toBe(true)

  expect(checkoutBranch(dir, remote!)).toBeNull()
  expect(currentBranch(dir)).toBe('shipped')
})

test('creates a branch from another branch', () => {
  const { dir, git } = repo()
  writeFileSync(join(dir, 'a.ts'), 'const second = 2\n')
  git('commit', '-qam', 'second')
  git('branch', 'base', 'HEAD~1')

  expect(createBranch(dir, 'from-base', 'base')).toBeNull()
  expect(currentBranch(dir)).toBe('from-base')
  expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('const main = 1\n')
})

test('refuses to delete the checked-out branch and reports why', () => {
  const { dir } = repo()
  const error = deleteBranch(dir, 'main')
  expect(error).toBeTruthy()
  expect(currentBranch(dir)).toBe('main')
})

test('switching a branch from the palette reloads the open file', async () => {
  const { dir, git } = repo()
  git('checkout', '-qb', 'other')
  writeFileSync(join(dir, 'a.ts'), 'const other = 2\n')
  git('commit', '-qam', 'other')
  git('checkout', '-q', 'main')

  const t = await launch(dir)
  await press(t, i => i.pressKey('o', { ctrl: true }))
  await press(t, i => void i.typeText('a.ts'))
  await press(t, i => i.pressEnter())
  expect(t.captureCharFrame()).toContain('const main = 1')

  await press(t, i => i.pressKey('p', { ctrl: true }))
  await press(t, i => void i.typeText('Switch branch'))
  await press(t, i => i.pressEnter()) // runs the command, opens the branch list
  await press(t, i => i.pressEnter()) // picks the only other branch

  expect(currentBranch(dir)).toBe('other')
  expect(t.captureCharFrame()).toContain('const other = 2')
  expect(t.captureCharFrame()).toContain('other')
})

test('Esc closes the branch list without switching', async () => {
  const { dir, git } = repo()
  git('branch', 'untouched')

  const t = await launch(dir)
  await press(t, i => i.pressKey('p', { ctrl: true }))
  await press(t, i => void i.typeText('Switch branch'))
  await press(t, i => i.pressEnter())
  await pressEscape(t)

  expect(currentBranch(dir)).toBe('main')
  expect(t.captureCharFrame()).not.toContain('Switch branch')
})
