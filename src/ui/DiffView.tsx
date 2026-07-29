import type { DiffRenderable, KeyEvent, TreeSitterClient } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onMount, Show } from 'solid-js'

import { unifiedDiff } from '../core/diff'
import type { FileStatus } from '../core/git'
import { fuzzyScore } from '../core/search'
import {
  computeHighlights,
  filetypeForPath,
  getSyntaxStyle,
  highlightClient,
  STALE,
} from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'
import { listRows, modalWidth, PAD } from './modal'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export type DiffMode = 'inline' | 'split'

export interface DiffFile {
  path: string
  /** Shown to the user; `path` keys the workspace. */
  rel: string
  status: FileStatus
  oldText: string
  newText: string
}

export interface DiffViewProps {
  files: DiffFile[]
  index: number
  mode: DiffMode
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  /** The page shares the editor's focus slot; unfocused, its keys stay dead. */
  focused: boolean
  /** A modal above the page owns the keys — this pane's handler runs first. */
  blocked: boolean
  onFocus: () => void
  onIndex: (index: number) => void
  onToggleMode: () => void
  onClose: () => void
}

/**
 * Mix `color` toward `base`. The diff backgrounds cannot come from the theme —
 * no palette ships "faint green fill" — so they are blended from the git colors
 * every theme already has, which keeps them legible on light and dark alike.
 */
