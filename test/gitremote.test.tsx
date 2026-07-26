import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  commitAll,
  discardFile,
  fetchAll,
  pull,
  push,
  unpushedCount,
  upstreamOf,
} from '../src/core/git'
import { launch, press, pressEscape } from './helpers'
import type { Harness } from './helpers'

/** A bare "remote" plus two clones of it, so pushes and pulls are real. */
function remoteSetup() {
  const base = mkdtempSync(join(tmpdir(), 'druk-remote-'))
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])

  const clone = (name: string) => {
    const dir = join(base, name)
    execFileSync('git', ['clone', '-q', origin, dir])
    execFileSync('git', ['config', 'user.email', `${name}@example.com`], { cwd: dir })
    execFileSync('git', ['config', 'user.name', name], { cwd: dir })
    return dir
  }

  const mine = clone('mine')
  writeFileSync(join(mine, 'a.ts'), 'const a = 1\n')
  commitAll(mine, 'first')
  push(mine)
  return { origin, mine, clone }
}

async function runCommand(t: Harness, label: string) {
  await press(t, input => input.pressKey('p', { ctrl: true }))
  await press(t, input => void input.typeText(label))
  await press(t, input => input.pressEnter())
}

describe('push', () => {
  test('creates the upstream on the first push', () => {
    const base = mkdtempSync(join(tmpdir(), 'druk-first-'))
    const origin = join(base, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    const dir = join(base, 'work')
    execFileSync('git', ['clone', '-q', origin, dir])
    execFileSync('git', ['config', 'user.email', 'me@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'me'], { cwd: dir })
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
    commitAll(dir, 'first')

    expect(upstreamOf(dir)?.name).toBeNull()
    expect(push(dir)).toBeNull()
    expect(upstreamOf(dir)?.name).toBe('origin/main')
  })

  test('asks before publishing, and cancelling pushes nothing', async () => {
    const { mine, clone } = remoteSetup()
    writeFileSync(join(mine, 'a.ts'), 'const a = 2\n')
    commitAll(mine, 'unpublished')

    const t = await launch(mine)
    await runCommand(t, 'Push')
    const frame = t.captureCharFrame()
    expect(frame).toContain('origin/main')
    // The confirm is shared with Delete; it must not claim to be one.
    expect(frame).toContain('Enter to push')
    expect(frame).not.toContain('Enter to delete')

    await pressEscape(t)
    const theirs = clone('checker')
    expect(existsSync(join(theirs, 'a.ts'))).toBe(true)
    expect(readFileSync(join(theirs, 'a.ts'), 'utf8')).toBe('const a = 1\n')
  })

  test('confirming publishes, and the prompt counts the unpushed commits', async () => {
    const { mine, clone } = remoteSetup()
    writeFileSync(join(mine, 'a.ts'), 'const a = 2\n')
    commitAll(mine, 'second')

    const t = await launch(mine)
    await runCommand(t, 'Push')
    expect(t.captureCharFrame()).toContain('1 commit(s)')

    await press(t, input => input.pressEnter())
    expect(readFileSync(join(clone('checker'), 'a.ts'), 'utf8')).toBe('const a = 2\n')
  })

  test('the count for a first push comes from the branch, not from the upstream', () => {
    const base = mkdtempSync(join(tmpdir(), 'druk-fresh-'))
    const origin = join(base, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    const dir = join(base, 'work')
    execFileSync('git', ['clone', '-q', origin, dir])
    execFileSync('git', ['config', 'user.email', 'me@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'me'], { cwd: dir })
    writeFileSync(join(dir, 'a.ts'), 'one\n')
    commitAll(dir, 'first')
    writeFileSync(join(dir, 'b.ts'), 'two\n')
    commitAll(dir, 'second')

    // upstreamOf has nothing to diff against, so it reports no distance at all —
    // that is what keeps a phantom ↑ out of the status bar. The prompt asks here.
    expect(upstreamOf(dir)).toEqual({ name: null, ahead: 0, behind: 0 })
    expect(unpushedCount(dir)).toBe(2)
  })
})

describe('fetch and pull', () => {
  test('fetch reports how far behind the branch is, without changing files', () => {
    const { mine, clone } = remoteSetup()
    const theirs = clone('theirs')
    writeFileSync(join(theirs, 'b.ts'), 'const b = 2\n')
    commitAll(theirs, 'from elsewhere')
    push(theirs)

    expect(fetchAll(mine)).toBeNull()
    expect(upstreamOf(mine)).toEqual({ name: 'origin/main', ahead: 0, behind: 1 })
    expect(existsSync(join(mine, 'b.ts'))).toBe(false)
  })

  test('pull fast-forwards', () => {
    const { mine, clone } = remoteSetup()
    const theirs = clone('theirs')
    writeFileSync(join(theirs, 'b.ts'), 'const b = 2\n')
    commitAll(theirs, 'from elsewhere')
    push(theirs)

    expect(pull(mine)).toBeNull()
    expect(readFileSync(join(mine, 'b.ts'), 'utf8')).toBe('const b = 2\n')
  })

  test('a diverged branch is refused, not silently merged', () => {
    const { mine, clone } = remoteSetup()
    const theirs = clone('theirs')
    writeFileSync(join(theirs, 'b.ts'), 'theirs\n')
    commitAll(theirs, 'theirs')
    push(theirs)
    writeFileSync(join(mine, 'c.ts'), 'mine\n')
    commitAll(mine, 'mine')

    expect(pull(mine)).toContain('fast-forward')
    // my commit is untouched
    expect(readFileSync(join(mine, 'c.ts'), 'utf8')).toBe('mine\n')
  })
})

describe('discard changes', () => {
  test('restores the file to HEAD', () => {
    const { mine } = remoteSetup()
    writeFileSync(join(mine, 'a.ts'), 'wrecked\n')

    expect(discardFile(mine, join(mine, 'a.ts'))).toBeNull()
    expect(readFileSync(join(mine, 'a.ts'), 'utf8')).toBe('const a = 1\n')
  })

  test('warns that it cannot be undone and cancelling keeps the edit', async () => {
    const { mine } = remoteSetup()
    writeFileSync(join(mine, 'a.ts'), 'wrecked\n')

    const t = await launch(mine)
    await press(t, input => input.pressKey('o', { ctrl: true }))
    await press(t, input => void input.typeText('a.ts'))
    await press(t, input => input.pressEnter())
    await runCommand(t, 'Discard changes')
    expect(t.captureCharFrame()).toContain('cannot be undone')

    await pressEscape(t)
    expect(readFileSync(join(mine, 'a.ts'), 'utf8')).toBe('wrecked\n')
  })

  test('confirming discards what the editor shows, not just what is on disk', async () => {
    const { mine } = remoteSetup()

    const t = await launch(mine)
    await press(t, input => input.pressKey('o', { ctrl: true }))
    await press(t, input => void input.typeText('a.ts'))
    await press(t, input => input.pressEnter())
    await press(t, input => void input.typeText('XX')) // unsaved, so the file still matches HEAD
    expect(t.captureCharFrame()).toContain('XXconst a = 1')

    await runCommand(t, 'Discard changes')
    await press(t, input => input.pressEnter())

    // git restore alone is a no-op here; the buffer has to be reset too.
    const frame = t.captureCharFrame()
    expect(frame).toContain('const a = 1')
    expect(frame).not.toContain('XXconst a = 1')
    expect(frame).not.toContain('unsaved')
  })
})

describe('the footer', () => {
  test('counts unpushed commits, missing ones, and changed files', async () => {
    const { mine, clone } = remoteSetup()

    // one commit of mine that origin has not seen
    writeFileSync(join(mine, 'local.ts'), 'const l = 1\n')
    commitAll(mine, 'unpushed')
    // one of theirs that I have not merged
    const theirs = clone('theirs')
    writeFileSync(join(theirs, 'remote.ts'), 'const r = 1\n')
    commitAll(theirs, 'from elsewhere')
    push(theirs)
    fetchAll(mine)
    // and an edit sitting in my working tree
    writeFileSync(join(mine, 'a.ts'), 'const a = 999\n')

    const t = await launch(mine)
    const footer = t.captureCharFrame().split('\n').at(-2)!
    expect(footer).toContain('main')
    expect(footer).toContain('↑1')
    expect(footer).toContain('↓1')
    expect(footer).toContain('~1')
  })

  test('a clean branch in sync shows the branch alone', async () => {
    const { mine } = remoteSetup()
    const t = await launch(mine)
    const footer = t.captureCharFrame().split('\n').at(-2)!

    expect(footer).toContain('main')
    expect(footer).not.toContain('↑')
    expect(footer).not.toContain('↓')
    expect(footer).not.toContain('~')
  })

  test('the counts follow a commit', async () => {
    const { mine } = remoteSetup()
    writeFileSync(join(mine, 'a.ts'), 'const a = 2\n')

    const t = await launch(mine)
    expect(t.captureCharFrame().split('\n').at(-2)!).toContain('~1')

    await runCommand(t, 'Commit all changes')
    await press(t, input => void input.typeText('done'))
    await press(t, input => input.pressEnter())

    const footer = t.captureCharFrame().split('\n').at(-2)!
    expect(footer).toContain('↑1')
    expect(footer).not.toContain('~')
  })
})
