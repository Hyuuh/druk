import { afterEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { fakeGh } from './fakeGh'
import type { FakeFile } from './fakeGh'
import { launch, press, runCommand, until, untilFrame } from './helpers'
import type { Harness } from './helpers'
import { git, originWithClones } from './repo'

const REPO_URL = 'https://github.com/acme/widgets'

const NO_GH = process.env.DRUK_GH
afterEach(() => {
  process.env.DRUK_GH = NO_GH
})

const rev = (dir: string, ref: string) =>
  execFileSync('git', ['rev-parse', ref], { cwd: dir }).toString().trim()

// `origin` is named by its GitHub URL and rewritten to a local bare repository, so a fetch
// the page makes goes through the same remote lookup it would against github.com.
function prRepo() {
  const { clone, origin } = originWithClones('druk-pr-')
  const dir = clone('mine')
  git(dir, 'config', `url.${origin}.insteadOf`, `${REPO_URL}.git`)
  git(dir, 'remote', 'set-url', 'origin', `${REPO_URL}.git`)
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'b.ts'), 'export const b = 1\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  git(dir, 'push', '-q', 'origin', 'main')
  git(dir, 'switch', '-qc', 'feature')
  writeFileSync(join(dir, 'a.ts'), 'export const a = 2\n')
  writeFileSync(join(dir, 'c.ts'), 'export const c = 3\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'widgets')
  return { clone, dir, origin }
}

const pr = (dir: string, head = rev(dir, 'HEAD')) => ({
  author: { login: 'octo' },
  baseRefName: 'main',
  baseRefOid: rev(dir, 'main'),
  headRefName: 'feature',
  headRefOid: head,
  id: 'PR_kwDO7',
  isDraft: false,
  number: 7,
  state: 'OPEN',
  title: 'Add widgets',
  url: `${REPO_URL}/pull/7`,
})

const files = (viewedA: FakeFile['viewed'] = 'UNVIEWED'): FakeFile[] => [
  { additions: 1, deletions: 1, path: 'a.ts', viewed: viewedA },
  { additions: 1, deletions: 0, path: 'c.ts', viewed: 'UNVIEWED' },
]

async function openPr(t: Harness) {
  await runCommand(t, 'Open pull request for this branch')
  await untilFrame(t, '#7 Add widgets')
}

test('the branch’s pull request opens as a diff page with GitHub’s viewed marks', async () => {
  const { dir } = prRepo()
  const gh = fakeGh({ files: files('VIEWED'), pr: pr(dir) })
  process.env.DRUK_GH = gh.bin

  const t = await launch(dir, {}, { height: 30, width: 120 })
  await openPr(t)
  await untilFrame(t, '+ export const c = 3')

  const frame = t.captureCharFrame()
  expect(frame).toContain('@octo · main ← feature · open · 1/2 viewed')
  expect(frame).toContain('▸ M a.ts')
  expect(frame).toContain('[✓] viewed')
  expect(frame).toContain('▾ A c.ts')
  expect(frame).toContain('[ ] viewed')
  // A viewed file is folded, as GitHub folds it.
  expect(frame).not.toContain('+ export const a = 2')
})

test('Space marks the selected file viewed on GitHub and folds it', async () => {
  const { dir } = prRepo()
  const gh = fakeGh({ files: files(), pr: pr(dir) })
  process.env.DRUK_GH = gh.bin

  const t = await launch(dir, {}, { height: 30, width: 120 })
  await openPr(t)
  await untilFrame(t, '+ export const a = 2')
  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.pressKey(' '))

  await until(t, () => gh.read().log.length > 0)
  expect(gh.read().log).toEqual(['mark:a.ts'])
  await untilFrame(t, '1/2 viewed')
  expect(t.captureCharFrame()).toContain('▸ M a.ts')
  expect(t.captureCharFrame()).not.toContain('+ export const a = 2')

  await press(t, (i) => i.pressKey(' '))
  await until(t, () => gh.read().log.length > 1)
  expect(gh.read().log).toEqual(['mark:a.ts', 'unmark:a.ts'])
  await untilFrame(t, '0/2 viewed')
})

test('a mark GitHub refuses goes back, and says why', async () => {
  const { dir } = prRepo()
  const gh = fakeGh({ files: files(), pr: pr(dir) })
  gh.update({ refuse: true })
  process.env.DRUK_GH = gh.bin

  const t = await launch(dir, {}, { height: 30, width: 120 })
  await openPr(t)
  await press(t, (i) => i.pressTab())
  await press(t, (i) => i.pressKey(' '))

  await untilFrame(t, 'Could not mark a.ts')
  expect(t.captureCharFrame()).toContain('Resource not accessible')
  await untilFrame(t, '0/2 viewed')
  expect(t.captureCharFrame()).toContain('▾ M a.ts')
})

test('a head commit that is not here yet is fetched from the remote', async () => {
  const { clone, dir } = prRepo()
  const theirs = clone('theirs')
  git(theirs, 'switch', '-qc', 'remote-only')
  writeFileSync(join(theirs, 'b.ts'), 'export const b = 99\n')
  git(theirs, 'commit', '-qam', 'from a fork')
  git(theirs, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head')
  const head = rev(theirs, 'HEAD')

  const gh = fakeGh({
    files: [{ additions: 1, deletions: 1, path: 'b.ts', viewed: 'UNVIEWED' }],
    pr: pr(dir, head),
  })
  process.env.DRUK_GH = gh.bin

  const t = await launch(dir, {}, { height: 30, width: 120 })
  await openPr(t)
  await untilFrame(t, '+ export const b = 99')
  expect(t.captureCharFrame()).toContain('- export const b = 1')
})

test('a branch with no pull request says so instead of opening a page', async () => {
  const { dir } = prRepo()
  const gh = fakeGh({ files: [], pr: null })
  process.env.DRUK_GH = gh.bin

  const t = await launch(dir)
  await runCommand(t, 'Open pull request for this branch')
  await untilFrame(t, 'No pull request for this branch')
  expect(t.captureCharFrame()).not.toContain('Pull request #')
})

test('without gh the command names what is missing', async () => {
  const { dir } = prRepo()

  const t = await launch(dir)
  await runCommand(t, 'Open pull request for this branch')
  await untilFrame(t, 'GitHub CLI (gh) is not installed')
})
