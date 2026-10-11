import { createEffect, createMemo, createSignal, untrack } from 'solid-js'

import { unifiedDiff } from '../core/diff'
import type {
  DiffMeta,
  DiffSection,
  DiffSectionBody,
  ViewedMark,
} from '../ui/DiffPage'
import { DIFF_MAX_LINES, firstChangedLine, isPlainDiff } from '../ui/diffRows'
import type { DiffFileStatus } from '../ui/diffRows'

export interface DiffEntry {
  key: string
  // Absolute: what Enter opens and what picks the grammar.
  path: string
  rel: string
  oldRel?: string | null
  status: DiffFileStatus
  badge?: string | null
  stage?: 'stage' | 'unstage' | null
  viewed?: ViewedMark | null
  // What the source already knows before the text is read (numstat, the forge's counts).
  adds?: number | null
  dels?: number | null
}

export type DiffContent =
  | { kind: 'text'; oldText: string; newText: string }
  | { kind: 'binary' }
  | { kind: 'error'; detail: string }

export type DiffLoader = (
  entry: DiffEntry
) => DiffContent | Promise<DiffContent>

const LOAD_CONCURRENCY = 4

const sameContent = (a: DiffContent, b: DiffContent) =>
  a.kind === 'text' && b.kind === 'text'
    ? a.oldText === b.oldText && a.newText === b.newText
    : a.kind === b.kind

// An empty patch still costs a row, or a folder of them would never fill the page.
const bodyCost = (body: DiffSectionBody | null) =>
  body ? Math.max(1, body.lines) : 1

