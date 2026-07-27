import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listDir } from '../src/core/fs'
import { listFiles } from '../src/core/search'
import { fixture, launch, press, settle } from './helpers'

const PROJECT = { 'src/main.ts': 'const a = 1\n', '.DS_Store': 'junk\n', '.gitignore': 'dist\n' }

/**
 * There is no show/hide setting. The tree lists what is on disk, and the guard sits
 * at the point of opening instead — hiding a file the user can see in their shell
 * only makes druk look broken when they go looking for it.
 */
describe('the tree lists everything', () => {
  test('dotfiles included', async () => {
    const frame = (await launch(fixture(PROJECT))).captureCharFrame()
    expect(frame).toContain('.gitignore')
    expect(frame).toContain('.DS_Store')
  })

  test('and there is no command to hide them', async () => {
    const t = await launch(fixture(PROJECT))
    await press(t, i => i.pressKey('p', { ctrl: true }))
    await press(t, i => void i.typeText('Hidden'))
    await settle(t)
    expect(t.captureCharFrame()).not.toContain('Hide them')
  })
})

describe('the VCS store is not project content', () => {
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'druk-vcs-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
    writeFileSync(join(dir, '.gitignore'), 'dist\n')
    return dir
  }

  test('.git is left out of the tree, .gitignore is not', async () => {
    const t = await launch(repo())
    const frame = t.captureCharFrame()
    expect(frame).toContain('.gitignore')
    expect(frame).not.toContain('.git\n')
    // Nothing in the frame is a row for `.git` itself.
    const rows = frame.split('\n').map(row => row.slice(0, 30).trim())
    expect(rows).not.toContain('.git')
  })

  test('listDir drops it whatever the caller asks for', () => {
    const names = listDir(repo()).map(node => node.name)
    expect(names).toContain('.gitignore')
    expect(names).not.toContain('.git')
  })

  test('the fuzzy picker and project search never walk into it', () => {
    const dir = repo()
    // `.git` holds far more files than the project does, so this is what keeps the
    // picker and a project-wide search usable at all.
    const files = listFiles(dir).map(path => path.slice(dir.length + 1))
    expect(files).toContain('.gitignore')
    expect(files.some(path => path.startsWith('.git/'))).toBe(false)
  })

  test('a file named like a VCS directory is still a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'druk-vcsfile-'))
    // A worktree or submodule checkout has `.git` as a *file* pointing elsewhere.
    // It is text, and there is no reason to pretend it is not there.
    writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere\n')
    expect(listDir(dir).map(node => node.name)).toContain('.git')
  })
})

describe('a file druk cannot display', () => {
  const withBlob = () => {
    const dir = fixture({ 'a.ts': 'const a = 1\n' })
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 0]))
    return dir
  }

  test('is listed, but opening it says so instead of opening a tab', async () => {
    const t = await launch(withBlob())
    expect(t.captureCharFrame()).toContain('blob.bin')

    await press(t, i => i.pressKey('o', { ctrl: true }))
    await press(t, i => void i.typeText('blob.bin'))
    await press(t, i => i.pressEnter())
    await settle(t)

    const frame = t.captureCharFrame()
    expect(frame).toContain('blob.bin cannot be shown')
    // Drawn over the pane, but never opened: no tab.
    expect(frame.split('\n')[0]).not.toContain('blob.bin')
  })

  test('does not disturb the tab that is already open', async () => {
    const t = await launch(withBlob())
    await press(t, i => i.pressKey('o', { ctrl: true }))
    await press(t, i => void i.typeText('a.ts'))
    await press(t, i => i.pressEnter())
    await settle(t)
    expect(t.captureCharFrame()).toContain('const a = 1')

    await press(t, i => i.pressKey('o', { ctrl: true }))
    await press(t, i => void i.typeText('blob.bin'))
    await press(t, i => i.pressEnter())
    await settle(t)

    const frame = t.captureCharFrame()
    expect(frame).toContain('cannot be shown')
    // The tab it covers is untouched underneath.
    expect(frame.split('\n')[0]).toContain('a.ts')
  })
})
