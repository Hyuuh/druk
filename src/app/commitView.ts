import { createSignal } from 'solid-js'

import { comparisonCommitDetail } from '../core/git'
import type { ComparisonCommitDetail } from '../core/git'
import { plural } from '../core/text'
import type { DiffHeading } from '../ui/DiffHeading'
import { createDiffDocument } from './diffDocument'
import type { DiffContent, DiffEntry } from './diffDocument'
import { comparisonSource } from './diffSources'
import type { Status } from './status'

export function commitHeading(detail: ComparisonCommitDetail): DiffHeading {
  const { commit } = detail
  return {
    aside:
      commit.parents.length > 1
        ? `merge of ${plural(commit.parents.length, 'parent')}`
        : undefined,
    byline: `${commit.authorName} <${commit.authorEmail}> · ${commit.authoredAt}`,
    ref: commit.shortOid,
    title: commit.subject,
  }
}

export function createCommitView(deps: { rootDir: string; status: Status }) {
  const [commit, setCommit] = createSignal<ComparisonCommitDetail | null>(null)
  let source: ReturnType<typeof comparisonSource> | null = null
  let generation = 0

  const doc = createDiffDocument(
    (entry: DiffEntry): DiffContent | Promise<DiffContent> =>
      source?.load(entry) ?? { detail: 'No commit is open', kind: 'error' }
  )

  const open = (repo: string, oid: string) => {
    generation += 1
    const run = generation
    void (async () => {
      const loaded = await comparisonCommitDetail(repo, oid)
      if (run !== generation) {
        return
      }
      if (!loaded.ok) {
        return deps.status.say(loaded.detail, 'error')
      }
      source = comparisonSource(repo, deps.rootDir, loaded.value.files)
      doc.reset(source.entries)
      setCommit(loaded.value)
    })()
  }

  const close = () => {
    generation += 1
    source = null
    doc.reset()
    setCommit(null)
  }

  const isOpen = () => commit() !== null

  return { close, commit, doc, isOpen, open }
}

export type CommitView = ReturnType<typeof createCommitView>
