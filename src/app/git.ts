import { relative } from 'node:path'

import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'

import { ancestorDirs, changeRows } from '../core/changeTree'
import type { Config } from '../core/config'
import {
  currentBranch,
  diffLines,
  ignoredAmong,
  inRepository,
  statusMap,
  upstreamOf,
} from '../core/git'
import type { FileStatus, GitResult, LineChange, Upstream } from '../core/git'
import type { CommitFile } from '../ui/CommitModal'
import type { EditorBridge } from './editor'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

/**
 * Everything the UI shows about the repository, refreshed by `wireGitEffects`.
 * `panelView` is read on every render of the panel's rows, so it is the live
 * config accessor rather than a value — flipping the setting must rebuild them.
 */
export function createGit(rootDir: string, panelView: () => 'tree' | 'list') {
  const [gitLines, setGitLines] = createSignal<Map<number, LineChange>>(new Map())
  /** Bumped when something may have changed what git would report. */
  const [revision, setRevision] = createSignal(0)
  const [gitStatus, setGitStatus] = createSignal<Map<string, FileStatus>>(new Map())
  /** Visible tree paths that `.gitignore` excludes — dimmed in the sidebar. */
  const [gitIgnored, setGitIgnored] = createSignal<Set<string>>(new Set())
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
  /**
   * What every comparison is against: null is HEAD, and a ref name points the
   * whole editor at that branch instead — tree marks, gutter, the panel's list
   * and the diff page all follow it. Committing deliberately does not: the index
   * is always built against HEAD, whatever is being reviewed.
   */
  const [diffBase, setDiffBase] = createSignal<string | null>(null)

  const bump = () => setRevision(n => n + 1)

  /** The changed files as the source-control panel lists them, in path order. */
  const changes = createMemo(() =>
    [...gitStatus()]
      .map(([path, status]) => ({ path, rel: relative(rootDir, path), status }))
      .toSorted((a, b) => a.rel.localeCompare(b.rel)),
  )

  /** Folders the panel's tree has folded away, by path relative to the root. */
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())

  /**
   * What the panel draws and what the cursor counts, folder rows included. Every
   * caller works in row indices: `changes` is no longer addressable by cursor,
   * because in tree mode most rows are not files.
   */
  const rows = createMemo(() => changeRows(changes(), panelView(), collapsed()))

  const toggleCollapsed = (rel: string) =>
    setCollapsed(previous => {
      const next = new Set(previous)
      if (!next.delete(rel)) next.add(rel)
      return next
    })

  /**
   * Fold every folder the panel can draw.
   *
   * Taken from a fully expanded pass rather than from the changes' own ancestors:
   * a chain of single-child folders is drawn as one row keyed on the outermost of
   * them, so a deeper rel in the set would hide a subtree leaving no row to press.
   */
  const collapseAll = () =>
    setCollapsed(
      new Set(changeRows(changes(), 'tree').flatMap(row => (row.kind === 'dir' ? [row.rel] : []))),
    )

  /** Unfold every folder on the way to `rel`, so its row is on screen to land on. */
  const revealChange = (rel: string) =>
    setCollapsed(previous => {
      const hiding = ancestorDirs(rel).filter(dir => previous.has(dir))
      if (hiding.length === 0) return previous
      const next = new Set(previous)
      for (const dir of hiding) next.delete(dir)
      return next
    })

  return {
    gitLines,
    setGitLines,
    revision,
    bump,
    gitStatus,
    setGitStatus,
    gitIgnored,
    setGitIgnored,
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
    diffBase,
    setDiffBase,
    changes,
    rows,
    collapsed,
    toggleCollapsed,
    collapseAll,
    revealChange,
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
    options: {
      touchesTree?: boolean
      done?: (result: GitResult) => string
      /**
       * Offer a way out of a failure instead of reporting it. Returning true
       * means this call has taken the failure over — whatever it put on the
       * status bar stays there, in place of the error line.
       */
      handleFailure?: (result: GitResult) => boolean
    } = {},
  ) => {
    if (!inRepository(rootDir)) return status.say('Not a git repository', 'warn')
    if (git.gitBusy()) return status.say('A git command is already running — let it finish', 'warn')
    git.setGitBusy(true)
    status.say(`${verb}…`)
    void run().then(result => {
      git.setGitBusy(false)
      git.bump()
      if (!result.ok) {
        if (options.handleFailure?.(result)) return
        return status.say(result.detail || `${verb} failed`, 'error')
      }
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
  config: Config
}) {
  const { rootDir, git, tree, editor, workspace, config } = deps

  /**
   * Run `query` after the frame that asked for it, and once per burst.
   *
   * Every query below is a handful of synchronous subprocesses — ~75ms together
   * on a middling repository, hundreds of milliseconds on a large one — so run
   * inline they are paid out of whatever repaint triggered them: the initial
   * render, or, most visibly, the two refreshes a save with a formatter asks for
   * before and after the tool runs. Deferring puts the frame on screen first and
   * collapses a burst (a save's own bump, then the watcher's on the formatter's
   * write) into one pass. The body must therefore read its inputs itself: by the
   * time it runs, the values `on` handed the effect may be a burst out of date.
   */
  const deferred = (query: () => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    onCleanup(() => {
      if (timer) clearTimeout(timer)
    })
    return () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        query()
      }, 0)
    }
  }

  const refreshLines = deferred(() => {
    const path = workspace.activePath()
    git.setGitLines(path ? diffLines(path, git.diffBase()) : new Map())
  })

  createEffect(
    on(
      // Not keyed on content: `git diff` is a subprocess, far too heavy to run
      // on every keystroke. Saving bumps reloadKey, which refreshes the marks.
      () => [workspace.activePath(), editor.reloadKey(), git.revision(), git.diffBase()] as const,
      refreshLines,
    ),
  )

  const refreshUpstream = deferred(() => git.setUpstream(upstreamOf(rootDir)))

  // Ahead/behind only moves when history does, so it is deliberately not tied to
  // the tree refresh, which fires on every filesystem event.
  createEffect(on(() => [git.branch(), git.revision()] as const, refreshUpstream))

  const refreshStatus = deferred(() => {
    git.setGitStatus(statusMap(rootDir, git.diffBase()))
    // With the rows hidden outright there is nothing left to dim, and the
    // subprocess would answer "none of these" on every filesystem event.
    git.setGitIgnored(
      config.respectGitignore
        ? new Set<string>()
        : ignoredAmong(
            rootDir,
            tree.nodes().map(n => n.path),
          ),
    )
    git.setBranch(currentBranch(rootDir))
    // `git init` in another terminal writes .git, so the watcher brings us
    // here — the only place the panel would ever learn it has a repository.
    git.setInRepo(inRepository(rootDir))
  })

  // Tree marks follow the same cadence, plus any filesystem change. The branch
  // rides along: a checkout in another terminal writes .git, so the watcher fires
  // here, and nothing else would ever notice HEAD had moved. Ignored paths ride
  // the same tick: expansion reveals new rows that need a check-ignore pass.
  createEffect(
    on(
      () =>
        [
          tree.expanded(),
          git.revision(),
          editor.reloadKey(),
          // Not merely read in the body: flipping the setting is the one thing
          // that changes the answer without touching the tree or the repository.
          config.respectGitignore,
          git.diffBase(),
        ] as const,
      refreshStatus,
    ),
  )
}
