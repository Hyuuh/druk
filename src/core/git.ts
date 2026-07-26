import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LineChange = 'added' | 'modified' | 'deleted'
export type FileStatus = 'untracked' | 'added' | 'modified' | 'deleted'

/** Talking to a remote is not instant; local plumbing must never wait this long. */
const NETWORK_MS = 30_000

/**
 * git prompts on /dev/tty, which it opens itself — the prompt would be painted over
 * the alt-screen and block the single thread that renders and reads keys until the
 * timeout kills it. Failing fast turns a frozen editor into a status-bar message.
 */
const NO_PROMPT = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND ?? 'ssh'} -o BatchMode=yes`,
}

function git(cwd: string, args: string[], timeout = 5000) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    env: timeout === NETWORK_MS ? { ...process.env, ...NO_PROMPT } : process.env,
  })
}

/**
 * Git's own complaint, for the status bar. Not simply the first line: `pull` and
 * `push` print remote progress before the reason they failed.
 */
function failure(run: ReturnType<typeof git>): string {
  const lines = (run.stderr || run.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const complaint = lines.find(line => line.startsWith('fatal:') || line.startsWith('error:'))
  return complaint ?? lines.at(-1) ?? 'git failed'
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
 * Working-tree status per absolute path. Staged and unstaged changes collapse to
 * one mark — the tree only needs "this differs from HEAD".
 */
export function statusMap(cwd: string): Map<string, FileStatus> {
  const statuses = new Map<string, FileStatus>()
  const top = git(cwd, ['rev-parse', '--show-toplevel'], 3000)
  if (top.status !== 0) return statuses
  // git reports the resolved path (/private/var/…), while the tree holds the
  // path the user opened (/var/…). Key by the caller's form when they match.
  const root = top.stdout.trim()
  let base = root
  try {
    if (realpathSync(cwd) === realpathSync(root)) base = cwd
  } catch {
    // unreadable path: fall back to git's own root
  }

  // `-z` because the default output C-quotes and octal-escapes any path that is
  // not plain ASCII; unquoting that by hand loses every accented or spaced name.
  const run = git(cwd, ['status', '--porcelain', '-z'])
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

export interface Branch {
  /** `main` for a local branch, `origin/main` for a remote-tracking one. */
  name: string
  remote: boolean
  current: boolean
}

/** Local branches first, then remote-tracking ones. Empty outside a repository. */
export function listBranches(cwd: string): Branch[] {
  const run = git(cwd, ['branch', '--all', '--format=%(refname)%09%(refname:short)%09%(HEAD)'])
  if (run.status !== 0) return []

  const local: Branch[] = []
  const remote: Branch[] = []
  for (const line of run.stdout.split('\n')) {
    const [ref, name, head] = line.split('\t')
    if (!ref || !name) continue
    // `origin/HEAD` is a symbolic ref to another branch, not a checkout target.
    if (ref.endsWith('/HEAD')) continue
    const branch = { name, remote: ref.startsWith('refs/remotes/'), current: head === '*' }
    ;(branch.remote ? remote : local).push(branch)
  }
  return [...local, ...remote]
}

/**
 * Check out an existing branch. A remote-tracking ref cannot be checked out as
 * itself, so `origin/x` becomes a local `x` that tracks it.
 */
export function checkoutBranch(cwd: string, branch: Branch): string | null {
  const local = branch.remote ? branch.name.split('/').slice(1).join('/') : branch.name
  const run = git(cwd, ['switch', local])
  if (run.status === 0) return null
  // No local branch of that name and the DWIM guess failed (several remotes carry it).
  if (branch.remote) {
    const tracked = git(cwd, ['switch', '--track', branch.name])
    if (tracked.status === 0) return null
    return failure(tracked)
  }
  return failure(run)
}

/** Create `name` starting at `from` (HEAD when omitted) and switch to it. */
export function createBranch(cwd: string, name: string, from?: string): string | null {
  const run = git(cwd, from ? ['switch', '-c', name, from] : ['switch', '-c', name])
  return run.status === 0 ? null : failure(run)
}

/** Delete a local branch. `force` discards unmerged commits. */
export function deleteBranch(cwd: string, name: string, force = false): string | null {
  const run = git(cwd, ['branch', force ? '-D' : '-d', name])
  return run.status === 0 ? null : failure(run)
}

/**
 * Stage everything and commit. Untracked files are included: the palette shows
 * the same working-tree marks the tree does, so "commit" means all of them.
 */
export function commitAll(cwd: string, message: string): string | null {
  const staged = git(cwd, ['add', '-A'])
  if (staged.status !== 0) return failure(staged)
  const run = git(cwd, ['commit', '-m', message])
  return run.status === 0 ? null : failure(run)
}

/** Subject of HEAD, or null outside a repository or before the first commit. */
export function lastCommitSubject(cwd: string): string | null {
  const run = git(cwd, ['log', '-1', '--pretty=%s'])
  if (run.status !== 0) return null
  const subject = run.stdout.trim()
  return subject.length > 0 ? subject : null
}

/**
 * Undo the last commit, keeping its changes in the working tree. The commit is
 * still reachable through the reflog, so nothing is destroyed.
 */
export function undoLastCommit(cwd: string): string | null {
  const run = git(cwd, ['reset', '--soft', 'HEAD~1'])
  return run.status === 0 ? null : failure(run)
}

/** Shelve every change, untracked files included. */
export function stashAll(cwd: string): string | null {
  const run = git(cwd, ['stash', 'push', '--include-untracked'])
  if (run.status !== 0) return failure(run)
  // `git stash` succeeds with this on its stdout when there was nothing to shelve.
  return run.stdout.includes('No local changes') ? 'Nothing to stash' : null
}

export function popStash(cwd: string): string | null {
  const run = git(cwd, ['stash', 'pop'])
  return run.status === 0 ? null : failure(run)
}

export interface Upstream {
  /** `origin/main`, or null when the branch was never pushed. */
  name: string | null
  /** Commits here but not on the remote, and the other way round. */
  ahead: number
  behind: number
}

const count = (run: ReturnType<typeof git>) => Number(run.stdout?.trim()) || 0

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

/**
 * Commits a first push would publish. `upstreamOf` cannot answer this — there is
 * no upstream to diff against yet — so the push prompt asks separately rather
 * than claiming "0 commit(s)".
 */
export function unpushedCount(cwd: string): number {
  return count(git(cwd, ['rev-list', '--count', 'HEAD']))
}

/** Publish the current branch, creating the upstream on first push. */
export function push(cwd: string): string | null {
  const branch = currentBranch(cwd)
  if (!branch) return 'Not on a branch'
  const tracked = upstreamOf(cwd)?.name
  const args = tracked ? ['push'] : ['push', '--set-upstream', 'origin', branch]
  const run = git(cwd, args, NETWORK_MS)
  return run.status === 0 ? null : failure(run)
}

/**
 * Fast-forward only: a pull that silently merges or rebases would rewrite work
 * the editor has open, so divergence is reported instead.
 */
export function pull(cwd: string): string | null {
  const run = git(cwd, ['pull', '--ff-only'], NETWORK_MS)
  return run.status === 0 ? null : failure(run)
}

export function fetchAll(cwd: string): string | null {
  const run = git(cwd, ['fetch', '--all', '--prune'], NETWORK_MS)
  return run.status === 0 ? null : failure(run)
}

export function discardFile(cwd: string, path: string): string | null {
  const run = git(cwd, ['restore', '--staged', '--worktree', '--', path])
  return run.status === 0 ? null : failure(run)
}

/**
 * Unified diff against HEAD — staged and unstaged together, since the editor
 * never distinguishes them. Empty when nothing changed. Untracked files have no
 * HEAD version to diff, so `--no-index` fakes one against /dev/null.
 */
export function diffText(cwd: string, path?: string): string {
  const args = ['diff', '--no-color', 'HEAD']
  if (path) args.push('--', path)
  const run = git(cwd, args, 15_000)
  if (run.error) return ''
  const tracked = run.status === 0 ? run.stdout : ''
  if (!path || tracked.trim()) return tracked

  // Empty output means either "identical to HEAD" or "git has never seen this
  // file"; only the second one is worth diffing against /dev/null.
  const known = git(cwd, ['ls-files', '--error-unmatch', '--', path])
  if (known.status === 0) return ''

  // Relative, so the header reads `b/new.ts` instead of the whole absolute path.
  const relative = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  const untracked = git(cwd, ['diff', '--no-color', '--no-index', '/dev/null', relative], 15_000)
  // --no-index exits 1 when the files differ, which is the normal case here.
  return untracked.stdout ?? ''
}
