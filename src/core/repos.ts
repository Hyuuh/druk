/**
 * Which repositories the opened folder holds.
 *
 * druk used to assume one: every git query ran in the root, and a folder that is
 * a *parent* of repositories — `~/Projects`, a checkout of agent worktrees, a
 * client folder — reported "not a git repository" and drew no marks at all.
 * The answers here turn that folder into a list of repositories, each of which is
 * queried in its own root.
 *
 * Deliberately filesystem-only: no `git` subprocess, because these run on the
 * tree's own cadence and per visible row. A repository is a directory with a
 * `.git` in it — a directory for an ordinary checkout, a file for a worktree or
 * a `--separate-git-dir` clone, both of which `existsSync` answers alike.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { listDir } from './fs'

/**
 * How far below the opened folder a scan looks. Three levels covers the layouts
 * people actually keep repositories in (`~/code/<repo>`, `~/code/<org>/<repo>`)
 * without walking a home directory to its leaves.
 */
export const DEFAULT_SCAN_DEPTH = 3

/**
 * Repositories past this many are not looked for. Every one of them costs a
 * `git status` on each refresh, and a folder holding hundreds is one where the
 * marks are not worth freezing the editor for.
 */
const MAX_REPOS = 64

/**
 * Directories one scan may read before it gives up. druk is opened on a home
 * directory often enough, and three levels of one of those is tens of thousands
 * of directories — a budget is what keeps the scan's cost the same whatever it
 * is pointed at.
 */
const MAX_SCAN_DIRS = 2000

/** Directories a scan never descends into — none of them holds a project of yours. */
const SKIPPED = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', 'out'])

export function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

/**
 * The repository `dir` sits in, or null. Walks up to the filesystem root, so a
 * druk opened on a subdirectory of a checkout finds the checkout — which is what
 * git itself does, and what every query here has to agree with.
 *
 * `cache` is optional and keyed by directory: the tree asks this per visible row,
 * and without it every row would re-stat the same chain of parents.
 */
export function enclosingRepo(dir: string, cache?: Map<string, string | null>): string | null {
  const cached = cache?.get(dir)
  if (cached !== undefined) return cached
  const parent = dirname(dir)
  // dirname('/') is '/': the root is where the walk has to stop.
  const found = isRepoRoot(dir) ? dir : parent === dir ? null : enclosingRepo(parent, cache)
  cache?.set(dir, found)
  return found
}

/**
 * The repositories `root` covers, nearest first.
 *
 * A root that is inside a checkout is the single-repository case druk has always
 * had, and answers with itself rather than the checkout: every query runs in the
 * directory the user opened, exactly as before — `git status` from a subdirectory
 * still reports the whole repository.
 *
 * Otherwise the children are scanned, and a directory that is a repository is not
 * descended into: submodules and vendored checkouts belong to the repository
 * around them, not to a list of their own.
 */
export function discoverRepos(root: string, depth = DEFAULT_SCAN_DEPTH): string[] {
  if (enclosingRepo(root)) return [root]
  const found: string[] = []
  let read = 0
  let level = [root]
  for (let below = 0; below < depth && level.length > 0 && found.length < MAX_REPOS; below++) {
    const next: string[] = []
    for (const dir of level) {
      if (++read > MAX_SCAN_DIRS) return found
      for (const node of listDir(dir)) {
        // A symlinked directory is skipped for the reason `ignoredAmong` skips
        // one: git refuses to answer about paths reached through it.
        if (!node.isDir || node.symlink || node.name.startsWith('.')) continue
        if (SKIPPED.has(node.name)) continue
        if (isRepoRoot(node.path)) found.push(node.path)
        else next.push(node.path)
        if (found.length >= MAX_REPOS) return found
      }
    }
    level = next
  }
  return found
}

/** Which of `repos` holds `path` — the innermost, so a nested one wins. */
export function repoOf(path: string, repos: readonly string[]): string | null {
  let best: string | null = null
  for (const repo of repos) {
    if (path !== repo && !path.startsWith(`${repo}/`)) continue
    if (best === null || repo.length > best.length) best = repo
  }
  return best
}

/**
 * `paths` split by the repository each belongs to, for the per-repository queries
 * that take a batch. A repository's own root is left out: it is never ignored by
 * itself, and asking would cost a subprocess for a repository nothing else needs
 * one for — the closed folder rows of a multi-repository sidebar are exactly that
 * case.
 */
export function groupByRepo(paths: readonly string[], repos: readonly string[]) {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const repo = repoOf(path, repos)
    if (repo === null || repo === path) continue
    const group = groups.get(repo)
    if (group) group.push(path)
    else groups.set(repo, [path])
  }
  return groups
}