function blend(color: string, base: string, amount: number): string {
  const rgb = (hex: string): number[] | null =>
    /^#[0-9a-f]{6}$/i.test(hex)
      ? [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16))
      : null
  const from = rgb(color)
  const to = rgb(base)
  if (!from || !to) return base
  const mix = (i: number) =>
    Math.round(from[i]! * amount + to[i]! * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(1)}${mix(2)}`
}

/** `[startOffset, endOffset, captureGroup]` in the pane document's coordinates. */
type PaneHighlight = [number, number, string]

type OnHighlight = (
  given: PaneHighlight[],
  context: { content: string },
) => Promise<PaneHighlight[] | undefined>

interface CodePane {
  scrollY: number
  maxScrollY: number
  onHighlight?: OnHighlight
}

/** The scrollable panes inside the `<diff>` renderable — private upstream, but
 * assigning `scrollY` and `onHighlight` is how its own internals drive them. */
interface DiffSides {
  leftCodeRenderable?: CodePane | null
  rightCodeRenderable?: CodePane | null
}

/** Which source document a pane line shows, and which of its lines. */
interface LineRef {
  side: 'old' | 'new'
  line: number
}

/**
 * What each pane line displays, replayed from the patch exactly the way the
 * `<diff>` renderable assembles its panes: unified interleaves the hunk lines
 * into one document; split pairs a change block's removals and additions row
 * for row, padding the shorter side with blank lines (the nulls here).
 */
function paneLines(patch: string, view: 'unified' | 'split') {
  const left: (LineRef | null)[] = []
  const right: (LineRef | null)[] = []
  const lines = patch.split('\n')
  let at = 0
  let oldLine = 0
  let newLine = 0
  while (at < lines.length) {
    const header = lines[at]!.match(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/)
    at++
    if (!header) continue
    oldLine = Math.max(0, Number(header[1]) - 1)
    newLine = Math.max(0, Number(header[2]) - 1)
    while (at < lines.length && !lines[at]!.startsWith('@@')) {
      const mark = lines[at]![0]
      if (mark === ' ') {
        if (view === 'split') {
          left.push({ side: 'old', line: oldLine })
          right.push({ side: 'new', line: newLine })
        } else {
          left.push({ side: 'new', line: newLine })
        }
        oldLine++
        newLine++
        at++
      } else if (mark === '-' || mark === '+') {
        const dels: LineRef[] = []
        const adds: LineRef[] = []
        while (at < lines.length && (lines[at]![0] === '-' || lines[at]![0] === '+')) {
          if (lines[at]![0] === '-') dels.push({ side: 'old', line: oldLine++ })
          else adds.push({ side: 'new', line: newLine++ })
          at++
        }
        if (view === 'split') {
          for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
            left.push(dels[i] ?? null)
            right.push(adds[i] ?? null)
          }
        } else {
          left.push(...dels, ...adds)
        }
      } else {
        at++
      }
    }
  }
  return { left, right }
}

/** Greatest line whose start offset is at or before `offset`. */
function lineAt(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low
}

/**
 * The diff pane: takes the editor's place while open and pages through the
 * files it was given. Rendering is OpenTUI's `<diff>` renderable — unified or
 * split view, tree-sitter syntax highlighting, native scrolling — this
 * component only feeds it patches and colors and owns the keyboard.
 */
export function DiffView(props: DiffViewProps) {
  const dimensions = useTerminalDimensions()
  /** The file picker floating over the diff (multi-file only). */
  const [picking, setPicking] = createSignal(false)

  const file = () => props.files[props.index] ?? props.files[0]!

  /**
   * Per-file diffs, computed once each — the picker shows every file's counts,
   * and the file being viewed reads from the same cache. Keyed by path: the
   * files array is fixed for the life of the pane.
   */
  const cache = new Map<string, ReturnType<typeof unifiedDiff>>()
  const diffFor = (f: DiffFile) => {
    let d = cache.get(f.path)
    if (!d) {
      d = unifiedDiff(f.rel, f.oldText, f.newText)
      cache.set(f.path, d)
    }
    return d
  }

  const diff = createMemo(() => diffFor(file()))

  /**
   * `<diff>` takes its tree-sitter client at construction only, so the pane
   * waits for the shared one — letting the renderable default would spin up a
   * second, uninitialized client without the vendored grammars.
   */
  const [client, setClient] = createSignal<TreeSitterClient | null | undefined>(undefined)
  onMount(() => void highlightClient().then(c => setClient(c)))

  let pane: DiffRenderable | undefined

  const sides = () => {
    const host = pane as unknown as DiffSides | undefined
    return [host?.leftCodeRenderable, host?.rightCodeRenderable].filter(
      (side): side is CodePane => side != null,
    )
  }

  /**
   * The panes hold fragments — hunk lines glued together — and tree-sitter's
   * error recovery on such a fragment drops or misreads captures (JSX attribute
   * names went unstyled on the removed side). So each pane's highlight pass is
   * replaced: highlight the *full* old and new documents once, then remap those
   * captures onto the fragment's lines. Cached per file/pane/view; the callback
   * keeps a stable identity because reassigning `onHighlight` re-runs the pass.
   */
  const docCache = new Map<string, Promise<Highlighted | null>>()
  const fullDoc = (f: DiffFile, side: 'old' | 'new') => {
    const key = `${side}:${f.path}`
    let doc = docCache.get(key)
    if (!doc) {
      doc = computeHighlights(side === 'old' ? f.oldText : f.newText, filetypeForPath(f.path)).then(
        result => (result === STALE ? null : result),
      )
      docCache.set(key, doc)
    }
    return doc
  }

  const paneHighlighter = (() => {
    const cbCache = new Map<string, OnHighlight>()
    return (f: DiffFile, which: 'left' | 'right', view: 'unified' | 'split'): OnHighlight => {
      const key = `${view}:${which}:${f.path}`
      const cached = cbCache.get(key)
      if (cached) return cached
      const cb: OnHighlight = async (_given, context) => {
        const refs = paneLines(diffFor(f).patch, view)[which]
        const [oldDoc, newDoc] = await Promise.all([fullDoc(f, 'old'), fullDoc(f, 'new')])

        const paneStarts = [0]
        for (let i = 0; i < context.content.length; i++) {
          if (context.content.charCodeAt(i) === 10) paneStarts.push(i + 1)
        }
        // Source line -> pane lines that show it.
        const bySource = { old: new Map<number, number[]>(), new: new Map<number, number[]>() }
        refs.forEach((ref, paneLine) => {
          if (!ref) return
          const rows = bySource[ref.side].get(ref.line)
          if (rows) rows.push(paneLine)
          else bySource[ref.side].set(ref.line, [paneLine])
        })

        const out: PaneHighlight[] = []
        const emit = (doc: Highlighted | null, side: 'old' | 'new') => {
          if (!doc || bySource[side].size === 0) return
          // `ordered` runs least specific first and the painter applies in
          // order, so walking it keeps the most specific capture on top.
          for (const capture of doc.ordered) {
            // Guides carry a background fill that would stamp over the diff's.
            if (capture.group === 'indent.guide') continue
            for (
              let line = lineAt(doc.starts, capture.start);
              line < doc.starts.length && doc.starts[line]! < capture.end;
              line++
            ) {
              const rows = bySource[side].get(line)
              if (!rows) continue
              const lineStart = doc.starts[line]!
              const lineEnd =
                line + 1 < doc.starts.length ? doc.starts[line + 1]! - 1 : doc.content.length
              const from = Math.max(capture.start, lineStart)
              const to = Math.min(capture.end, lineEnd)
              if (to <= from) continue
              for (const paneLine of rows) {
                const base = paneStarts[paneLine]!
                out.push([base + (from - lineStart), base + (to - lineStart), capture.group])
              }
            }
          }
        }
        emit(oldDoc, 'old')
        emit(newDoc, 'new')
        return out
      }
      cbCache.set(key, cb)
      return cb
    }
  })()

  // Attach after the renderable's own (microtask-queued) rebuild has created
  // the panes for this diff and view; assigning marks highlights dirty, so an
  // already-finished pass simply runs again with the callback in place.
  createEffect(
    on([diff, () => props.mode, client], () => {
      const f = file()
      const view = props.mode === 'split' ? 'split' : 'unified'
      setTimeout(() => {
        const host = pane as unknown as DiffSides | undefined
        if (!host) return
        if (host.leftCodeRenderable) {
          host.leftCodeRenderable.onHighlight = paneHighlighter(f, 'left', view)
        }
        if (host.rightCodeRenderable) {
          host.rightCodeRenderable.onHighlight = paneHighlighter(f, 'right', view)
        }
      }, 0)
    }),
  )
  const scroll = (delta: number) => {
    for (const side of sides()) {
      side.scrollY = Math.max(0, Math.min(side.maxScrollY, side.scrollY + delta))
    }
  }
  const scrollTo = (row: number) => {
    for (const side of sides()) side.scrollY = Math.max(0, Math.min(side.maxScrollY, row))
  }

  createEffect(on([() => props.index, () => props.mode], () => scrollTo(0), { defer: true }))

  /** Rows a page spans — the pane is the editor slot: tabs, header, status bar off. */
  const page = () => Math.max(1, dimensions().height - 3)

  const switchFile = (step: number) => {
    const count = props.files.length
    if (count > 1) props.onIndex((props.index + step + count) % count)
  }

  useKeyboard((key: KeyEvent) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse. The
    // picker owns the keyboard while open — letting j/k scroll the diff under
    // its search field would be chaos.
    if (props.blocked || !props.focused || key.defaultPrevented || picking()) return
    const k = key.name
    if (k === 'f' && props.files.length > 1) setPicking(true)
    else if (k === 'up' || k === 'k') scroll(-1)
    else if (k === 'down' || k === 'j') scroll(1)
    else if (k === 'pageup') scroll(-page())
    else if (k === 'pagedown' || k === 'space') scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    else if (k === 'left' || k === 'h' || k === 'p') switchFile(-1)
    else if (k === 'right' || k === 'l' || k === 'n') switchFile(1)
    else if (k === 'tab' || k === 's') props.onToggleMode()
    else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    const mode = props.mode === 'inline' ? 'inline' : 'side-by-side'
    const multi = props.files.length > 1
    const full = ` ${mode} · Tab layout${multi ? ' · ←→ file · F find' : ''} · Esc close `
    if (full.length + 28 <= props.width) return full
    return ` ${mode} · Tab${multi ? ' · ←→ · F' : ''} · Esc `
  }

  /**
   * Path cut from the left to what the row can spare: neither header span may
   * shrink, so a long path used to push the hints (and its own start) off the
   * screen entirely. The tail of a path is the part that identifies the file.
   */
  const header = () => {
    const d = diff()
    const which = props.files.length > 1 ? ` · file ${props.index + 1}/${props.files.length}` : ''
    const tail = ` · +${d.adds} −${d.dels}${which}`
    const room = Math.max(8, props.width - hints().length - tail.length - 3)
    let rel = file().rel
    if (rel.length > room) rel = `…${rel.slice(rel.length - room + 1)}`
    return ` ${MARKS[file().status]} ${rel}${tail}`
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.bg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" backgroundColor={ui.barBg}>
        <text fg={statusColor(file().status)} bg={ui.barBg} flexShrink={0} content={header()} />
        <box flexGrow={1} backgroundColor={ui.barBg} />
        <text fg={ui.dim} bg={ui.barBg} flexShrink={0} content={hints()} />
      </box>

      <Show
        when={diff().patch !== '' && client() !== undefined}
        fallback={
          <text
            fg={ui.dim}
            bg={ui.bg}
            content={diff().patch === '' ? '  No changes in this file' : ''}
          />
        }
      >
        <diff
          ref={(el: DiffRenderable) => (pane = el)}
          diff={diff().patch}
          view={props.mode === 'split' ? 'split' : 'unified'}
          filetype={filetypeForPath(file().path)}
          syntaxStyle={getSyntaxStyle()}
          treeSitterClient={client() ?? undefined}
          syncScroll
          wrapMode="none"
          flexGrow={1}
          width="100%"
          fg={ui.text}
          lineNumberFg={ui.gutter}
          lineNumberBg={ui.bg}
          contextBg={ui.bg}
          addedBg={blend(ui.gitAdded, ui.bg, 0.14)}
          removedBg={blend(ui.gitDeleted, ui.bg, 0.14)}
          addedLineNumberBg={blend(ui.gitAdded, ui.bg, 0.28)}
          removedLineNumberBg={blend(ui.gitDeleted, ui.bg, 0.28)}
          addedSignColor={ui.gitAdded}
          removedSignColor={ui.gitDeleted}
          selectionBg={ui.treeSelectedBg}
        />
      </Show>

      <Show when={picking()}>
        <DiffFilePicker
          files={props.files}
          activeIndex={props.index}
          paneWidth={props.width}
          diffFor={diffFor}
          onPick={index => {
            setPicking(false)
            props.onIndex(index)
          }}
          onClose={() => setPicking(false)}
        />
      </Show>
    </box>
  )
}

/**
 * Fuzzy jump between the files of an "all changes" diff. Each row carries the
 * file's status mark and its own +/− counts, so the list doubles as the
 * overview of what changed where.
 */
function DiffFilePicker(props: {
  files: DiffFile[]
  activeIndex: number
  /** The overlay is confined to the diff pane, so the modal sizes to it. */
  paneWidth: number
  diffFor: (file: DiffFile) => { adds: number; dels: number }
  onPick: (index: number) => void
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(props.paneWidth, 0.85, 40, 110)
  const visibleRows = () => listRows(dimensions().height, 8, 18)

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { at: number; score: number }[] = []
    for (let at = 0; at < props.files.length; at++) {
      const score = fuzzyScore(props.files[at]!.rel, q)
      if (score !== null) scored.push({ at, score })
    }
    return scored.toSorted((a, b) => a.score - b.score).slice(0, visibleRows())
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

  const totals = () => {
    let adds = 0
    let dels = 0
    for (const file of props.files) {
      const d = props.diffFor(file)
      adds += d.adds
      dels += d.dels
    }
    return { adds, dels }
  }

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    const count = Math.max(1, matches().length)
    if (k === 'up') {
      key.preventDefault()
      setIndex(i => (i - 1 + count) % count)
    } else if (k === 'down') {
      key.preventDefault()
      setIndex(i => (i + 1) % count)
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      const match = matches()[selected()]
      if (match) props.onPick(match.at)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onClose()
    }
  })

  return (
    <Overlay zIndex={150}>
      <box
        width={width()}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={` Changed files — ${props.files.length} · +${totals().adds} −${totals().dels} `}
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <TextInput
          value={query()}
          placeholder="Type part of a path…"
          onInput={value => {
            setQuery(value)
            setIndex(0)
          }}
        />
        <text fg={ui.panelBg} bg={ui.panelBg} content="" />
        <Show
          when={matches().length > 0}
          fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matches" />}
        >
          <For each={matches()}>
            {(match, i) => {
              const active = () => i() === selected()
              const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
              const file = props.files[match.at]!
              const counts = props.diffFor(file)
              // Room for the marker (2), mark (2), counts and a gap.
              const stats = `+${counts.adds} −${counts.dels}`
              const shown = file.rel.slice(0, width() - PAD * 2 - 6 - stats.length)
              const cut = shown.lastIndexOf('/') + 1
              return (
                <box flexDirection="row" backgroundColor={bg()}>
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                  <text
                    fg={statusColor(file.status)}
                    bg={bg()}
                    flexShrink={0}
                    content={`${MARKS[file.status]} `}
                  />
                  {/* An empty <text> still occupies a column — skip it entirely
                      for root-level files or their names sit a cell too far right. */}
                  <Show when={cut > 0}>
                    <text fg={ui.faint} bg={bg()} flexShrink={0} content={shown.slice(0, cut)} />
                  </Show>
                  <text
                    fg={match.at === props.activeIndex ? ui.accent : active() ? ui.text : ui.dim}
                    bg={bg()}
                    flexShrink={0}
                    content={shown.slice(cut)}
                  />
                  <box flexGrow={1} backgroundColor={bg()} />
                  <text fg={ui.gitAdded} bg={bg()} flexShrink={0} content={`+${counts.adds} `} />
                  <text fg={ui.gitDeleted} bg={bg()} flexShrink={0} content={`−${counts.dels}`} />
                </box>
              )
            }}
          </For>
        </Show>
        <text fg={ui.dim} bg={ui.panelBg} content="↑↓ move · Enter open · Esc back" />
      </box>
    </Overlay>
  )
}
