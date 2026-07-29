import { relative } from 'node:path'

import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'

import { currentBranch, diffLines, inRepository, statusMap, upstreamOf } from '../core/git'
import type { FileStatus, GitResult, LineChange, Upstream } from '../core/git'
import type { CommitFile } from '../ui/CommitModal'
import type { EditorBridge } from './editor'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

/** Everything the UI shows about the repository, refreshed by `wireGitEffects`. */
export function createGit(rootDir: string) {
  const [gitLines, setGitLines] = createSignal<Map<number, LineChange>>(new Map())
  /** Bumped when something may have changed what git would report. */
  const [revision, setRevision] = createSignal(0)
  const [gitStatus, setGitStatus] = createSignal<Map<string, FileStatus>>(new Map())
  // Starts null and is filled by `wireGitEffects` after the first frame: reading
  // the branch here is a synchronous subprocess on the render thread's clock.
  const [branch, setBranch] = createSignal<string | null>(null)
  /** Whether `rootDir` is in a repository at all. A signal because `inRepository`
   * spawns git: the source-control panel reads this on every render, and a
   * subprocess there would run once per frame. */
  const [inRepo, setInRepo] = createSignal(inRepository(rootDir))
  const [upstream, setUpstream] = createSignal<Upstream | null>(null)
  /** A git mutation in flight — one at a time, they share a repository. */
  const [gitBusy, setGitBusy] = createSignal(false)
  /** Changed files offered to "Commit…", or null when the picker is closed. */
  const [commitPick, setCommitPick] = createSignal<CommitFile[] | null>(null)

  const bump = () => setRevision(n => n + 1)

  /** The changed files as the source-control panel lists them, in path order. */
  const changes = createMemo(() =>
    [...gitStatus()]
      .map(([path, status]) => ({ path, rel: relative(rootDir, path), status }))
      .toSorted((a, b) => a.rel.localeCompare(b.rel)),
  )

  return {
    gitLines,
    setGitLines,
    revision,
    bump,
    gitStatus,
    setGitStatus,
    branch,
    setBranch,
    inRepo,
    setInRepo,
    upstream,
    setUpstream,
    gitBusy,
    setGitBusy,
    commitPick,
    setCommitPick,
    changes,
  }
}

export type Git = ReturnType<typeof createGit>

/**
 * Run one git mutation: refuse outside a repository, keep them serial, report
 * what git said. `touchesTree` pulls the working tree back into open buffers —
 * a stash or pull rewrites files under the editor, and waiting for the watcher
 * would leave stale buffers on screen for its debounce interval.
 */
export function createGitOp(deps: {
  rootDir: string
  git: Git
  status: Status
  workspace: Workspace
}) {
  const { rootDir, git, status, workspace } = deps
  return (
    verb: string,
    run: () => Promise<GitResult>,
    options: { touchesTree?: boolean; done?: (result: GitResult) => string } = {},
  ) => {
    if (!inRepository(rootDir)) return status.say('Not a git repository', 'warn')
    if (git.gitBusy()) return status.say('A git command is already running — let it finish', 'warn')
    git.setGitBusy(true)
    status.say(`${verb}…`)
    void run().then(result => {
      git.setGitBusy(false)
      git.bump()
      if (!result.ok) return status.say(result.detail || `${verb} failed`, 'error')
      if (options.touchesTree) {
        const warning = workspace.clashWarning(workspace.syncFromDisk())
        if (warning) return status.say(warning, 'warn')
      }
      status.say(options.done ? options.done(result) : result.detail || `${verb} done`)
    })
  }
}

export type GitOp = ReturnType<typeof createGitOp>

/** Keep the git signals current, each on the cheapest cadence that stays correct. */
export function wireGitEffects(deps: {
  rootDir: string
  git: Git
  tree: Tree
  editor: EditorBridge
  workspace: Workspace
}) {
  const { rootDir, git, tree, editor, workspace } = deps

  // Every query below is a synchronous subprocess, and effects run inside the
  // initial render pass — `statusMap` alone can take hundreds of milliseconds in
  // a large repository, all of it spent before the first frame. Each effect
  // therefore sits behind one deferred tick: the frame goes out first, then the
  // effects re-run with their real dependencies.
  const [ready, setReady] = createSignal(false)
  onMount(() => {
    const timer = setTimeout(() => setReady(true), 0)
    onCleanup(() => clearTimeout(timer))
  })

  createEffect(
    on(
      // Not keyed on content: `git diff` is a subprocess, far too heavy to run
      // on every keystroke. Saving bumps reloadKey, which refreshes the marks.
      () => [ready(), workspace.activePath(), editor.reloadKey(), git.revision()] as const,
      ([ok, path]) => {
        if (!ok) return
        git.setGitLines(path ? diffLines(path) : new Map())
      },
    ),
  )

  // Ahead/behind only moves when history does, so it is deliberately not tied to
  // the tree refresh, which fires on every filesystem event.
  createEffect(
    on(
      () => [ready(), git.branch(), git.revision()] as const,
      ([ok]) => {
        if (!ok) return
        git.setUpstream(upstreamOf(rootDir))
      },
    ),
  )

  // Tree marks follow the same cadence, plus any filesystem change. The branch
  // rides along: a checkout in another terminal writes .git, so the watcher fires
  // here, and nothing else would ever notice HEAD had moved.
  createEffect(
    on(
      () => [ready(), tree.expanded(), git.revision(), editor.reloadKey()] as const,
      ([ok]) => {
        if (!ok) return
        git.setGitStatus(statusMap(rootDir))
        git.setBranch(currentBranch(rootDir))
        // `git init` in another terminal writes .git, so the watcher brings us
        // here — the only place the panel would ever learn it has a repository.
        git.setInRepo(inRepository(rootDir))
      },
    ),
  )
}
