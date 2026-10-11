import { createMemo, createSignal } from 'solid-js'

import { openInBrowser } from '../core/browser'
import { fetchRefs, hasCommit, rangeChanges, remoteFor } from '../core/git'
import {
  currentPullRequest,
  pullRequestFiles,
  setFileViewed,
} from '../core/github'
import type { PullRequest, ViewedState } from '../core/github'
import { plural } from '../core/text'
import type { DiffHeading, HeadingTone } from '../ui/DiffHeading'
import { createDiffDocument } from './diffDocument'
import type { DiffContent, DiffEntry } from './diffDocument'
import { comparisonSource } from './diffSources'
import { noRepository } from './git'
import type { Git } from './git'
import type { Status } from './status'

const STATE_TONES: Record<string, HeadingTone> = {
  closed: 'deleted',
  merged: 'accent',
  open: 'added',
}

const webRepo = (pr: PullRequest) => `https://${pr.host}/${pr.owner}/${pr.name}`

// The PR's commits may be on no local ref yet: someone else's push, or a base not fetched since.
async function ensureCommits(
  repo: string,
  pr: PullRequest
): Promise<string | null> {
  const [head, base] = await Promise.all([
    hasCommit(repo, pr.headOid),
    hasCommit(repo, pr.baseOid),
  ])
  if (head && base) {
    return null
  }
  const refspecs = [
    ...(head ? [] : [`refs/pull/${pr.number}/head`]),
    ...(base ? [] : [`refs/heads/${pr.base}`]),
  ]
  const remote = remoteFor(repo, webRepo(pr)) ?? `${webRepo(pr)}.git`
  const fetched = await fetchRefs(repo, remote, refspecs)
  if (!fetched.ok) {
    return `Could not fetch the pull request: ${fetched.detail}`
  }
  const [headNow, baseNow] = await Promise.all([
    hasCommit(repo, pr.headOid),
    hasCommit(repo, pr.baseOid),
  ])
  return headNow && baseNow
    ? null
    : 'The pull request’s commits are not on the remote any more'
}

export function createPullRequest(deps: {
  rootDir: string
  git: Git
  status: Status
  copyLink: (url: string) => void
}) {
  const { git, status } = deps
  const { say } = status
  const [pr, setPr] = createSignal<PullRequest | null>(null)
  const [loading, setLoading] = createSignal(false)
  let repo: string | null = null
  let source: ReturnType<typeof comparisonSource> | null = null
  let generation = 0

  const doc = createDiffDocument(
    (entry: DiffEntry): DiffContent | Promise<DiffContent> =>
      source?.load(entry) ?? {
        detail: 'No pull request is open',
        kind: 'error',
      }
  )

  const viewedCount = createMemo(
    () => doc.entries().filter((entry) => entry.viewed === 'viewed').length
  )

  // Keeps the reader's folds and place: a refresh is the same page with newer marks.
  const load = async (keep: boolean) => {
    const at = repo ?? git.activeRepo()
    if (at === null) {
      return say(noRepository(git), 'warn')
    }
    if (loading()) {
      return
    }
    generation += 1
    const run = generation
    setLoading(true)
    const release = status.claimBusy({ label: 'Reading the pull request' })
    try {
      say('Reading the pull request for this branch…')
      const found = await currentPullRequest(at)
      if (run !== generation) {
        return
      }
      if (!found.ok) {
        return say(found.detail, 'warn')
      }
      const request = found.value
      const [missing, files] = await Promise.all([
        ensureCommits(at, request),
        pullRequestFiles(at, request),
      ])
      if (run !== generation) {
        return
      }
      if (missing) {
        return say(missing, 'error')
      }
      if (!files.ok) {
        return say(files.detail, 'error')
      }
      const range = await rangeChanges(at, request.baseOid, request.headOid)
      if (run !== generation) {
        return
      }
      if (!range.ok) {
        return say(range.detail, 'error')
      }
      const viewed = new Map<string, ViewedState>(
        files.value.map((file) => [file.path, file.viewed])
      )
      repo = at
      source = comparisonSource(at, deps.rootDir, range.value.files)
      const entries = source.entries.map((entry) => ({
        ...entry,
        viewed: viewed.get(entry.key) ?? 'unviewed',
      }))
      if (keep && pr()?.id === request.id) {
        doc.setEntries(entries)
        doc.reload()
      } else {
        doc.reset(entries)
      }
      setPr(request)
      const seen = entries.filter((entry) => entry.viewed === 'viewed').length
      say(
        `#${request.number} · ${plural(entries.length, 'file')} · ${seen} viewed`
      )
    } finally {
      release()
      if (run === generation) {
        setLoading(false)
      }
    }
  }

  const open = () => {
    repo = null
    void load(false)
  }

  const refresh = () => {
    if (pr()) {
      void load(true)
    }
  }

  // Optimistic: the mark moves now, and comes back with the reason if GitHub refuses it.
  const toggleViewed = (key: string) => {
    const request = pr()
    const entry = doc.entry(key)
    if (!request || !entry || repo === null) {
      return
    }
    const before = entry.viewed ?? 'unviewed'
    const viewed = before !== 'viewed'
    doc.updateEntry(key, { viewed: viewed ? 'viewed' : 'unviewed' })
    doc.forgetFold(key)
    const run = generation
    void (async () => {
      const done = await setFileViewed(repo!, request, key, viewed)
      if (run !== generation) {
        return
      }
      if (!done.ok) {
        doc.updateEntry(key, { viewed: before })
        return say(`Could not mark ${entry.rel}: ${done.detail}`, 'error')
      }
      say(
        `${viewed ? 'Viewed' : 'Not viewed'}: ${entry.rel} · ${viewedCount()}/${doc.entries().length} on ${request.host}`
      )
    })()
  }

  const openWeb = () => {
    const request = pr()
    if (!request) {
      return
    }
    const url = `${request.url}/files`
    void (async () => {
      if (await openInBrowser(url)) {
        return say(`Opened #${request.number} on ${request.host}`)
      }
      // No browser to hand it to — over SSH there should not be one — so the link is copied instead.
      deps.copyLink(url)
      say(`Copied the link to #${request.number}`)
    })()
  }

  const close = () => {
    generation += 1
    setLoading(false)
    source = null
    repo = null
    doc.reset()
    setPr(null)
  }

  const heading = (): DiffHeading => {
    const request = pr()
    if (!request) {
      return { title: loading() ? 'Loading pull request…' : 'Pull request' }
    }
    const state = request.draft ? 'draft' : request.state
    const who = request.author ? `@${request.author}` : 'Someone'
    return {
      aside: `${viewedCount()}/${doc.entries().length} viewed`,
      byline: `${who} wants to merge ${request.head} into ${request.base}`,
      ref: `#${request.number}`,
      state: { text: state, tone: STATE_TONES[state] ?? 'dim' },
      title: request.title,
    }
  }

  const isOpen = () => pr() !== null

  return {
    close,
    doc,
    heading,
    isOpen,
    loading,
    open,
    openWeb,
    pr,
    refresh,
    toggleViewed,
  }
}

export type PullRequestPage = ReturnType<typeof createPullRequest>
