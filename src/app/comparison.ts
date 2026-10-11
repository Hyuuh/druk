import { createMemo, createSignal } from 'solid-js'

import {
  comparisonCommitDetail,
  currentBranch,
  defaultBranch,
  listBranches,
  loadResolvedComparison,
  resolveComparison,
} from '../core/git'
import type {
  Branch,
  BranchComparison,
  ComparisonCommitDetail,
} from '../core/git'
import { fuzzyScore } from '../core/search'
import { createDiffDocument } from './diffDocument'
import type { DiffContent, DiffEntry } from './diffDocument'
import { comparisonSource } from './diffSources'
import { noRepository } from './git'
import type { Git } from './git'
import type { Status } from './status'

export type ComparisonListMode = 'files' | 'commits'
export type ComparisonLoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'

function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  cache.set(key, value)
  if (cache.size > limit) {
    cache.delete(cache.keys().next().value!)
  }
}

// What the detail page over the editor is showing: the whole comparison, or one of its commits.
export type ComparisonDetail =
  | { kind: 'files'; focus: string }
  | { kind: 'commit'; commit: ComparisonCommitDetail }

export function createComparison(deps: {
  rootDir: string
  git: Git
  status: Status
}) {
  const { rootDir, git, status } = deps
  const [active, setActive] = createSignal(false)
  const [state, setState] = createSignal<ComparisonLoadState>('idle')
  const [result, setResult] = createSignal<BranchComparison | null>(null)
  const [error, setError] = createSignal('')
  const [mode, setMode] = createSignal<ComparisonListMode>('files')
  const [filter, setFilterValue] = createSignal('')
  const [filterOpen, setFilterOpen] = createSignal(false)
  const [fileCursor, setFileCursor] = createSignal(0)
  const [commitCursor, setCommitCursor] = createSignal(0)
  const [basePick, setBasePick] = createSignal<Branch[] | null>(null)
  const [chosenBase, setChosenBase] = createSignal<string | null>(null)
  const [shown, setDetail] = createSignal<ComparisonDetail | null>(null)

  // Pinned when the comparison opens: the active repository can move under it.
  let repoDir = rootDir

  const comparisons = new Map<string, BranchComparison>()
  const commits = new Map<string, ComparisonCommitDetail>()
  let requestGeneration = 0
  let detailGeneration = 0
  let shownFiles: ReturnType<typeof comparisonSource> | null = null

  const doc = createDiffDocument(
    (entry: DiffEntry): DiffContent | Promise<DiffContent> =>
      shownFiles?.load(entry) ?? { detail: 'Nothing is open', kind: 'error' }
  )

  const filteredFiles = createMemo(() => {
    const query = filter().trim()
    const source = result()?.files ?? []
    if (!query) {
      return source
    }
    return source.filter(
      (file) =>
        fuzzyScore(file.path, query) !== null ||
        (file.oldPath !== null && fuzzyScore(file.oldPath, query) !== null)
    )
  })

  const filteredCommits = createMemo(() => {
    const query = filter().trim()
    const source = result()?.commits ?? []
    if (!query) {
      return source
    }
    return source.filter(
      (commit) =>
        fuzzyScore(commit.subject, query) !== null ||
        fuzzyScore(commit.shortOid, query) !== null ||
        fuzzyScore(commit.authorName, query) !== null
    )
  })

  const fail = (detail: string) => {
    setError(detail)
    setState('error')
    status.say(detail, 'error')
  }

  const show = (comparison: BranchComparison) => {
    setResult(comparison)
    setState(
      comparison.files.length === 0 && comparison.commits.length === 0
        ? 'empty'
        : 'ready'
    )
    setError('')
    setFileCursor(0)
    setCommitCursor(0)
  }

  const load = async (base: string) => {
    requestGeneration += 1
    const generation = requestGeneration
    setState('loading')
    setError('')
    setResult(null)
    const compare = git.branch() ?? currentBranch(repoDir) ?? undefined
    const identity = await resolveComparison(repoDir, base, compare)
    if (generation !== requestGeneration) {
      return
    }
    if (!identity.ok) {
      return fail(identity.detail)
    }

    const key = `${identity.value.base.oid}:${identity.value.compare.oid}`
    const cached = comparisons.get(key)
    if (cached) {
      show({
        ...cached,
        base: identity.value.base,
        compare: identity.value.compare,
      })
      return
    }

    const loaded = await loadResolvedComparison(repoDir, identity.value)
    if (generation !== requestGeneration) {
      return
    }
    if (!loaded.ok) {
      return fail(loaded.detail)
    }
    remember(comparisons, key, loaded.value, 8)
    show(loaded.value)
  }

  const branchesForBase = () => {
    const current = git.branch() ?? currentBranch(repoDir)
    return listBranches(repoDir).filter(
      (branch) => !branch.current && branch.name !== current
    )
  }

  const open = () => {
    setActive(true)
    setMode('files')
    setFilterValue('')
    setFilterOpen(false)
    closeDetail()
    const repo = git.activeRepo()
    if (repo === null) {
      return fail(noRepository(git))
    }
    repoDir = repo
    const base = chosenBase() ?? git.diffBase() ?? defaultBranch(repoDir)
    if (base) {
      void load(base)
      return
    }
    const branches = branchesForBase()
    if (branches.length === 0) {
      return fail('No comparison base exists')
    }
    setState('idle')
    setBasePick(branches)
    status.say('Choose a base branch')
  }

  const close = () => {
    requestGeneration += 1
    setActive(false)
    setState('idle')
    setBasePick(null)
    setFilterOpen(false)
    closeDetail()
  }

  const openBasePicker = () => {
    const branches = branchesForBase()
    if (branches.length === 0) {
      return status.say('No other branch to compare against')
    }
    setBasePick(branches)
  }

  const chooseBase = (branch: Branch) => {
    setBasePick(null)
    setChosenBase(branch.name)
    void load(branch.name)
  }

  const setFilter = (value: string) => {
    setFilterValue(value)
    setFileCursor(0)
    setCommitCursor(0)
  }

  const toggleMode = () => {
    setMode((value) => (value === 'files' ? 'commits' : 'files'))
    closeDetail()
  }

  const move = (delta: number) => {
    if (mode() === 'files') {
      const last = Math.max(0, filteredFiles().length - 1)
      setFileCursor((value) => Math.max(0, Math.min(last, value + delta)))
    } else {
      const last = Math.max(0, filteredCommits().length - 1)
      setCommitCursor((value) => Math.max(0, Math.min(last, value + delta)))
    }
  }

  const showFiles = (files: BranchComparison['files'], focus: string) => {
    shownFiles = comparisonSource(repoDir, rootDir, files)
    doc.reset(shownFiles.entries)
    doc.setPin(focus)
  }

  const openSelection = () => {
    detailGeneration += 1
    const generation = detailGeneration
    if (mode() === 'files') {
      const file = filteredFiles()[fileCursor()]
      if (!file) {
        return
      }
      showFiles(filteredFiles(), file.path)
      setDetail({ focus: file.path, kind: 'files' })
      return
    }

    const commit = filteredCommits()[commitCursor()]
    if (!commit) {
      return
    }
    const cached = commits.get(commit.oid)
    const loadCommit = cached
      ? Promise.resolve({ ok: true as const, value: cached })
      : comparisonCommitDetail(repoDir, commit.oid)
    void (async () => {
      const loaded = await loadCommit
      if (generation !== detailGeneration) {
        return
      }
      if (!loaded.ok) {
        return fail(loaded.detail)
      }
      remember(commits, commit.oid, loaded.value, 32)
      showFiles(loaded.value.files, loaded.value.files[0]?.path ?? '')
      setDetail({ commit: loaded.value, kind: 'commit' })
    })()
  }

  function closeDetail() {
    detailGeneration += 1
    shownFiles = null
    doc.reset()
    setDetail(null)
  }

  const refresh = () => {
    if (!active()) {
      return
    }
    const comparison = result()
    if (!comparison) {
      return
    }
    const generation = requestGeneration
    void (async () => {
      const identity = await resolveComparison(repoDir, comparison.base.name)
      if (!active() || generation !== requestGeneration) {
        return
      }
      if (!identity.ok) {
        return fail(identity.detail)
      }
      if (
        identity.value.base.oid !== comparison.base.oid ||
        identity.value.compare.oid !== comparison.compare.oid
      ) {
        void load(comparison.base.name)
      }
    })()
  }

  // A commit with an empty diff has no file and still owns the editor slot and Esc.
  const detailOpen = () => shown() !== null

  return {
    active,
    basePick,
    chooseBase,
    close,
    closeBasePicker: () => setBasePick(null),
    closeDetail,
    closeFilter: (clear: boolean) => {
      setFilterOpen(false)
      if (clear) {
        setFilter('')
      }
    },
    commitCursor,
    detail: shown,
    detailOpen,
    doc,
    error,
    fileCursor,
    filter,
    filterOpen,
    filteredCommits,
    filteredFiles,
    mode,
    move,
    open,
    openBasePicker,
    openFilter: () => setFilterOpen(true),
    openSelection,
    refresh,
    result,
    setFilter,
    state,
    toggleMode,
  }
}

export type Comparison = ReturnType<typeof createComparison>
