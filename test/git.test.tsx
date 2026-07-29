import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { currentBranch, diffLines, explain, failureLine, KNOWN, statusMap } from '../src/core/git'
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
  expect(footer).not.toMatch(/↑\d/)
  expect(footer).not.toMatch(/↓\d/)
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

test('every file inside a brand-new directory is marked, not just the directory', async () => {
  // `git status --porcelain` collapses an untracked directory to one `?? dir/`
  // entry, which left every file inside it with no mark at all.
  const dir = repo('one\n')
  mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true })
  writeFileSync(join(dir, 'newdir', 'a.ts'), 'const a = 1\n')
  writeFileSync(join(dir, 'newdir', 'sub', 'b.ts'), 'const b = 2\n')

  const statuses = statusMap(dir)
  expect(statuses.get(join(dir, 'newdir', 'a.ts'))).toBe('untracked')
  expect(statuses.get(join(dir, 'newdir', 'sub', 'b.ts'))).toBe('untracked')

  // And the tree shows the mark on the files, with the folders inheriting it.
  const t = await launch(dir)
  await press(t, i => i.pressArrow('down'))
  await press(t, i => i.pressEnter())
  const frame = t.captureCharFrame()
  expect(frame).toContain('newdir')
  expect(frame).toContain('a.ts')
  expect(frame.split('\n').find(row => row.includes('a.ts'))).toContain('U')
})

test('a failed git command reports its cause, not its advice', () => {
  // Verbatim from `git pull` on diverged branches: git prints its advice first
  // and the reason last, so taking the first line showed a truncated hint.
  const diverged = [
    "hint: Diverging branches can't be fast-forwarded, you need to either:",
    'hint:',
    'hint: \tgit merge --no-ff',
    'hint:',
    'hint: or:',
    'hint:',
    'hint: \tgit rebase',
    'hint:',
    'hint: Disable this message with "git config set advice.diverging false"',
    'fatal: Not possible to fast-forward, aborting.',
  ].join('\n')
  expect(failureLine(diverged)).toBe('Not possible to fast-forward, aborting.')

  // A rejected push has no `fatal:` at all: the destination header and the
  // trailing hints are noise, and the rejection itself is what to show.
  const rejected = [
    'To https://github.com/user/repo',
    ' ! [rejected]        main -> main (non-fast-forward)',
    "error: failed to push some refs to 'https://github.com/user/repo'",
    'hint: Updates were rejected because the tip of your current branch is behind',
  ].join('\n')
  expect(failureLine(rejected)).toBe('! [rejected]        main -> main (non-fast-forward)')

  // Nothing but advice still has to say something rather than go blank.
  expect(failureLine('hint: only advice here\n')).toBe('hint: only advice here')
  expect(failureLine('')).toBe('')

  // An `error:` with no rejection line loses its prefix — the bar colours it.
  expect(failureLine("error: pathspec 'nope' did not match")).toBe("pathspec 'nope' did not match")
})

/**
 * Every string below is verbatim git output, captured by provoking the failure
 * against real repositories — the wording is the whole contract here, and a
 * paraphrase would pass while the real message sailed past unrecognised.
 */
test('known git failures are named in terms of what to do next', () => {
  const cases: Array<[string, string]> = [
    [
      'fatal: Not possible to fast-forward, aborting.',
      'Branch and origin have both moved on — merge or rebase in a terminal',
    ],
    [
      'fatal: Need to specify how to reconcile divergent branches.',
      'Branch and origin have both moved on — merge or rebase in a terminal',
    ],
    [
      'To https://github.com/user/repo\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs',
      "origin has commits you don't — pull first, then push",
    ],
    [
      'error: Your local changes to the following files would be overwritten by merge:\n\tf.txt\nPlease commit your changes or stash them before you merge.\nAborting',
      'Commit or stash your changes first — this would overwrite them',
    ],
    [
      'Auto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\nThe stash entry is kept in case you need it again.',
      'Conflicts in the working tree — the stash was kept, resolve them first',
    ],
    [
      'error: Pulling is not possible because you have unmerged files.\nfatal: Exiting because of an unresolved conflict.',
      'Resolve the merge conflicts in your working tree first',
    ],
    ['On branch master\nnothing to commit, working tree clean', 'Nothing to commit'],
    [
      "fatal: ambiguous argument 'HEAD~1': unknown revision or path not in the working tree.",
      'Nothing to undo — this is the only commit',
    ],
    ['No stash entries found.', 'No stash to pop'],
    ['fatal: No configured push destination.', "No remote — add an 'origin' in a terminal"],
    [
      "fatal: unable to access 'https://x.invalid/y.git/': Could not resolve host: x.invalid",
      "Can't reach the remote — check your network",
    ],
    [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "No stored credentials for the remote — druk can't prompt for them",
    ],
    [
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      'The remote rejected your SSH key',
    ],
    [
      "remote: HTTP Basic: Access denied.\nfatal: Authentication failed for 'https://gitlab.com/x/y.git/'",
      'Authentication failed — check your credentials for the remote',
    ],
    [
      "remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found",
      "Remote repository not found — check the 'origin' URL",
    ],
    [
      "fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository",
      'Another git process is running in this repository — let it finish',
    ],
  ]
  for (const [output, message] of cases)
    expect([output, explain(output)]).toEqual([output, message])

  // Anything unrecognised still falls through to git's own most useful line.
  expect(explain("error: pathspec 'nope' did not match any file(s)")).toBe(
    "pathspec 'nope' did not match any file(s)",
  )
})

test('a message never outgrows the status bar', () => {
  // The bar clips with an ellipsis, and these messages exist to be read whole.
  for (const [, message] of KNOWN) expect(message.length).toBeLessThanOrEqual(70)
})

test('a failure split across both streams is still recognised', () => {
  // Verbatim from a second `git stash pop` onto the conflicted tree the first
  // one left. Reading either stream alone reports "could not write index",
  // which names the symptom and not one thing the user can act on.
  const stderr = 'error: could not write index'
  const stdout = 'f.txt: needs merge\nThe stash entry is kept in case you need it again.'
  expect(explain(stderr, stdout)).toBe('Resolve the merge conflicts in your working tree first')
  expect(explain(stderr)).toBe('could not write index')
})
