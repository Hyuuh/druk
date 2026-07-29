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

function git(cwd: string, args: string[], timeout = 5000, input?: string) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT,
    input,
  })
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

/**
 * Which of `paths` gitignore would skip. Empty outside a repository.
 *
 * The companion to `ignoredPaths`, and not a duplicate of it: that one answers
 * "what may the tree hide", which needs no key for anything inside a collapsed
 * directory. This one answers "what does the tree draw dim", which is asked about
 * rows that are on screen *because* nothing is hidden — including the children of
 * an expanded `node_modules`, which `--directory` deliberately never enumerates.
 * Asking per visible path bounds the work by the sidebar's height either way.
 *
 * Paths come back in the same spelling they went in: we feed absolute tree paths
 * on stdin and get those absolutes out, so there is no `keyBase` remapping the
 * way `statusMap` needs for porcelain's repo-relative names — and no `keyBase`
 * call either, which would double the subprocesses this costs per refresh.
 */
export function ignoredAmong(cwd: string, paths: string[]): Set<string> {
  const ignored = new Set<string>()
  if (paths.length === 0) return ignored

  // `-z` + `--stdin`: one NUL-terminated path each way. Exit 1 means none of the
  // paths are ignored, and 128 means there is no repository here — both are an
  // empty set rather than a failure, so only 0 has output worth reading.
  const run = git(cwd, ['check-ignore', '--stdin', '-z'], 5000, `${paths.join('\0')}\0`)
  if (run.status !== 0) return ignored
  for (const path of run.stdout.split('\0')) {
    if (path.length > 0) ignored.add(path)
  }
  return ignored
}

/**
 * The file's content at HEAD, or null when HEAD has no such file (untracked,
 * added, unborn branch, outside a repository). `cwd` anchors the lookup — the
 * `./` spelling makes the path cwd-relative, so a deleted file still resolves
 * even though it no longer exists on disk.
 */
