import { spawnSync } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Not `run`: every query in this file names its own result `run`, and the two
// spellings sitting in one scope is how a call ends up aimed at the wrong one.
import { notInstalled, run as runProcess } from './process'
import type { ProcessResult } from './process'

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
 * `git` off the render thread, for the comparison queries — the synchronous
 * `git` above would stall a frame for as long as the subprocess takes, which on
 * a branch's worth of files is not a frame's worth of time.
 */
function gitAsync(cwd: string, args: string[], timeout = 10_000): Promise<ProcessResult> {
  return runProcess('git', args, { cwd, timeout, maxOutput: MAX_OUTPUT })
}

/**
 * Lines changed against `ref` (HEAD when null), keyed by 0-based line number.
 * Returns an empty map outside a repository, for untracked files, or when git is
 * unavailable.
 */
export function diffLines(path: string, ref: string | null = null): Map<number, LineChange> {
  const marks = new Map<number, LineChange>()
  const run = git(
    dirname(path),
    ['diff', '--no-color', '--unified=0', ...(ref ? [ref] : []), '--', path],
    3000,
  )
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

export interface Branch {
  /** `main` for a local branch, `origin/main` for a remote-tracking one. */
  name: string
  remote: boolean
  current: boolean
  /** Where this local branch pushes and pulls, e.g. `origin/main`. */
  upstream: string | null
}

export type ComparisonFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typeChanged'

export interface ComparisonRef {
  name: string
  oid: string
}

export interface ComparisonFile {
  path: string
  oldPath: string | null
  status: ComparisonFileStatus
  similarity: number | null
  binary: boolean
  additions: number | null
  deletions: number | null
  oldOid: string | null
  newOid: string | null
}

export interface ComparisonCommit {
  oid: string
  shortOid: string
  subject: string
  authorName: string
  authorEmail: string
  authoredAt: string
  parents: string[]
}

export interface ComparisonStats {
  files: number
  additions: number
  deletions: number
  binaryFiles: number
}

export interface BranchComparison {
  base: ComparisonRef
  compare: ComparisonRef
  mergeBase: string
  ahead: number
  behind: number
  files: ComparisonFile[]
  commits: ComparisonCommit[]
  stats: ComparisonStats
}

export type ComparisonFailure =
  | 'notRepository'
  | 'detachedHead'
  | 'unbornBranch'
  | 'noDefaultBranch'
  | 'invalidBase'
  | 'invalidCompare'
  | 'noMergeBase'
  | 'gitError'
  | 'timeout'

export type ComparisonResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ComparisonFailure; detail: string }

export interface ComparisonIdentity {
  base: ComparisonRef
  compare: ComparisonRef
  mergeBase: string
  ahead: number
  behind: number
}

export type ComparisonContent =
  | { binary: true }
  | { binary: false; oldText: string; newText: string }

export interface ComparisonCommitDetail {
  commit: ComparisonCommit
  files: ComparisonFile[]
  stats: ComparisonStats
}

/**
 * The local name a remote-tracking branch checks out as: `origin/feat` → `feat`.
 * Both the checkout and the message that reports it derive it the same way, so a
 * remote whose name contains a slash cannot make the two disagree.
 */
export function localBranchName(name: string): string {
  return name.slice(name.indexOf('/') + 1)
}

/**
 * Every branch, most recently committed to first — the order a picker wants,
 * since the branch you are looking for is nearly always one you touched today.
 * Empty outside a repository.
 */
