import { join, relative } from 'node:path'

import type { Change, ChangeRow } from '../core/changeTree'
import { readFile } from '../core/fs'
import { blobTexts } from '../core/git'
import type { ChangeArea, FileStatus } from '../core/git'
import { createDiffDocument } from './diffDocument'
import type { DiffContent, DiffEntry } from './diffDocument'
import type { Git } from './git'

export const slotKey = (path: string, area: ChangeArea) => `${area}:${path}`

export const rowSlotKey = (row: ChangeRow | undefined): string | null =>
  row?.kind === 'file' ? slotKey(row.change.path, row.change.area) : null

const AREA_BADGE: Record<ChangeArea, string | null> = {
  merge: 'merge',
  staged: 'staged',
  unstaged: null,
}

// FIFO cap on whole file texts; a byte budget if a repo needs one.
const BLOB_CACHE_LIMIT = 256

export function createWorkingChanges(deps: {
  rootDir: string
  git: Git
  buffer: (path: string) => string | undefined
  reloadKey: () => number
  canStage: () => boolean
}) {
  const { rootDir, git } = deps

  // Keyed `<repo>\0<spec>`; the whole map goes when git moves — a blob is whatever `revision` says.
  const blobs = new Map<string, string | null>()
  let blobRevision = -1
  const blobKey = (repo: string, spec: string) => `${repo}\0${spec}`
  const freshBlobs = () => {
    if (git.revision() !== blobRevision) {
      blobs.clear()
      blobRevision = git.revision()
    }
  }
  const remember = (repo: string, texts: Map<string, string | null>) => {
    for (const [spec, text] of texts) {
      blobs.set(blobKey(repo, spec), text)
    }
    while (blobs.size > BLOB_CACHE_LIMIT) {
      blobs.delete(blobs.keys().next().value!)
    }
  }
  const blobText = (repo: string, spec: string): string | null => {
    freshBlobs()
    const key = blobKey(repo, spec)
    if (!blobs.has(key)) {
      remember(repo, blobTexts(repo, [spec]))
    }
    return blobs.get(key) ?? null
  }

  // As `git diff` measures it: staged is HEAD against the index, unstaged the index (or HEAD,
  // with nothing staged) against the working tree.
  const sides = (change: Change) => {
    const repo = git.repoFor(change.path)
    if (repo === null) {
      return null
    }
    const rel = relative(repo, change.path)
    const entry = git.statusEntries().get(change.path)
    const staged = Boolean(entry?.staged)
    // A rename's committed side is under its old name; `HEAD:./<new>` is simply missing.
    const committed = `${git.diffBase() ?? 'HEAD'}:./${entry?.source ?? rel}`
    const index = `:./${rel}`
    const old =
      change.status === 'untracked'
        ? null
        : change.area === 'staged' || !staged
          ? committed
          : index
    const now = change.area === 'staged' ? index : null
    return { new: now, old, repo }
  }

  const prefetch = (changes: Change[]) => {
    freshBlobs()
    const wanted = new Map<string, Set<string>>()
    for (const change of changes) {
      const spec = sides(change)
      if (!spec) {
        continue
      }
      const set = wanted.get(spec.repo) ?? new Set<string>()
      for (const one of [spec.old, spec.new]) {
        if (one && !blobs.has(blobKey(spec.repo, one))) {
          set.add(one)
        }
      }
      wanted.set(spec.repo, set)
    }
    for (const [repo, specs] of wanted) {
      if (specs.size > 0) {
        remember(repo, blobTexts(repo, [...specs]))
      }
    }
  }

  const byKey = new Map<string, Change>()

  const load = (entry: DiffEntry): DiffContent => {
    const change = byKey.get(entry.key)
    if (!change) {
      return { detail: 'No longer changed', kind: 'error' }
    }
    const spec = sides(change)
    const oldText = spec?.old ? (blobText(spec.repo, spec.old) ?? '') : ''
    let newText = ''
    if (change.status !== 'deleted') {
      if (spec?.new) {
        newText = blobText(spec.repo, spec.new) ?? ''
      } else {
        const buffer = deps.buffer(change.path)
        if (buffer === undefined) {
          try {
            newText = readFile(change.path)
          } catch {
            return { kind: 'binary' }
          }
        } else {
          newText = buffer
        }
      }
    }
    return { kind: 'text', newText, oldText }
  }

  const doc = createDiffDocument(load)

  const entryFor = (change: Change): DiffEntry => {
    const repo = git.repoFor(change.path)
    const source = git.statusEntries().get(change.path)?.source
    const stage: DiffEntry['stage'] = deps.canStage()
      ? change.area === 'staged'
        ? 'unstage'
        : 'stage'
      : null
    return {
      badge: AREA_BADGE[change.area],
      key: slotKey(change.path, change.area),
      // The header says `old → new` from this: `source` is repository-relative, `rel` is not.
      oldRel:
        source && repo !== null ? relative(rootDir, join(repo, source)) : null,
      path: change.path,
      rel: relative(rootDir, change.path),
      stage,
      status: change.status as FileStatus,
    }
  }

  // Panel order, but every file: a folded folder's files are not in `rows`.
  const rebuild = () => {
    const changes = git.changes()
    const ordered = (['merge', 'staged', 'unstaged'] as const).flatMap((area) =>
      changes.filter((change) => change.area === area)
    )
    byKey.clear()
    for (const change of ordered) {
      byKey.set(slotKey(change.path, change.area), change)
    }
    prefetch(ordered)
    doc.setEntries(ordered.map(entryFor))
    doc.setPin(rowSlotKey(git.cursorRow()))
    doc.reload()
  }

  const change = (key: string) => byKey.get(key) ?? null

  return { change, doc, rebuild }
}

export type WorkingChanges = ReturnType<typeof createWorkingChanges>
