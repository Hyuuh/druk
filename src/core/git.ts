import { spawn, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

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

interface AsyncGit {
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  overflow: boolean
}

interface AsyncGitOptions {
  timeout?: number
  collectStdout?: boolean
  onStdout?: (chunk: Buffer) => void
}

function gitAsync(cwd: string, args: string[], options: AsyncGitOptions = {}): Promise<AsyncGit> {
  return new Promise(resolve => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputSize = 0
    let timedOut = false
    let overflow = false
    let finished = false
    let timer: ReturnType<typeof setTimeout>

    const finish = (status: number | null) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        overflow,
      })
    }
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputSize += chunk.length
      if (outputSize > MAX_OUTPUT) {
        overflow = true
        child.kill()
        return
      }
      target.push(chunk)
    }
    timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeout ?? 10_000)

    child.stdout.on('data', (chunk: Buffer) => {
      options.onStdout?.(chunk)
      if (options.collectStdout !== false) collect(stdout, chunk)
      else {
        outputSize += chunk.length
        if (outputSize > MAX_OUTPUT) {
          overflow = true
          child.kill()
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
    child.on('error', () => finish(null))
    child.on('close', finish)
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

export interface ComparisonFileDraft extends Omit<
  ComparisonFile,
  'binary' | 'additions' | 'deletions'
> {
  binary: boolean | undefined
  additions: number | null | undefined
  deletions: number | null | undefined
}

export interface ComparisonProgress {
  changes: ComparisonFileDraft[]
  stats: ComparisonStats
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

function asyncFailure(run: AsyncGit, fallback: string): ComparisonResult<never> {
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

function nulStream(onToken: (token: string) => void) {
  const decoder = new StringDecoder('utf8')
  let tail = ''
  const consume = (text: string) => {
    const tokens = `${tail}${text}`.split('\0')
    tail = tokens.pop() ?? ''
    for (const token of tokens) onToken(token)
  }
  return {
    write: (chunk: Buffer) => consume(decoder.write(chunk)),
    end: () => {
      consume(decoder.end())
      if (tail.length > 0) onToken(tail)
      tail = ''
    },
  }
}

function parseCount(value: string): number | null {
  return value === '-' ? null : Number(value)
}

function comparisonCommit(fields: string[], at = 0): ComparisonCommit {
  return {
    oid: fields[at]!,
    shortOid: fields[at + 1]!,
    subject: fields[at + 2]!,
    authorName: fields[at + 3]!,
    authorEmail: fields[at + 4]!,
    authoredAt: fields[at + 5]!,
    parents: fields[at + 6]!.split(' ').filter(Boolean),
  }
}

/**
 * Load all cheap comparison metadata while progressively publishing file rows.
 * The two resolved OIDs make this a stable snapshot; file contents stay lazy.
 */
export async function loadResolvedComparison(
  cwd: string,
  identity: ComparisonIdentity,
  onProgress?: (progress: ComparisonProgress) => void,
): Promise<ComparisonResult<BranchComparison>> {
  const files = new Map<string, ComparisonFileDraft>()
  const numstats = new Map<
    string,
    { binary: boolean; additions: number | null; deletions: number | null }
  >()
  const statsApplied = new Set<string>()
  const stats: ComparisonStats = { files: 0, additions: 0, deletions: 0, binaryFiles: 0 }
  let pending: ComparisonFileDraft[] = []

  const emit = (force = false) => {
    if (!onProgress || pending.length === 0 || (!force && pending.length < 256)) return
    const changes = pending
    pending = []
    onProgress({ changes, stats: { ...stats } })
  }
  const publish = (file: ComparisonFileDraft) => {
    pending.push(file)
    emit()
  }
  const applyNumstat = (
    key: string,
    file: ComparisonFileDraft,
    numstat: { binary: boolean; additions: number | null; deletions: number | null },
  ) => {
    const complete: ComparisonFileDraft = { ...file, ...numstat }
    files.set(key, complete)
    if (!statsApplied.has(key)) {
      statsApplied.add(key)
      if (numstat.binary) stats.binaryFiles++
      else {
        stats.additions += numstat.additions ?? 0
        stats.deletions += numstat.deletions ?? 0
      }
    }
    publish(complete)
  }

  const rawTokens: string[] = []
  const drainRaw = () => {
    while (rawTokens.length > 0) {
      const header = rawTokens[0]
      if (!header?.startsWith(':')) return
      const fields = header.slice(1).split(' ')
      const statusSpec = fields[4] ?? ''
      const code = statusSpec[0] ?? ''
      const status = COMPARISON_STATUS[code]
      if (!status) {
        rawTokens.shift()
        continue
      }
      const pathCount = code === 'R' || code === 'C' ? 2 : 1
      if (rawTokens.length < pathCount + 1) return
      rawTokens.shift()
      const paths = rawTokens.splice(0, pathCount)
      const oldPath = pathCount === 2 ? paths[0]! : null
      const path = paths.at(-1)!
      const key = comparisonKey(oldPath, path)
      const draft: ComparisonFileDraft = {
        path,
        oldPath,
        status,
        similarity: statusSpec.length > 1 ? Number(statusSpec.slice(1)) : null,
        binary: undefined,
        additions: undefined,
        deletions: undefined,
        oldOid: /^0+$/.test(fields[2] ?? '') ? null : (fields[2] ?? null),
        newOid: /^0+$/.test(fields[3] ?? '') ? null : (fields[3] ?? null),
      }
      files.set(key, draft)
      stats.files++
      publish(draft)
      const known = numstats.get(key)
      if (known) applyNumstat(key, draft, known)
    }
  }

  const numstatTokens: string[] = []
  const drainNumstats = () => {
    while (numstatTokens.length > 0) {
      const record = numstatTokens[0]!
      const firstTab = record.indexOf('\t')
      const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1)
      if (firstTab < 0 || secondTab < 0) {
        numstatTokens.shift()
        continue
      }
      const inlinePath = record.slice(secondTab + 1)
      const renamed = inlinePath.length === 0
      if (renamed && numstatTokens.length < 3) return
      numstatTokens.shift()
      const oldPath = renamed ? numstatTokens.shift()! : null
      const path = renamed ? numstatTokens.shift()! : inlinePath
      const additions = parseCount(record.slice(0, firstTab))
      const deletions = parseCount(record.slice(firstTab + 1, secondTab))
      const value = {
        binary: additions === null || deletions === null,
        additions,
        deletions,
      }
      const key = comparisonKey(oldPath, path)
      numstats.set(key, value)
      const draft = files.get(key)
      if (draft) applyNumstat(key, draft, value)
    }
  }

  const rawStream = nulStream(token => {
    rawTokens.push(token)
    drainRaw()
  })
  const numstatStream = nulStream(token => {
    numstatTokens.push(token)
    drainNumstats()
  })
  const range = `${identity.mergeBase}..${identity.compare.oid}`
  const [rawRun, numstatRun, logRun] = await Promise.all([
    gitAsync(
      cwd,
      ['diff', '--raw', '-z', '--abbrev=64', '--find-renames', '--find-copies', range],
      { collectStdout: false, onStdout: rawStream.write },
    ),
    gitAsync(cwd, ['diff', '--numstat', '-z', '--find-renames', '--find-copies', range], {
      collectStdout: false,
      onStdout: numstatStream.write,
    }),
    gitAsync(cwd, [
      'log',
      '-z',
      '--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P',
      `${identity.base.oid}..${identity.compare.oid}`,
    ]),
  ])
  rawStream.end()
  numstatStream.end()
  drainRaw()
  drainNumstats()
  emit(true)

  if (rawRun.status !== 0) return asyncFailure(rawRun, 'Could not read changed files')
  if (numstatRun.status !== 0) return asyncFailure(numstatRun, 'Could not read line totals')
  if (logRun.status !== 0) return asyncFailure(logRun, 'Could not read comparison commits')
  if (rawTokens.length > 0 || numstatTokens.length > 0) {
    return comparisonFailure('gitError', 'Git returned incomplete comparison metadata')
  }
  if (
    files.size !== numstats.size ||
    [...files.values()].some(
      file =>
        file.binary === undefined || file.additions === undefined || file.deletions === undefined,
    )
  ) {
    return comparisonFailure('gitError', 'Git returned inconsistent comparison metadata')
  }

  const commitFields = logRun.stdout.split('\0')
  if (commitFields.at(-1) === '') commitFields.pop()
  if (commitFields.length % 7 !== 0) {
    return comparisonFailure('gitError', 'Git returned incomplete commit metadata')
  }
  const commits: ComparisonCommit[] = []
  for (let at = 0; at < commitFields.length; at += 7) {
    commits.push(comparisonCommit(commitFields, at))
  }

  return {
    ok: true,
    value: {
      ...identity,
      files: [...files.values()]
        .map(file => ({
          ...file,
          binary: file.binary!,
          additions: file.additions!,
          deletions: file.deletions!,
        }))
        .toSorted((a, b) => a.path.localeCompare(b.path)),
      commits,
      stats,
    },
  }
}

export async function loadBranchComparison(
  cwd: string,
  baseName: string,
  compareName?: string,
  onProgress?: (progress: ComparisonProgress) => void,
): Promise<ComparisonResult<BranchComparison>> {
  const identity = await resolveComparison(cwd, baseName, compareName)
  return identity.ok ? loadResolvedComparison(cwd, identity.value, onProgress) : identity
}

/** The two textual sides of one comparison row, fetched only when it is opened. */
export async function comparisonFileContent(
  cwd: string,
  file: ComparisonFile,
): Promise<ComparisonResult<ComparisonContent>> {
  if (file.binary) return { ok: true, value: { binary: true } }

  const read = (oid: string | null) =>
    oid ? gitAsync(cwd, ['cat-file', 'blob', oid]) : Promise.resolve<AsyncGit | null>(null)
  const [oldRun, newRun] = await Promise.all([read(file.oldOid), read(file.newOid)])
  if (oldRun && oldRun.status !== 0) return asyncFailure(oldRun, `Could not read ${file.oldPath}`)
  if (newRun && newRun.status !== 0) return asyncFailure(newRun, `Could not read ${file.path}`)
  return {
    ok: true,
    value: {
      binary: false,
      oldText: oldRun?.stdout ?? '',
      newText: newRun?.stdout ?? '',
    },
  }
}

async function rootCommitFiles(
  cwd: string,
  oid: string,
): Promise<ComparisonResult<{ files: ComparisonFile[]; stats: ComparisonStats }>> {
  const [treeRun, numstatRun] = await Promise.all([
    gitAsync(cwd, ['ls-tree', '-r', '-z', '--full-tree', oid]),
    gitAsync(cwd, ['diff-tree', '--root', '--no-commit-id', '--numstat', '-z', '-r', oid]),
  ])
  if (treeRun.status !== 0) return asyncFailure(treeRun, 'Could not read the root commit tree')
  if (numstatRun.status !== 0) {
    return asyncFailure(numstatRun, 'Could not read the root commit line totals')
  }

  const oids = new Map<string, string>()
  for (const record of treeRun.stdout.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    const header = tab < 0 ? [] : record.slice(0, tab).split(' ')
    if (header.length >= 3) oids.set(record.slice(tab + 1), header[2]!)
  }

  const files: ComparisonFile[] = []
  const stats: ComparisonStats = { files: 0, additions: 0, deletions: 0, binaryFiles: 0 }
  for (const record of numstatRun.stdout.split('\0')) {
    if (!record) continue
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) {
      return comparisonFailure('gitError', 'Git returned incomplete root commit metadata')
    }
    const path = record.slice(secondTab + 1)
    const additions = parseCount(record.slice(0, firstTab))
    const deletions = parseCount(record.slice(firstTab + 1, secondTab))
    const binary = additions === null || deletions === null
    files.push({
      path,
      oldPath: null,
      status: 'added',
      similarity: null,
      binary,
      additions,
      deletions,
      oldOid: null,
      newOid: oids.get(path) ?? null,
    })
    stats.files++
    if (binary) stats.binaryFiles++
    else {
      stats.additions += additions ?? 0
      stats.deletions += deletions ?? 0
    }
  }
  return {
    ok: true,
    value: { files: files.toSorted((a, b) => a.path.localeCompare(b.path)), stats },
  }
}

/**
 * Metadata and first-parent file changes for one commit. Reusing the branch
 * loader for ordinary commits keeps rename/binary/path parsing in one place;
 * only a root commit needs its empty-tree special case.
 */
export async function comparisonCommitDetail(
  cwd: string,
  oid: string,
): Promise<ComparisonResult<ComparisonCommitDetail>> {
  const metadata = await gitAsync(cwd, [
    'log',
    '-1',
    '-z',
    '--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P',
    oid,
  ])
  if (metadata.status !== 0) return asyncFailure(metadata, 'Could not read commit metadata')
  const fields = metadata.stdout.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length !== 7) {
    return comparisonFailure('invalidCompare', `Commit "${oid}" does not exist`)
  }
  const commit = comparisonCommit(fields)
  const parent = commit.parents[0]
  if (!parent) {
    const root = await rootCommitFiles(cwd, commit.oid)
    return root.ok ? { ok: true, value: { commit, ...root.value } } : root
  }

  const comparison = await loadBranchComparison(cwd, parent, commit.oid)
  return comparison.ok
    ? {
        ok: true,
        value: { commit, files: comparison.value.files, stats: comparison.value.stats },
      }
    : comparison
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
