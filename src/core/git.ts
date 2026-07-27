import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LineChange = 'added' | 'modified' | 'deleted'
export type FileStatus = 'untracked' | 'added' | 'modified' | 'deleted'

/**
 * Read-only: druk reports what git says and never asks it to change anything. Every
 * call here is a query behind the gutter marks, the tree marks or the status bar.
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