export function listBranches(cwd: string): Branch[] {
  // Tab-separated: every field is a ref name or a single character, none of
  // which can contain a tab.
  const format = ['%(refname)', '%(refname:short)', '%(HEAD)', '%(upstream:short)']
  const run = git(cwd, [
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${format.join('\t')}`,
    'refs/heads',
    'refs/remotes',
  ])
  if (run.status !== 0 || !run.stdout) return []

  const branches: Branch[] = []
  for (const line of run.stdout.split('\n')) {
    const [ref, name, head, upstream] = line.split('\t')
    if (!ref || !name) continue
    // `origin/HEAD` is the remote's default-branch pointer, not a branch of its own.
    if (name.endsWith('/HEAD')) continue
    branches.push({
      name,
      remote: ref.startsWith('refs/remotes/'),
      current: head === '*',
      upstream: upstream || null,
    })
  }
  return branches
}

/**
 * The configured branch a comparison starts from. Remote HEAD is repository
 * evidence; `init.defaultBranch` is useful only when that branch actually
 * exists. Guessing main/master would make the same repository compare
 * differently across machines.
 */
export function defaultBranch(cwd: string): string | null {
  const remotes = git(cwd, ['remote']).stdout?.trim().split('\n').filter(Boolean) ?? []
  for (const remote of remotes.toSorted((a, b) => {
    if (a === 'origin') return -1
    if (b === 'origin') return 1
    return a.localeCompare(b)
  })) {
    const head = git(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`])
    if (head.status === 0 && head.stdout.trim()) return head.stdout.trim()
  }

  const configured = git(cwd, ['config', '--get', 'init.defaultBranch'])
  const name = configured.status === 0 ? configured.stdout.trim() : ''
  if (!name) return null
  return git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).status === 0
    ? name
    : null
}

function comparisonFailure(reason: ComparisonFailure, detail: string): ComparisonResult<never> {
  return { ok: false, reason, detail }
}

function asyncFailure(run: ProcessResult, fallback: string): ComparisonResult<never> {
  if (run.timedOut) return comparisonFailure('timeout', `${fallback} timed out`)
  if (run.overflow) return comparisonFailure('gitError', `${fallback} produced too much output`)
  return comparisonFailure('gitError', run.stderr.trim() || fallback)
}

/**
 * Resolve the two branch tips and their history relationship before any file
 * metadata is loaded. Explicit OIDs make every later query a stable snapshot
 * even if a ref moves while it is running.
 */
export async function resolveComparison(
  cwd: string,
  baseName: string,
  compareName?: string,
): Promise<ComparisonResult<ComparisonIdentity>> {
  if (!inRepository(cwd)) return comparisonFailure('notRepository', 'Not a git repository')

  let compare = compareName
  if (!compare) {
    const symbolic = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 3000)
    if (symbolic.status !== 0) {
      return comparisonFailure('detachedHead', 'Branch comparison needs a checked-out branch')
    }
    compare = symbolic.stdout.trim()
  }

  const [baseRun, compareRun] = await Promise.all([
    gitAsync(cwd, ['rev-parse', '--verify', `${baseName}^{commit}`]),
    gitAsync(cwd, ['rev-parse', '--verify', `${compare}^{commit}`]),
  ])
  if (compareRun.status !== 0) {
    if (compareRun.timedOut || compareRun.overflow || compareRun.status === null) {
      return asyncFailure(compareRun, `Could not resolve ${compare}`)
    }
    return comparisonFailure(
      compareName ? 'invalidCompare' : 'unbornBranch',
      compareName
        ? `Compare branch "${compare}" does not exist`
        : `Branch "${compare}" has no commits yet`,
    )
  }
  if (baseRun.status !== 0) {
    if (baseRun.timedOut || baseRun.overflow || baseRun.status === null) {
      return asyncFailure(baseRun, `Could not resolve ${baseName}`)
    }
    return comparisonFailure('invalidBase', `Base branch "${baseName}" does not exist`)
  }

  const baseOid = baseRun.stdout.trim()
  const compareOid = compareRun.stdout.trim()
  const mergeBase = await gitAsync(cwd, ['merge-base', baseOid, compareOid])
  if (mergeBase.status !== 0) {
    if (mergeBase.timedOut || mergeBase.overflow || mergeBase.status === null) {
      return asyncFailure(mergeBase, 'Could not find the merge base')
    }
    return comparisonFailure('noMergeBase', 'The branches have no common ancestor')
  }

  const counts = await gitAsync(cwd, [
    'rev-list',
    '--left-right',
    '--count',
    `${baseOid}...${compareOid}`,
  ])
  if (counts.status !== 0) return asyncFailure(counts, 'Could not count branch commits')
  const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map(Number)

  return {
    ok: true,
    value: {
      base: { name: baseName, oid: baseOid },
      compare: { name: compare, oid: compareOid },
      mergeBase: mergeBase.stdout.trim(),
      ahead,
      behind,
    },
  }
}

