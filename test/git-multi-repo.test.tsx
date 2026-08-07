import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { searchProject } from '../src/core/search'
import {
  fixture,
  launch,
  openFile,
  press,
  pressTimes,
  runCommand,
  settle,
  untilFrame,
} from './helpers'
import type { Harness } from './helpers'

const git = (dir: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

const init = (dir: string) => {
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'druk@test')
  git(dir, 'config', 'user.name', 'druk')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
}

/**
 * A folder that is no repository itself and holds two — one directly below it,
 * one a level deeper — each with a change.
 */
function folderOfRepos() {
  const dir = fixture({
    'alpha/a.ts': 'alpha\n',
    'nested/beta/b.ts': 'beta\n',
  })
  init(join(dir, 'alpha'))
  init(join(dir, 'nested/beta'))
  writeFileSync(join(dir, 'alpha/a.ts'), 'alpha changed\n')
  writeFileSync(join(dir, 'nested/beta/b.ts'), 'beta changed\n')
  return dir
}

const frame = (t: Harness) => t.captureCharFrame()
const subject = (dir: string) =>
  Bun.spawnSync(['git', 'log', '-1', '--format=%s'], { cwd: dir }).stdout.toString().trim()

/** Git mutations finish off the render clock; poll instead of guessing a delay. */
async function until(t: Harness, cond: () => boolean, ms = 5000) {
  const start = Date.now()
  while (!cond() && Date.now() - start < ms) await settle(t, 25)
  expect(cond()).toBe(true)
}
const openPanel = (t: Harness) => runCommand(t, 'Source control')

test('the panel lists the changes of every repository under the folder', async () => {
  const t = await launch(folderOfRepos())
  await openPanel(t)

  await untilFrame(t, 'a.ts')
  const shown = frame(t)
  expect(shown).toContain('a.ts')
  expect(shown).toContain('b.ts')
  // Each under the folder it lives in, so two repositories cannot look like one.
  expect(shown).toContain('alpha')
  expect(shown).toContain('beta')
})

test('the branch is named with the repository the open file is in', async () => {
  const t = await launch(folderOfRepos())
  await openFile(t, 'nested/beta/b.ts')

  await untilFrame(t, 'beta/')
  // `repo/branch`: with several open, the branch alone says nothing about whose.
  expect(frame(t)).toMatch(/⎇ beta\/(main|master)/)
})

test('the gutter marks a nested repository’s file', async () => {
  const t = await launch(folderOfRepos())
  await openFile(t, 'alpha/a.ts')
  await untilFrame(t, 'alpha changed')
  // The mark column sits between the line number and the text.
  await untilFrame(t, '▎')
})

test('a repository below the folder is left alone when the scan is off', async () => {
  const t = await launch(folderOfRepos(), { gitScanDepth: 0 })
  await openPanel(t)

  await untilFrame(t, 'open a repository to use git')
  expect(frame(t)).not.toContain('a.ts')
})

test('a git command names the repository it cannot pick', async () => {
  const t = await launch(folderOfRepos())
  // Nothing opened and nothing selected in the tree: two repositories, and no
  // way to tell which one a push was meant for.
  await runCommand(t, 'Push')
  await untilFrame(t, 'Which repository?')
})

test('a commit acts on the repository the file being edited is in', async () => {
  const dir = folderOfRepos()
  const t = await launch(dir)
  await openFile(t, 'nested/beta/b.ts')
  await untilFrame(t, 'beta changed')

  await runCommand(t, 'Commit')
  // Only that repository's change is offered: the other's is a different commit.
  await untilFrame(t, '1 of 1 files')
  expect(frame(t)).toContain('b.ts')
  expect(frame(t)).not.toContain('a.ts')

  await press(t, i => i.pressEnter())
  await press(t, i => void i.typeText('beta moves'))
  await press(t, i => i.pressEnter({ meta: true }))

  await until(t, () => subject(join(dir, 'nested/beta')) === 'beta moves')
  // The other repository is untouched — its change is still there to commit.
  expect(subject(join(dir, 'alpha'))).toBe('init')
})

test('the diff of a nested repository’s file is read from that repository', async () => {
  const t = await launch(folderOfRepos())
  await openPanel(t)
  await untilFrame(t, 'b.ts')
  // Down through the folder rows to beta's change; each landing diffs it.
  await pressTimes(t, 6, i => i.pressArrow('down'))
  await untilFrame(t, 'beta changed')
  // The committed side comes from beta's HEAD, not from an empty string — an
  // untracked file would show every line added and no removal.
  expect(frame(t)).toContain('−1')
})

test('a nested repository’s gitignore is what hides its files', async () => {
  const dir = fixture({
    'alpha/.gitignore': 'generated\n',
    'alpha/a.ts': 'alpha\n',
    'alpha/generated/out.js': 'built\n',
    // Outside every repository: no rules apply to it, whatever the repositories say.
    'generated/loose.js': 'loose\n',
  })
  init(join(dir, 'alpha'))

  const t = await launch(dir, { respectGitignore: true })
  await press(t, i => i.pressArrow('down')) // onto alpha
  await press(t, i => i.pressArrow('right')) // open it
  await untilFrame(t, 'a.ts')
  const rows = frame(t)
    .split('\n')
    .map(row => row.slice(0, 30).trim())
  expect(rows.some(row => row.includes('.gitignore'))).toBe(true)
  // One `generated` row left: the repository's is hidden, the loose one is not.
  expect(rows.filter(row => row.endsWith('generated'))).toHaveLength(1)
})

test('a search skips what each repository ignores', () => {
  const dir = fixture({
    'alpha/.gitignore': 'generated\n',
    'alpha/a.ts': 'const alpha = 1\n',
    'alpha/generated/bundle.js': 'var alpha = 1\n',
    'beta/.gitignore': 'artifacts\n',
    'beta/b.ts': 'const alpha = 2\n',
    'beta/artifacts/bundle.js': 'var alpha = 2\n',
  })
  init(join(dir, 'alpha'))
  init(join(dir, 'beta'))

  const hits = searchProject(dir, 'alpha').map(match => match.path.slice(dir.length + 1))
  expect(hits.toSorted()).toEqual(['alpha/a.ts', 'beta/b.ts'])
})

test('a folder with no repository anywhere below it still says so', async () => {
  const t = await launch(fixture({ 'a.ts': 'alpha\n', 'sub/b.ts': 'beta\n' }))
  await openPanel(t)
  await untilFrame(t, 'open a repository to use git')
})

test('a keyboard discard stays pinned when another repository row vanishes', async () => {
  const dir = folderOfRepos()
  const alpha = join(dir, 'alpha')
  const beta = join(dir, 'nested/beta')
  const t = await launch(dir, { gitPanelView: 'list' })
  await openPanel(t)
  await untilFrame(t, 'nested/beta/b.ts')

  await press(t, input => input.pressArrow('down')) // beta is the second flat row
  await press(t, input => void input.typeText('d'))
  expect(frame(t)).toContain('Discard changes')
  git(alpha, 'checkout', '-q', 'HEAD', '--', 'a.ts')
  await until(t, () => !frame(t).includes('alpha/a.ts'))

  await press(t, input => input.pressEnter())
  await until(t, () => readFileSync(join(beta, 'b.ts'), 'utf8') === 'beta\n')
  expect(subject(alpha)).toBe('init')
  expect(subject(beta)).toBe('init')
}, 20_000)
