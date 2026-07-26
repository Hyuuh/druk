import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LineChange = 'added' | 'modified' | 'deleted'
export type FileStatus = 'untracked' | 'added' | 'modified' | 'deleted'

/**
 * Lines changed against HEAD, keyed by 0-based line number. Returns an empty map
 * outside a repository, for untracked files, or when git is unavailable.
 */
export function diffLines(path: string): Map<number, LineChange> {
  const marks = new Map<number, LineChange>()
  const run = spawnSync('git', ['diff', '--no-color', '--unified=0', '--', path], {
    cwd: dirname(path),
    encoding: 'utf8',
    timeout: 3000,
  })
  if (run.error || run.status !== 0 || !run.stdout) return marks

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

/** Current branch, or null outside a repository. */
export function currentBranch(cwd: string): string | null {
  const run = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    timeout: 3000,
  })
  if (run.error || run.status !== 0) return null
  const branch = run.stdout.trim()
  return branch.length > 0 ? branch : null
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
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    timeout: 3000,
  })
  if (top.error || top.status !== 0) return statuses
  // git reports the resolved path (/private/var/…), while the tree holds the
  // path the user opened (/var/…). Key by the caller's form when they match.
  const root = top.stdout.trim()
  let base = root
  try {
    if (realpathSync(cwd) === realpathSync(root)) base = cwd
  } catch {
    // unreadable path: fall back to git's own root
  }

  const run = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (run.error || run.status !== 0) return statuses

  for (const line of run.stdout.split('\n')) {
    if (line.length < 4) continue
    const code = line[0] === '?' ? '?' : line[0] !== ' ' ? line[0]! : line[1]!
    const status = STATUS_BY_CODE[code]
    if (!status) continue
    // Renames read "old -> new"; the new path is the one on disk.
    const path = line.slice(3).split(' -> ').at(-1)!.replace(/^"|"$/g, '')
    statuses.set(join(base, path), status)
  }
  return statuses
}

export interface Branch {
  /** `main` for a local branch, `origin/main` for a remote-tracking one. */
  name: string
  remote: boolean
  current: boolean
}

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 })
}

/** First line of git's own complaint, so the status bar can show something useful. */
function failure(run: ReturnType<typeof git>): string {
  const message = (run.stderr || run.stdout || '').trim().split('\n')[0]
  return message && message.length > 0 ? message : 'git failed'
}

/** Local branches first, then remote-tracking ones. Empty outside a repository. */
export function listBranches(cwd: string): Branch[] {
  const run = git(cwd, ['branch', '--all', '--format=%(refname)%09%(refname:short)%09%(HEAD)'])
  if (run.error || run.status !== 0) return []

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
  if (run.error || run.status !== 0) return null
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

/** Restore the most recent stash and drop it. */
export function popStash(cwd: string): string | null {
  const run = git(cwd, ['stash', 'pop'])
  return run.status === 0 ? null : failure(run)
}