export function createDiffDocument(
  load: DiffLoader,
  options: { maxLines?: number } = {}
) {
  const maxLines = options.maxLines ?? DIFF_MAX_LINES
  const [entries, setEntryList] = createSignal<DiffEntry[]>([])
  const [contents, setContents] = createSignal(new Map<string, DiffContent>())
  const [folds, setFolds] = createSignal(new Map<string, boolean>())
  const [pin, setPin] = createSignal<string | null>(null)
  const inflight = new Set<string>()
  // Bumped whenever what is loaded stops being trusted; a late answer from before is dropped.
  let generation = 0

  // By content identity: the same object is the same patch, and a refresh hands the same one back.
  const bodies = new WeakMap<DiffContent, DiffSectionBody>()
  const bodyOf = (
    entry: DiffEntry,
    content: DiffContent
  ): DiffSectionBody | null => {
    if (content.kind !== 'text') {
      return null
    }
    const hit = bodies.get(content)
    if (hit && hit.path === entry.path) {
      return hit
    }
    const diff = unifiedDiff(
      entry.rel,
      content.oldText,
      content.newText,
      DIFF_MAX_LINES
    )
    const body: DiffSectionBody = {
      adds: diff.adds,
      dels: diff.dels,
      lines: diff.lines,
      newText: content.newText,
      oldText: content.oldText,
      patch: diff.patch,
      path: entry.path,
      plain: isPlainDiff(content.oldText, content.newText, diff.lines),
      truncated: diff.truncated,
    }
    bodies.set(content, body)
    return body
  }

  const foldedByDefault = (entry: DiffEntry) => entry.viewed === 'viewed'

  // A held file is one the page budget kept from loading; it waits folded for → to ask for it.
  const wants = (entry: DiffEntry, used: number) => {
    const explicit = folds().get(entry.key)
    if (explicit === false || pin() === entry.key) {
      return true
    }
    return explicit === undefined && !foldedByDefault(entry) && used < maxLines
  }

  const arrive = async (
    pending: Promise<DiffContent>
  ): Promise<DiffContent> => {
    try {
      return await pending
    } catch (error) {
      return { detail: (error as Error).message, kind: 'error' }
    }
  }

  const settle = async (
    key: string,
    pending: Promise<DiffContent>,
    run: number
  ) => store(key, await arrive(pending), run)

  // A reload keeps showing the old text until the new one lands, and only swaps if it differs.
  const replaceLater = async (
    key: string,
    before: DiffContent,
    pending: Promise<DiffContent>,
    run: number
  ) => {
    const content = await arrive(pending)
    if (run === generation && !sameContent(before, content)) {
      setContents((cur) => new Map(cur).set(key, content))
    }
  }

  const store = (key: string, content: DiffContent, run: number) => {
    if (run !== generation) {
      return
    }
    inflight.delete(key)
    if (!entries().some((entry) => entry.key === key)) {
      return
    }
    setContents((cur) => new Map(cur).set(key, content))
  }

  const request = (entry: DiffEntry, run: number): DiffContent | null => {
    let answer: DiffContent | Promise<DiffContent>
    try {
      answer = load(entry)
    } catch (error) {
      return { detail: (error as Error).message, kind: 'error' }
    }
    if (!(answer instanceof Promise)) {
      return answer
    }
    inflight.add(entry.key)
    void settle(entry.key, answer, run)
    return null
  }

  // In page order, so the top of the page is what arrives first and what the budget is spent on.
  createEffect(() => {
    const list = entries()
    const have = contents()
    folds()
    pin()
    untrack(() => {
      const run = generation
      const batch = new Map<string, DiffContent>()
      let used = 0
      for (const entry of list) {
        let content = have.get(entry.key) ?? batch.get(entry.key)
        if (!content) {
          if (inflight.has(entry.key) || !wants(entry, used)) {
            continue
          }
          if (inflight.size >= LOAD_CONCURRENCY) {
            break
          }
          content = request(entry, run) ?? undefined
          if (!content) {
            continue
          }
          batch.set(entry.key, content)
        }
        const folded = folds().get(entry.key) ?? foldedByDefault(entry)
        if (!folded) {
          used += bodyCost(bodyOf(entry, content))
        }
      }
      if (batch.size > 0) {
        setContents((cur) => new Map([...cur, ...batch]))
      }
    })
  })

  const sections = createMemo((): DiffSection[] => {
    const have = contents()
    let used = 0
    return entries().map((entry) => {
      const content = have.get(entry.key)
      const body = content ? bodyOf(entry, content) : undefined
      const explicit = folds().get(entry.key)
      const held = !content && !wants(entry, used)
      const folded = explicit ?? (foldedByDefault(entry) || held)
      if (content && !folded) {
        used += bodyCost(body ?? null)
      }
      let note: string | null = null
      if (content?.kind === 'binary') {
        note = 'binary'
      } else if (content?.kind === 'error') {
        note = content.detail
      } else if (!content && !folded) {
        note = 'loading…'
      } else if (held && explicit === undefined && !foldedByDefault(entry)) {
        note = 'not loaded · → shows it'
      }
      return {
        adds: body?.adds ?? entry.adds ?? null,
        badge: entry.badge ?? null,
        body,
        dels: body?.dels ?? entry.dels ?? null,
        folded,
        key: entry.key,
        note,
        oldRel: entry.oldRel ?? null,
        rel: entry.rel,
        stage: entry.stage ?? null,
        status: entry.status,
        viewed: entry.viewed ?? null,
      }
    })
  })

  const meta = createMemo((): DiffMeta => {
    let adds = 0
    let dels = 0
    for (const section of sections()) {
      adds += section.adds ?? 0
      dels += section.dels ?? 0
    }
    return { adds, dels, total: entries().length }
  })

  const setEntries = (list: DiffEntry[]) => {
    const keys = new Set(list.map((entry) => entry.key))
    setEntryList(list)
    setContents((cur) => {
      const kept = new Map([...cur].filter(([key]) => keys.has(key)))
      return kept.size === cur.size ? cur : kept
    })
  }

  // Re-reads what is loaded; an unchanged answer keeps its object, so its diff is not redone.
  const reload = () => {
    generation += 1
    inflight.clear()
    const run = generation
    const have = contents()
    const next = new Map<string, DiffContent>()
    for (const entry of entries()) {
      const before = have.get(entry.key)
      if (!before) {
        continue
      }
      let answer: DiffContent | Promise<DiffContent>
      try {
        answer = load(entry)
      } catch (error) {
        answer = { detail: (error as Error).message, kind: 'error' }
      }
      if (answer instanceof Promise) {
        next.set(entry.key, before)
        void replaceLater(entry.key, before, answer, run)
      } else {
        next.set(entry.key, sameContent(before, answer) ? before : answer)
      }
    }
    setContents(next)
  }

  const reset = (list: DiffEntry[] = []) => {
    generation += 1
    inflight.clear()
    setFolds(new Map())
    setPin(null)
    setContents(new Map())
    setEntryList(list)
  }

  const setFolded = (key: string, folded: boolean) =>
    setFolds((cur) => new Map(cur).set(key, folded))

  // The source changed what a file defaults to (marked viewed): its own default applies again.
  const forgetFold = (key: string) =>
    setFolds((cur) => {
      if (!cur.has(key)) {
        return cur
      }
      const next = new Map(cur)
      next.delete(key)
      return next
    })

  const updateEntry = (key: string, change: Partial<DiffEntry>) =>
    setEntryList((cur) =>
      cur.map((entry) => (entry.key === key ? { ...entry, ...change } : entry))
    )

  const entry = (key: string) => entries().find((item) => item.key === key)

  const firstLine = (key: string) => {
    const content = contents().get(key)
    return content?.kind === 'text'
      ? firstChangedLine(content.oldText, content.newText)
      : 0
  }

  return {
    entries,
    entry,
    firstLine,
    forgetFold,
    meta,
    reload,
    reset,
    sections,
    setEntries,
    setFolded,
    setPin,
    updateEntry,
  }
}

export type DiffDocument = ReturnType<typeof createDiffDocument>
