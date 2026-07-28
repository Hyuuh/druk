import { spawn, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LineChange = 'added' | 'modified' | 'deleted'
export type FileStatus = 'untracked' | 'added' | 'modified' | 'deleted'

/**
 * Queries run synchronously (`git`) — they sit behind the gutter marks, tree marks
 * and status bar, and finish in milliseconds. Mutations run through `mutate`,
 * asynchronously: a push or fetch talks to the network and would freeze the whole
 * TUI for its duration if awaited on the render thread's clock.
 *
 * `spawnSync` truncates at 1 MB by default and reports ENOBUFS, which every caller
 * here reads as "no output" — `status` would lose files in a large repository.
 */
const MAX_OUTPUT = 128 * 1024 * 1024

function git(cwd: string, args: string[], timeout = 5000) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout, maxBuffer: MAX_OUTPUT })
}

/**
 * Lines changed against HEAD, keyed by 0-based line number. Returns an empty map
 * outside a repository, for untracked files, or when git is unavailable.
 */
export function diffLines(path: string): Map<number, LineChange> {
  const marks = new Map<number, LineChange>()
  const run = git(dirname(path), ['diff', '--no-color', '--unified=0', '--', path], 3000)
  if (run.status !== 0 || !run.stdout) return marks

  for (const hunk of run.stdout.split('\n')) {
    // @@ -oldStart,oldCount +newStart,newCount @@
    const header = hunk.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!header) continue
    const removed = header[1] === undefined ? 1 : Number(header[1])
    const start = Number(header[2])
    const added = header[3] === undefined ? 1 : Number(header[3])

    if (added === 0) {
      // Pure deletion: mark the line the removed text sat above.
      marks.set(Math.max(0, start - 1), 'deleted')
      continue
    }
    // A hunk that replaces N lines with M: the first N are rewrites, the rest new.
    for (let i = 0; i < added; i++) {
      marks.set(start - 1 + i, i < removed ? 'modified' : 'added')
    }
  }
  return marks
}

/**
 * Current branch, or null outside a repository and on a detached HEAD —
 * `--abbrev-ref` answers the literal "HEAD" there, which is not a branch name and
 * must never reach `git push --set-upstream`.
 */
export function currentBranch(cwd: string): string | null {
  const run = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 3000)
  if (run.status !== 0) return null
  const branch = run.stdout.trim()
  return branch.length > 0 && branch !== 'HEAD' ? branch : null
}

const STATUS_BY_CODE: Record<string, FileStatus> = {
  '?': 'untracked',
  'A': 'added',
  'M': 'modified',
  'R': 'modified',
  'C': 'modified',
  'U': 'modified',
  'D': 'deleted',
}

/**
 * Directory git-relative paths are joined onto. git reports the resolved root
 * (/private/var/…), while the tree holds the path the user opened (/var/…) —
 * so the caller's form wins when the two are the same place. Null outside a
 * repository.
 */
function keyBase(cwd: string): string | null {
  const top = git(cwd, ['rev-parse', '--show-toplevel'], 3000)
  if (top.status !== 0) return null
  const root = top.stdout.trim()
  try {
    if (realpathSync(cwd) === realpathSync(root)) return cwd
  } catch {
    // unreadable path: fall back to git's own root
  }
  return root
}

/**
 * Working-tree status per absolute path. Staged and unstaged changes collapse to
 * one mark — the tree only needs "this differs from HEAD".
 */
export function statusMap(cwd: string): Map<string, FileStatus> {
  const statuses = new Map<string, FileStatus>()
  const base = keyBase(cwd)
  if (base === null) return statuses

  // `-z` because the default output C-quotes and octal-escapes any path that is
  // not plain ASCII; unquoting that by hand loses every accented or spaced name.
  // `-uall`, or a brand-new directory collapses to a single `?? newdir/` entry
  // and every file inside it shows no mark at all.
  const run = git(cwd, ['status', '--porcelain', '-z', '-uall'])
  if (run.status !== 0) return statuses

  const entries = run.stdout.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.length < 4) continue
    // Both porcelain columns mean "differs from HEAD"; staged wins when both are set.
    const code = entry[0] !== ' ' ? entry[0]! : entry[1]!
    // A rename or copy spends a second field on the path it came from.
    if (entry[0] === 'R' || entry[0] === 'C') i++
    const status = STATUS_BY_CODE[code]
    if (status) statuses.set(join(base, entry.slice(3)), status)
  }
  return statuses
}