const COMPARISON_STATUS: Record<string, ComparisonFileStatus | undefined> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged',
}

function comparisonKey(oldPath: string | null, path: string): string {
  return `${oldPath ?? ''}\0${path}`
}

function parseCount(value: string): number | null {
  return value === '-' ? null : Number(value)
}

const COMMIT_FORMAT = '%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P'
const COMMIT_FIELDS = 7

/** `git log -z --format=COMMIT_FORMAT` output: seven NUL-separated fields each. */
function parseCommits(text: string): ComparisonCommit[] | null {
  const fields = text.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % COMMIT_FIELDS !== 0) return null
  const commits: ComparisonCommit[] = []
  for (let at = 0; at < fields.length; at += COMMIT_FIELDS) {
    commits.push({
      oid: fields[at]!,
      shortOid: fields[at + 1]!,
      subject: fields[at + 2]!,
      authorName: fields[at + 3]!,
      authorEmail: fields[at + 4]!,
      authoredAt: fields[at + 5]!,
      parents: fields[at + 6]!.split(' ').filter(Boolean),
    })
  }
  return commits
}

/** git's own name for "nothing", so a root commit needs no special case. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Both halves of `changedFiles` need these, and must agree on them. */
const RENAMES = ['--find-renames', '--find-copies']

interface LineTotals {
  binary: boolean
  additions: number | null
  deletions: number | null
}

/** All-zero is git's "this side does not exist", not an object to read. */
function blobOid(field: string | undefined): string | null {
  return field && !/^0+$/.test(field) ? field : null
}

/**
 * `--numstat -z` totals, keyed by path pair. A record is `adds\tdels\tpath`,
 * except for a rename or a copy, whose path field is empty and whose two paths
 * follow as records of their own. Null if a record is truncated — every parse
 * here refuses partial output rather than dropping a row, because a dropped row
 * would read as "this file did not change".
 */
function parseNumstat(text: string): Map<string, LineTotals> | null {
  const totals = new Map<string, LineTotals>()
  const records = text.split('\0')
  if (records.at(-1) === '') records.pop()
  for (let at = 0; at < records.length; at++) {
    const record = records[at]!
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1)
    if (secondTab < 0) return null
    const inlinePath = record.slice(secondTab + 1)
    let oldPath: string | null = null
    let path = inlinePath
    if (inlinePath.length === 0) {
      if (at + 2 >= records.length) return null
      oldPath = records[at + 1]!
      path = records[at + 2]!
      at += 2
    }
    const additions = parseCount(record.slice(0, firstTab))
    const deletions = parseCount(record.slice(firstTab + 1, secondTab))
    totals.set(comparisonKey(oldPath, path), {
      // git spends a `-` on each count of a file it will not diff as text.
      binary: additions === null || deletions === null,
      additions,
      deletions,
    })
  }
  return totals
}

type RawFile = Omit<ComparisonFile, keyof LineTotals>

/**
 * `--raw -z` records: `:oldMode newMode oldOid newOid STATUS`, then the path —
 * or two paths when the status is a rename or a copy. `-z` is what keeps a path
 * containing a tab, a newline or a non-ASCII byte intact; the default output
 * C-quotes those, and unquoting them by hand loses the original spelling.
 */
