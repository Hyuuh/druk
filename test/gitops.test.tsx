import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitAll, lastCommitSubject, popStash, stashAll, undoLastCommit } from '../src/core/git'
import { launch, press, pressEscape } from './helpers'
import type { Harness } from './helpers'

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'druk-gitops-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return { dir, git }
}

/** Run a leaf command by typing its label into the palette. */
async function runCommand(t: Harness, label: string) {
  await press(t, input => input.pressKey('p', { ctrl: true }))
  await press(t, input => void input.typeText(label))
  await press(t, input => input.pressEnter())
}

describe('commit', () => {
  test('stages tracked and untracked changes together', () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'const a = 2\n')
    writeFileSync(join(dir, 'new.ts'), 'const b = 3\n')

    expect(commitAll(dir, 'both files')).toBeNull()
    expect(lastCommitSubject(dir)).toBe('both files')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('')
  })

  test('reports git’s own complaint when there is nothing to commit', () => {
    const { dir } = repo()
    expect(commitAll(dir, 'empty')).toBeTruthy()
  })

  test('the palette commits with the typed message', async () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'const a = 99\n')

    const t = await launch(dir)
    await runCommand(t, 'Commit all changes')
    await press(t, input => void input.typeText('from the palette'))
    await press(t, input => input.pressEnter())

    expect(lastCommitSubject(dir)).toBe('from the palette')
  })
})

describe('undo last commit', () => {
  test('keeps the changes in the working tree', () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'const a = 2\n')
    commitAll(dir, 'second')

    expect(undoLastCommit(dir)).toBeNull()
    expect(lastCommitSubject(dir)).toBe('init')
    expect(Bun.file(join(dir, 'a.ts')).text()).resolves.toBe('const a = 2\n')
  })

  test('asks first, naming the commit, and cancelling leaves it alone', async () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'const a = 2\n')
    commitAll(dir, 'keep me')

    const t = await launch(dir)
    await runCommand(t, 'Undo last commit')
    expect(t.captureCharFrame()).toContain('keep me')

    await pressEscape(t)
    expect(lastCommitSubject(dir)).toBe('keep me')
  })
})

describe('stash', () => {
  test('shelves tracked and untracked changes, pop brings them back', () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'const a = 2\n')
    writeFileSync(join(dir, 'untracked.ts'), 'const c = 4\n')

    expect(stashAll(dir)).toBeNull()
    expect(existsSync(join(dir, 'untracked.ts'))).toBe(false)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('')

    expect(popStash(dir)).toBeNull()
    expect(existsSync(join(dir, 'untracked.ts'))).toBe(true)
  })

  test('says so instead of failing silently when there is nothing to stash', () => {
    expect(stashAll(repo().dir)).toBe('Nothing to stash')
  })

  test('popping an empty stash reports git’s error', () => {
    expect(popStash(repo().dir)).toBeTruthy()
  })
})