export interface Upstream {
  /** `origin/main`, or null when the branch was never pushed. */
  name: string | null
  /** Commits here but not on the remote, and the other way round. */
  ahead: number
  behind: number
}

/**
 * Where a push would go and how far apart the two sides are. Two subprocesses at
 * worst, one outside a repository — the status bar asks for this often enough
 * that a `currentBranch` call on top of them is worth avoiding.
 */
export function upstreamOf(cwd: string): Upstream | null {
  const ref = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (ref.status !== 0) {
    // No upstream and no repository look the same here; the branch tells them apart.
    // Ahead/behind stay 0: with nothing to compare against there is no distance to
    // report, and a repo with no remote at all must not show a phantom ↑.
    return currentBranch(cwd) ? { name: null, ahead: 0, behind: 0 } : null
  }

  const counts = git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  const [behind, ahead] = (counts.stdout ?? '').trim().split(/\s+/).map(Number)
  return { name: ref.stdout.trim(), ahead: ahead ?? 0, behind: behind ?? 0 }
}

export function inRepository(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--is-inside-work-tree'], 3000).stdout?.trim() === 'true'
}

/**
 * Absolute paths staged in the index, keyed like `statusMap` so the two can be
 * compared. On an unborn branch git diffs the index against the empty tree, so
 * a fresh repository with staged files still reports correctly.
 */
export function stagedPaths(cwd: string): Set<string> {
  const staged = new Set<string>()
  const base = keyBase(cwd)
  if (base === null) return staged
  // `-z` for the same reason as `statusMap`: quoted paths would never match its keys.
  const run = git(cwd, ['diff', '--cached', '--name-only', '-z'])
  if (run.status !== 0) return staged
  for (const rel of run.stdout.split('\0')) {
    if (rel.length > 0) staged.add(join(base, rel))
  }
  return staged
}

/** Subject of HEAD, or null with no commits yet — what "undo last commit" names. */
export function lastCommitSubject(cwd: string): string | null {
  const run = git(cwd, ['log', '-1', '--format=%s'], 3000)
  if (run.status !== 0) return null
  const subject = run.stdout.trim()
  return subject.length > 0 ? subject : null
}

export interface GitResult {
  ok: boolean
  /** One status-bar line: the first thing git said worth repeating. */
  detail: string
}

/** Long enough for a slow push; nothing druk runs should legitimately outlast it. */
const MUTATE_TIMEOUT = 60_000

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) ?? ''
  )
}

function mutate(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise(resolve => {
    const child = spawn('git', args, {
      cwd,
      // Without this an https remote with no cached credential makes git *prompt*
      // on the terminal druk owns — an invisible question the TUI hangs behind.
      // Failing fast turns it into a status-bar error instead.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), MUTATE_TIMEOUT)
    // 'error' (spawn failure) and 'close' can both fire; the first one answers.
    let settled = false
    const finish = (result: GitResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', err => finish({ ok: false, detail: err.message }))
    child.on('close', code => {
      // Success chatter (push progress, fetch summaries) arrives on stderr too,
      // so on failure stderr is the answer and on success either will do.
      const ok = code === 0
      finish({ ok, detail: firstLine(ok ? stdout || stderr : stderr || stdout) })
    })
  })
}

/** Stage and commit exactly `paths`; anything staged for other paths stays staged. */
export async function commitPaths(
  cwd: string,
  message: string,
  paths: string[],
): Promise<GitResult> {
  // -A scoped to the paths: it is what stages a deletion or an untracked file.
  const add = await mutate(cwd, ['add', '-A', '--', ...paths])
  if (!add.ok) return add
  return mutate(cwd, ['commit', '-m', message, '--', ...paths])
}

/** Soft reset: the commit is gone, its changes stay staged. */
export function undoLastCommit(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['reset', '--soft', 'HEAD~1'])
}

export function stashPush(cwd: string): Promise<GitResult> {
  // -u: "stash my changes" from an editor includes the files just created.
  return mutate(cwd, ['stash', 'push', '-u'])
}

export function stashPop(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['stash', 'pop'])
}

export function push(cwd: string, branch: string, hasUpstream: boolean): Promise<GitResult> {
  return mutate(cwd, hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', branch])
}

export function fetchRemote(cwd: string): Promise<GitResult> {
  return mutate(cwd, ['fetch'])
}

export function pull(cwd: string): Promise<GitResult> {
  // --ff-only: a real merge wants an editor and a conflict UI druk does not have.
  return mutate(cwd, ['pull', '--ff-only'])
}