export function headText(cwd: string, relPath: string): string | null {
  const run = git(cwd, ['show', `HEAD:./${relPath}`], 3000)
  return run.status === 0 ? run.stdout : null
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

/**
 * Absolute paths of git-ignored entries, keyed like `statusMap`. Empty outside a
 * repository — with no `.gitignore` semantics to apply, nothing is ignored.
 *
 * `--directory` collapses a fully-ignored directory to one entry instead of
 * enumerating everything inside it — the difference between one line for
 * `node_modules` and a hundred thousand. The tree matches these keys exactly:
 * it hides an ignored directory at its top and never descends, so the collapsed
 * entry is the only key it ever asks about. Dimming cannot use these keys for
 * exactly that reason — see `ignoredAmong`.
 */
export function ignoredPaths(cwd: string): Set<string> {
  const ignored = new Set<string>()
  const base = keyBase(cwd)
  if (base === null) return ignored
  // `-z` for the same reason as `statusMap`: quoted paths would never match its keys.
  const run = git(cwd, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
  ])
  if (run.status !== 0) return ignored
  for (const rel of run.stdout.split('\0')) {
    if (rel.length === 0) continue
    // A collapsed directory keeps git's trailing separator; the tree's paths have none.
    ignored.add(join(base, rel.endsWith('/') ? rel.slice(0, -1) : rel))
  }
  return ignored
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

function lines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

function firstLine(text: string): string {
  return lines(text)[0] ?? ''
}

/** Advice and progress chatter git emits around the one line that says what broke. */
const NOISE = /^(?:hint|warning|note):|^To\s|^remote:\s*$/i

/**
 * What the status bar shows when git fails. Git puts its advice *before* the
 * cause, so the first line is usually the wrong one: a rejected pull opens with
 * a dozen `hint:` lines and only ends with the `fatal:` that names the problem.
 * Prefer that line, fall back to whatever survives the noise filter, and strip
 * the severity prefix — the bar already colours the message as an error.
 */
export function failureLine(text: string): string {
  const all = lines(text)
  const signal = all.filter(line => !NOISE.test(line))
  const chosen = signal.find(line => line.startsWith('fatal:')) ?? signal[0] ?? all[0] ?? ''
  return chosen.replace(/^(?:fatal|error):\s*/, '')
}

/**
 * Failures worth naming, in the terms of what to do next. Git's own wording
 * assumes a shell where the fix is one command away, and druk runs a fixed set
 * of commands with no shell to offer — so each of these says what happened and
 * where the fix lives, pointing at druk's own commands where it has one.
 *
 * Matched against git's whole output, not the chosen line: the reason and the
 * command that failed routinely sit on different lines. First match wins, so
 * the specific patterns have to stay above the general ones — "Authentication
 * failed" would otherwise swallow the missing-credentials case below it.
 */
export const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  // druk pulls with --ff-only; a real merge needs an editor and a conflict UI.
  [
    /Not possible to fast-forward|Need to specify how to reconcile/i,
    'Branch and origin have both moved on — merge or rebase in a terminal',
  ],
  [
    /\[rejected\].*(?:non-fast-forward|fetch first)/i,
    "origin has commits you don't — pull first, then push",
  ],
  [
    /local changes to the following files would be overwritten/i,
    'Commit or stash your changes first — this would overwrite them',
  ],
  [
    /^CONFLICT|Merge conflict in/im,
    'Conflicts in the working tree — the stash was kept, resolve them first',
  ],
  [
    /unmerged files|needs merge|unresolved conflict/i,
    'Resolve the merge conflicts in your working tree first',
  ],
  [/nothing to commit|no changes added to commit/i, 'Nothing to commit'],
  // Undo is `reset --soft HEAD~1`, so a root commit has nothing to reset to.
  [/ambiguous argument 'HEAD~1'/i, 'Nothing to undo — this is the only commit'],
  [/No stash entries found/i, 'No stash to pop'],
  [
    /No configured push destination|does not appear to be a git repository/i,
    "No remote — add an 'origin' in a terminal",
  ],
  [
    /Could not resolve host|unable to access.*(?:Couldn't connect|Connection refused|Operation timed out)/i,
    "Can't reach the remote — check your network",
  ],
  // Ours: GIT_TERMINAL_PROMPT=0 turns git's credential prompt into this.
  [
    /terminal prompts disabled|could not read (?:Username|Password)/i,
    "No stored credentials for the remote — druk can't prompt for them",
  ],
  [/Permission denied \(publickey\)/i, 'The remote rejected your SSH key'],
  [
    /Authentication failed|Invalid username or password|Access denied/i,
    'Authentication failed — check your credentials for the remote',
  ],
  [
    /(?:repository|Repository) .*not found|remote: Not Found/i,
    "Remote repository not found — check the 'origin' URL",
  ],
  [
    /index\.lock.*File exists|Another git process seems to be running/i,
    'Another git process is running in this repository — let it finish',
  ],
]

/**
 * A known failure named in druk's terms, or git's own most useful line.
 *
 * Both streams are matched, because git routinely splits one failure across the
 * two: a stash pop onto an unmerged index puts `error: could not write index` on
 * stderr and the `f.txt: needs merge` that actually explains it on stdout. Only
 * the fallback keeps to one stream, where stderr is the better guess.
 */
export function explain(stderr: string, stdout = ''): string {
  const both = `${stderr}\n${stdout}`
  for (const [pattern, message] of KNOWN) {
    if (pattern.test(both)) return message
  }
  return failureLine(stderr || stdout)
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
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, MUTATE_TIMEOUT)
    // 'error' (spawn failure) and 'close' can both fire; the first one answers.
    let settled = false
    const finish = (result: GitResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', err =>
      finish({
        ok: false,
        detail:
          // The one failure with no git output to explain: there is no git.
          'code' in err && err.code === 'ENOENT'
            ? 'git is not installed, or not on PATH'
            : err.message,
      }),
    )
    child.on('close', code => {
      // Success chatter (push progress, fetch summaries) arrives on stderr too,
      // so on failure stderr is the answer and on success either will do.
      const ok = code === 0
      if (ok) return finish({ ok, detail: firstLine(stdout || stderr) })
      // A killed process leaves whatever it had already written, which for a
      // hung fetch is nothing at all — say why it stopped instead of going blank.
      const detail = killed
        ? `Timed out after ${MUTATE_TIMEOUT / 1000}s and was stopped`
        : explain(stderr, stdout)
      finish({ ok, detail })
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