function parseRaw(text: string): RawFile[] | null {
  const files: RawFile[] = []
  const tokens = text.split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  for (let at = 0; at < tokens.length; at++) {
    const header = tokens[at]!
    if (!header.startsWith(':')) return null
    const fields = header.slice(1).split(' ')
    const spec = fields[4] ?? ''
    const status = COMPARISON_STATUS[spec[0] ?? '']
    if (!status) return null
    const pathCount = status === 'renamed' || status === 'copied' ? 2 : 1
    if (at + pathCount > tokens.length - 1) return null
    const paths = tokens.slice(at + 1, at + 1 + pathCount)
    at += pathCount
    files.push({
      path: paths.at(-1)!,
      oldPath: pathCount === 2 ? paths[0]! : null,
      status,
      // `R100`, `C75`: how much of the old file the new one still is.
      similarity: spec.length > 1 ? Number(spec.slice(1)) : null,
      oldOid: blobOid(fields[2]),
      newOid: blobOid(fields[3]),
    })
  }
  return files
}

/**
 * The files that differ between two commit-ish, with their line totals. Two
 * passes because no single git command carries both: `--raw` has the status,
 * the paths and the blob OIDs a lazy diff needs, `--numstat` has the counts.
 * Both are given the same rename flags, so they agree on which pairs exist.
 */
async function changedFiles(
  cwd: string,
  from: string,
  to: string,
): Promise<ComparisonResult<{ files: ComparisonFile[]; stats: ComparisonStats }>> {
  const [rawRun, numstatRun] = await Promise.all([
    gitAsync(cwd, ['diff', '--raw', '-z', '--abbrev=64', ...RENAMES, from, to]),
    gitAsync(cwd, ['diff', '--numstat', '-z', ...RENAMES, from, to]),
  ])
  if (rawRun.status !== 0) return asyncFailure(rawRun, 'Could not read changed files')
  if (numstatRun.status !== 0) return asyncFailure(numstatRun, 'Could not read line totals')

  const raw = parseRaw(rawRun.stdout)
  const totals = parseNumstat(numstatRun.stdout)
  if (!raw || !totals) {
    return comparisonFailure('gitError', 'Git returned incomplete comparison metadata')
  }

  const files: ComparisonFile[] = []
  const stats: ComparisonStats = { files: 0, additions: 0, deletions: 0, binaryFiles: 0 }
  for (const file of raw) {
    const total = totals.get(comparisonKey(file.oldPath, file.path))
    if (!total) return comparisonFailure('gitError', `Git reported no line totals for ${file.path}`)
    files.push({ ...file, ...total })
    stats.files++
    if (total.binary) stats.binaryFiles++
    else {
      stats.additions += total.additions ?? 0
      stats.deletions += total.deletions ?? 0
    }
  }
  return {
    ok: true,
    value: { files: files.toSorted((a, b) => a.path.localeCompare(b.path)), stats },
  }
}

/**
 * A resolved comparison's files and commits. Contents stay unread: the OIDs in
 * `identity` make this a snapshot, so a blob can be fetched when its row is
 * opened without the list underneath having moved.
 */
export async function loadResolvedComparison(
  cwd: string,
  identity: ComparisonIdentity,
): Promise<ComparisonResult<BranchComparison>> {
  // `mergeBase..compare` for the files and `base..compare` for the commits: both
  // leave out what only the base has, which is what makes this the branch's own
  // work rather than a tip-to-tip diff.
  const [changed, logRun] = await Promise.all([
    changedFiles(cwd, identity.mergeBase, identity.compare.oid),
    gitAsync(cwd, [
      'log',
      '-z',
      `--format=${COMMIT_FORMAT}`,
      `${identity.base.oid}..${identity.compare.oid}`,
    ]),
  ])
  if (!changed.ok) return changed
  if (logRun.status !== 0) return asyncFailure(logRun, 'Could not read comparison commits')
  const commits = parseCommits(logRun.stdout)
  if (!commits) return comparisonFailure('gitError', 'Git returned incomplete commit metadata')
  return { ok: true, value: { ...identity, ...changed.value, commits } }
}

