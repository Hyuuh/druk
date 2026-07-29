import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixture, launch, press, pressEscape, runCommand, settle } from './helpers'
import type { Harness } from './helpers'

const ESC = String.fromCharCode(27)
/** Ctrl+Opt+G as terminals spell it: an ESC prefix ahead of Ctrl+G (0x07). */
const TOGGLE = `${ESC}${String.fromCharCode(7)}`

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

/** A repository with one commit and one modified file, so the panel has a row. */
function repo() {
  const dir = fixture({ 'a.ts': 'alpha\n', 'b.ts': 'beta\n' })
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'a.ts'), 'alpha changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()

test('Ctrl+Opt+G shows the changed files, Esc puts the tree back', async () => {
  const t = await launch(repo())
  await press(t, i => void i.pressKeys([TOGGLE]))

  const open = frame(t)
  expect(open).toContain('source control')
  expect(open).toContain('a.ts')
  expect(open).not.toContain('explorer')

  await pressEscape(t)
  expect(frame(t)).toContain('explorer')
})

test('outside a repository the panel says so instead of listing nothing', async () => {
  const t = await launch(fixture({ 'a.ts': 'alpha\n' }))
  await press(t, i => void i.pressKeys([TOGGLE]))
  expect(frame(t)).toContain('open a repository to use git')
})

test('Enter opens the diff for the file under the cursor', async () => {
  const t = await launch(repo())
  await press(t, i => void i.pressKeys([TOGGLE]))
  await press(t, i => i.pressEnter())
  await settle(t, 100)

  const shown = frame(t)
  expect(shown).toContain('alpha changed')
  expect(shown).toContain('+1 −1')
  // The keyboard stays in the panel: the arrows are the pager, not the scroll.
  expect(shown).toContain('↑↓ diff')
})

test('c commits the change from the panel, p reports on push', async () => {
  const dir = repo()
  const t = await launch(dir)
  await press(t, i => void i.pressKeys([TOGGLE]))

  // Commit: the file picker, then the message prompt, then a clean panel.
  await press(t, i => void i.typeText('c'))
  expect(frame(t)).toContain('Commit — 1 of 1 files')
  await press(t, i => i.pressEnter())
  expect(frame(t)).toContain('Commit message')
  await press(t, i => void i.typeText('panel commit'))
  await press(t, i => i.pressEnter())
  await settle(t, 200)

  expect(frame(t)).toContain('no changes')
  const log = Bun.spawnSync(['git', 'log', '-1', '--format=%s'], { cwd: dir })
  expect(log.stdout.toString().trim()).toBe('panel commit')

  // Push has no remote to reach; the point is that `p` runs it and reports.
  await press(t, i => void i.typeText('p'))
  await settle(t, 300)
  expect(frame(t)).not.toContain('explorer') // still in the panel, no paste happened
})

test('the peek strip advertises the panel keys, not the tree ones', async () => {
  const t = await launch(repo())
  await press(t, i => void i.pressKeys([TOGGLE]))
  await press(t, i => i.pressKey('k', { ctrl: true }))

  const peek = frame(t)
  expect(peek).toContain('Keys · source control')
  expect(peek).toContain('↑↓ · Enter')
  expect(peek).toContain('c · p · b · Esc')
  expect(peek).not.toContain('a / A')
})

test('the palette opens the panel too', async () => {
  const t = await launch(repo())
  await runCommand(t, 'Source control')
  expect(frame(t)).toContain('source control')
})
