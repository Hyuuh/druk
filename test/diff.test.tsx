import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { diffText } from '../src/core/git'
import { launch, press, pressEscape } from './helpers'
import type { Harness } from './helpers'

function repo(files: Record<string, string> = { 'a.ts': 'one\ntwo\nthree\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'druk-diff-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return { dir, git }
}

async function runCommand(t: Harness, label: string) {
  await press(t, input => input.pressKey('p', { ctrl: true }))
  await press(t, input => void input.typeText(label))
  await press(t, input => input.pressEnter())
}

describe('diffText', () => {
  test('covers staged and unstaged changes together', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'a.ts'), 'one\nSTAGED\nthree\n')
    git('add', 'a.ts')
    writeFileSync(join(dir, 'a.ts'), 'one\nSTAGED\nUNSTAGED\n')

    const diff = diffText(dir, join(dir, 'a.ts'))
    expect(diff).toContain('+STAGED')
    expect(diff).toContain('+UNSTAGED')
    expect(diff).toContain('-two')
  })

  test('an untracked file diffs against nothing', () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'fresh.ts'), 'brand new\n')

    expect(diffText(dir, join(dir, 'fresh.ts'))).toContain('+brand new')
  })

  test('is empty when the file matches HEAD', () => {
    const { dir } = repo()
    expect(diffText(dir, join(dir, 'a.ts')).trim()).toBe('')
  })

  test('without a path it covers every changed file', () => {
    const { dir } = repo({ 'a.ts': 'one\n', 'b.ts': 'two\n' })
    writeFileSync(join(dir, 'a.ts'), 'ONE\n')
    writeFileSync(join(dir, 'b.ts'), 'TWO\n')

    const diff = diffText(dir)
    expect(diff).toContain('a/a.ts')
    expect(diff).toContain('a/b.ts')
  })
})

describe('the diff viewer', () => {
  test('shows the hunk for the open file and closes on Esc', async () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nthree\n')

    const t = await launch(dir)
    await press(t, input => input.pressKey('o', { ctrl: true }))
    await press(t, input => void input.typeText('a.ts'))
    await press(t, input => input.pressEnter())
    await runCommand(t, 'Diff this file')

    const frame = t.captureCharFrame()
    expect(frame).toContain('Diff — a.ts')
    expect(frame).toContain('-two')
    expect(frame).toContain('+CHANGED')

    await pressEscape(t)
    expect(t.captureCharFrame()).not.toContain('+CHANGED')
  })

  test('says so instead of opening an empty panel when nothing changed', async () => {
    const { dir } = repo()
    const t = await launch(dir)
    await press(t, input => input.pressKey('o', { ctrl: true }))
    await press(t, input => void input.typeText('a.ts'))
    await press(t, input => input.pressEnter())
    await runCommand(t, 'Diff this file')

    expect(t.captureCharFrame()).toContain('matches HEAD')
    expect(t.captureCharFrame()).not.toContain('Diff —')
  })

  test('the project diff lists every changed file', async () => {
    const { dir } = repo({ 'a.ts': 'one\n', 'b.ts': 'two\n' })
    writeFileSync(join(dir, 'a.ts'), 'ONE\n')
    writeFileSync(join(dir, 'b.ts'), 'TWO\n')

    const t = await launch(dir)
    await runCommand(t, 'Diff all changes')

    const frame = t.captureCharFrame()
    // The title counts the files, and each one is announced by name.
    expect(frame).toContain('Diff — 2 files')
    expect(frame).toContain('▌ a.ts')
    expect(frame).toContain('▌ b.ts')
  })

  test('typing while the diff is open does not reach the buffer', async () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'one\nCHANGED\nthree\n')

    const t = await launch(dir)
    await press(t, input => input.pressKey('o', { ctrl: true }))
    await press(t, input => void input.typeText('a.ts'))
    await press(t, input => input.pressEnter())
    await runCommand(t, 'Diff this file')
    await press(t, input => void input.typeText('zzz'))

    expect(t.captureCharFrame()).not.toContain('zzz')
  })
})