export async function loadBranchComparison(
  cwd: string,
  baseName: string,
  compareName?: string,
): Promise<ComparisonResult<BranchComparison>> {
  const identity = await resolveComparison(cwd, baseName, compareName)
  return identity.ok ? loadResolvedComparison(cwd, identity.value) : identity
}

/** The two textual sides of one comparison row, fetched only when it is opened. */
export async function comparisonFileContent(
  cwd: string,
  file: ComparisonFile,
): Promise<ComparisonResult<ComparisonContent>> {
  if (file.binary) return { ok: true, value: { binary: true } }

  const read = (oid: string | null) =>
    oid ? gitAsync(cwd, ['cat-file', 'blob', oid]) : Promise.resolve<ProcessResult | null>(null)
  const [oldRun, newRun] = await Promise.all([read(file.oldOid), read(file.newOid)])
  if (oldRun && oldRun.status !== 0) return asyncFailure(oldRun, `Could not read ${file.oldPath}`)
  if (newRun && newRun.status !== 0) return asyncFailure(newRun, `Could not read ${file.path}`)
  return {
    ok: true,
    value: { binary: false, oldText: oldRun?.stdout ?? '', newText: newRun?.stdout ?? '' },
  }
}

/** Metadata and first-parent file changes for one commit. */
export async function comparisonCommitDetail(
  cwd: string,
  oid: string,
): Promise<ComparisonResult<ComparisonCommitDetail>> {
  const metadata = await gitAsync(cwd, ['log', '-1', '-z', `--format=${COMMIT_FORMAT}`, oid])
  if (metadata.status !== 0) return asyncFailure(metadata, 'Could not read commit metadata')
  const commits = parseCommits(metadata.stdout)
  const commit = commits?.length === 1 ? commits[0]! : null
  if (!commit) return comparisonFailure('invalidCompare', `Commit "${oid}" does not exist`)

  // First parent for a merge, as `git show` reads one — a combined diff is not
  // something the diff renderer can draw. The empty tree stands in for the
  // parent a root commit does not have.
  const changed = await changedFiles(cwd, commit.parents[0] ?? EMPTY_TREE, commit.oid)
  return changed.ok ? { ok: true, value: { commit, ...changed.value } } : changed
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
 * Working-tree status against `ref`, keyed like `statusMap`. `git status` can
 * only ever compare against HEAD, so this takes two queries: what the diff says
 * about tracked files, plus the untracked ones — which differ from every ref,
 * and which the diff never mentions.
 */
function statusAgainst(cwd: string, ref: string, base: string): Map<string, FileStatus> {
  const statuses = new Map<string, FileStatus>()
  // `-z` for the same reason as `statusMap`: quoted paths would never match its
  // keys. It also drops the tab between the code and the path, so the fields
  // arrive as a flat alternating list rather than one record per entry.
  const run = git(cwd, ['diff', '--name-status', '-z', ref])
  if (run.status !== 0) return statuses

  const fields = run.stdout.split('\0')
  for (let i = 0; i < fields.length; i += 2) {
    const code = fields[i]
    if (!code) continue
    // A rename or copy spends a field on each path; the new one is what exists
    // on disk, and skipping ahead keeps the codes on the even indices.
    if (code[0] === 'R' || code[0] === 'C') i++
    const path = fields[i + 1]
    const status = STATUS_BY_CODE[code[0]!]
    if (status && path) statuses.set(join(base, path), status)
  }

  const others = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (others.status === 0) {
    for (const rel of others.stdout.split('\0')) {
      if (rel.length > 0) statuses.set(join(base, rel), 'untracked')
    }
  }
  return statuses
}

/**
 * Working-tree status per absolute path. Staged and unstaged changes collapse to
 * one mark — the tree only needs "this differs from HEAD", or from `ref` when
 * the user has pointed the whole editor at another branch.
 */
export function statusMap(cwd: string, ref: string | null = null): Map<string, FileStatus> {
  const statuses = new Map<string, FileStatus>()
  const base = keyBase(cwd)
  if (base === null) return statuses
  if (ref !== null) return statusAgainst(cwd, ref, base)

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

  // git aborts the whole batch with 128 at the first path that reaches through a
  // symlinked directory ("is beyond a symbolic link") — expanding pnpm's
  // node_modules/@scope/pkg is enough — so those paths are never asked about.
  // One of them in the list used to blank the answer for every other row.
  //
  // The cache lives for this call alone: a directory can be swapped for a symlink
  // while druk is open, and the tree refresh this rides on is where that shows up.
  const symlinkDirs = new Map<string, boolean>()
  const askable: string[] = []
  const unanswerable: string[] = []
  for (const path of paths) {
    ;(beyondSymlink(cwd, path, symlinkDirs) ? unanswerable : askable).push(path)
  }

  // `-z` + `--stdin`: one NUL-terminated path each way. Exit 1 means none of the
  // paths are ignored, and 128 means there is no repository here — both are an
  // empty set rather than a failure, so only 0 has output worth reading.
  const run = git(cwd, ['check-ignore', '--stdin', '-z'], 5000, `${askable.join('\0')}\0`)
  if (run.status === 0) {
    for (const path of run.stdout.split('\0')) {
      if (path.length > 0) ignored.add(path)
    }
  }

  // An ignored directory takes everything under it, which is the only answer left
  // for the rows git refused. Applied to those alone: a force-added file under an
  // ignored directory is not ignored, and git is the one who knows which.
  for (const path of unanswerable) {
    if (hasIgnoredAncestor(cwd, path, ignored)) ignored.add(path)
  }
  return ignored
}

/** Whether any directory between `cwd` and `path` is a symlink. */
function beyondSymlink(cwd: string, path: string, cache: Map<string, boolean>): boolean {
  if (!path.startsWith(`${cwd}/`)) return false
  for (let dir = dirname(path); dir.length > cwd.length; dir = dirname(dir)) {
    let symlink = cache.get(dir)
    if (symlink === undefined) {
      try {
        symlink = lstatSync(dir).isSymbolicLink()
      } catch {
        symlink = false
      }
      cache.set(dir, symlink)
    }
    if (symlink) return true
  }
  return false
}

function hasIgnoredAncestor(cwd: string, path: string, ignored: Set<string>): boolean {
  if (!path.startsWith(`${cwd}/`)) return false
  for (let dir = dirname(path); dir.length > cwd.length; dir = dirname(dir)) {
    if (ignored.has(dir)) return true
  }
  return false
}

/**
 * The file's content at `ref`, or null when `ref` has no such file (untracked,
 * added, unborn branch, outside a repository). `cwd` anchors the lookup — the
 * `./` spelling makes the path cwd-relative, so a deleted file still resolves
 * even though it no longer exists on disk.
 */
export function refText(cwd: string, relPath: string, ref = 'HEAD'): string | null {
  const run = git(cwd, ['show', `${ref}:./${relPath}`], 3000)
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

  // Status checked, and NaN floored: a failed count would otherwise put "NaN↓"
  // on the status bar — `[''].map(Number)` is `[NaN]`, which `?? 0` keeps.
  const counts = git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  const [behind, ahead] = counts.status === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : []
  return { name: ref.stdout.trim(), ahead: ahead || 0, behind: behind || 0 }
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
 *
 * Keyed off `cwd`, not `keyBase`: `ls-files` names paths relative to the
 * directory it runs in, unlike porcelain's repo-relative ones, and it lists
 * nothing outside that directory either. A druk opened on a subdirectory of a
 * repository would otherwise key every entry under the repository root.
 */
export function ignoredPaths(cwd: string): Set<string> {
  const ignored = new Set<string>()
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
    ignored.add(join(cwd, rel.endsWith('/') ? rel.slice(0, -1) : rel))
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
  // Above the general conflict row, and matching both halves of the output: a
  // stash pop that conflicts keeps the entry, and saying so is the difference
  // between a scare and a fact. A conflict with no stash line is a merge.
  [
    /(?:^CONFLICT|Merge conflict in)[\s\S]*stash entry is kept/im,
    'Conflicts in the working tree — the stash was kept, resolve them first',
  ],
  [
    /^CONFLICT|Merge conflict in/im,
    'Conflicts in the working tree — resolve them, then commit the merge',
  ],
  [
    /unmerged files|needs merge|unresolved conflict/i,
    'Resolve the merge conflicts in your working tree first',
  ],
  [/nothing to commit|no changes added to commit/i, 'Nothing to commit'],
  [/branch named '.*' already exists/i, 'A branch of that name already exists'],
  // Short on purpose: the status bar is one line wide, and a longer sentence is
  // cut off exactly where it would have said what to do instead.
  [/is not fully merged/i, 'Branch has unmerged commits — a force delete discards them'],
  [
    /Cannot delete branch .* checked out/i,
    'That is the branch you are on — switch to another one first',
  ],
  [/is not a valid branch name/i, 'Not a valid branch name'],
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

async function mutate(cwd: string, args: string[]): Promise<GitResult> {
  const result = await runProcess('git', args, {
    cwd,
    // Without this an https remote with no cached credential makes git *prompt*
    // on the terminal druk owns — an invisible question the TUI hangs behind.
    // Failing fast turns it into a status-bar error instead.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: MUTATE_TIMEOUT,
  })
  if (result.error) {
    // The one failure with no git output to explain: there is no git.
    const detail = notInstalled(result)
      ? 'git is not installed, or not on PATH'
      : result.error.message
    return { ok: false, detail }
  }
  // Success chatter (push progress, fetch summaries) arrives on stderr too,
  // so on failure stderr is the answer and on success either will do.
  if (result.status === 0) return { ok: true, detail: firstLine(result.stdout || result.stderr) }
  // A killed process leaves whatever it had already written, which for a
  // hung fetch is nothing at all — say why it stopped instead of going blank.
  const detail = result.timedOut
    ? `Timed out after ${MUTATE_TIMEOUT / 1000}s and was stopped`
    : explain(result.stderr, result.stdout)
  return { ok: false, detail }
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

/** Create `name` off `from` (HEAD when null) and switch to it. */
export function createBranch(cwd: string, name: string, from: string | null): Promise<GitResult> {
  return mutate(cwd, from ? ['checkout', '-b', name, from] : ['checkout', '-b', name])
}

/**
 * Switch to `name`. A remote-tracking ref is not something to be on — checking
 * one out directly only detaches HEAD — so the first switch to `origin/x`
 * creates the local `x` that tracks it, and later ones move to that branch.
 */
export function switchBranch(cwd: string, name: string, remote: boolean): Promise<GitResult> {
  if (!remote) return mutate(cwd, ['checkout', name])
  const local = localBranchName(name)
  const exists = git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}`], 3000)
  return exists.status === 0
    ? mutate(cwd, ['checkout', local])
    : mutate(cwd, ['checkout', '-b', local, '--track', name])
}

export function renameBranch(cwd: string, from: string, to: string): Promise<GitResult> {
  return mutate(cwd, ['branch', '-m', from, to])
}

/** Delete a local branch. Without `force`, git refuses one that is not merged. */
export function deleteBranch(cwd: string, name: string, force: boolean): Promise<GitResult> {
  return mutate(cwd, ['branch', force ? '-D' : '-d', name])
}

export function mergeBranch(cwd: string, name: string): Promise<GitResult> {
  // --no-edit: a merge commit otherwise opens an editor druk cannot show.
  return mutate(cwd, ['merge', '--no-edit', name])
}
