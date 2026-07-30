import type { DiffRenderable, KeyEvent, TreeSitterClient } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, on, onMount, Show } from 'solid-js'

import { unifiedDiff } from '../core/diff'
import type { FileStatus } from '../core/git'
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
  /** The one change on screen. Which one is the source-control panel's cursor to
   * say: this pane scrolls and toggles layout, it does not page. */
  file: DiffFile
  mode: DiffMode
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  /** The page shares the editor's focus slot; unfocused, its keys stay dead. */
  focused: boolean
  /** A modal above the page owns the keys — this pane's handler runs first. */
  blocked: boolean
  onFocus: () => void
  onToggleMode: () => void
  /** Esc: closes the page, or hands the focus back to whatever opened it. */
  onClose: () => void
  /** What Esc does now, for the hint line — the caller owns the behaviour. */
  escLabel?: string
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
 * The diff pane: takes the editor's place while open and shows the one change
 * the source-control panel's cursor is on. Rendering is OpenTUI's `<diff>`
 * renderable — unified or split view, tree-sitter syntax highlighting, native
 * scrolling — this component only feeds it a patch and colors and owns the
 * keyboard.
 */
export function DiffView(props: DiffViewProps) {
  const dimensions = useTerminalDimensions()

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
   * The same change re-read is not a new one: `refreshDiff` hands the page a
   * fresh object on every git revision — a commit anywhere, a save in another
   * file — and rebuilding everything below for identical texts drops the syntax
   * colors until the async pass lands again.
   */
  const file = createMemo(() => props.file, undefined, {
    equals: (a, b) => a.path === b.path && a.oldText === b.oldText && a.newText === b.newText,
  })

  /**
   * Everything derived from the change on screen: its patch, and the highlight
   * pass each pane runs. Rebuilt whole when the panel's cursor moves to another
   * file — or re-reads this one with different texts, which is why none of it
   * may be cached by path.
   *
   * The panes hold fragments — hunk lines glued together — and tree-sitter's
   * error recovery on such a fragment drops or misreads captures (JSX attribute
   * names went unstyled on the removed side). So each pane's highlight pass is
   * replaced: highlight the *full* old and new documents once, then remap those
   * captures onto the fragment's lines. The callbacks are cached per pane/view
   * because reassigning `onHighlight` re-runs the pass.
   */
  const current = createMemo(() => {
    const f = file()
    const diff = unifiedDiff(f.rel, f.oldText, f.newText)

    const docs = new Map<string, Promise<Highlighted | null>>()
    const fullDoc = (side: 'old' | 'new') => {
      let doc = docs.get(side)
      if (!doc) {
        doc = computeHighlights(
          side === 'old' ? f.oldText : f.newText,
          filetypeForPath(f.path),
        ).then(result => (result === STALE ? null : result))
        docs.set(side, doc)
      }
      return doc
    }

    const cbCache = new Map<string, OnHighlight>()
    const highlighter = (which: 'left' | 'right', view: 'unified' | 'split'): OnHighlight => {
      const key = `${view}:${which}`
      const cached = cbCache.get(key)
      if (cached) return cached
      const cb: OnHighlight = async (_given, context) => {
        const refs = paneLines(diff.patch, view)[which]
        const [oldDoc, newDoc] = await Promise.all([fullDoc('old'), fullDoc('new')])

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

    return { diff, highlighter }
  })

  const diff = () => current().diff

  // Attach after the renderable's own (microtask-queued) rebuild has created
  // the panes for this diff and view; assigning marks highlights dirty, so an
  // already-finished pass simply runs again with the callback in place.
  createEffect(
    on([current, () => props.mode, client], () => {
      const highlighter = current().highlighter
      const view = props.mode === 'split' ? 'split' : 'unified'
      setTimeout(() => {
        const host = pane as unknown as DiffSides | undefined
        if (!host) return
        if (host.leftCodeRenderable) host.leftCodeRenderable.onHighlight = highlighter('left', view)
        if (host.rightCodeRenderable) {
          host.rightCodeRenderable.onHighlight = highlighter('right', view)
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

  // Keyed on the path, not the file: a refresh rebuilds the same change on every
  // save, and resetting the scroll then would throw the reader back to the top.
  createEffect(on([() => props.file.path, () => props.mode], () => scrollTo(0), { defer: true }))

  /** Rows a page spans — the pane is the editor slot: tabs, header, status bar off. */
  const page = () => Math.max(1, dimensions().height - 3)

  useKeyboard((key: KeyEvent) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse.
    if (props.blocked || !props.focused || key.defaultPrevented) return
    const k = key.name
    // The arrows scroll here and page through the changes in the source-control
    // panel — one pane owns each meaning, so neither has to be a chord.
    if (k === 'up' || k === 'k') scroll(-1)
    else if (k === 'down' || k === 'j') scroll(1)
    else if (k === 'pageup') scroll(-page())
    else if (k === 'pagedown' || k === 'space') scroll(page())
    else if (k === 'end' || (k === 'g' && key.shift)) scrollTo(Number.MAX_SAFE_INTEGER)
    else if (k === 'home' || k === 'g') scrollTo(0)
    else if (k === 'tab' || k === 's') props.onToggleMode()
    else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    const mode = props.mode === 'inline' ? 'inline' : 'side-by-side'
    const full = ` ${mode} · Tab layout · Esc ${props.escLabel ?? 'close'} `
    if (full.length + 28 <= props.width) return full
    return ` ${mode} · Tab · Esc `
  }

  /**
   * Path cut from the left to what the row can spare: neither header span may
   * shrink, so a long path used to push the hints (and its own start) off the
   * screen entirely. The tail of a path is the part that identifies the file.
   */
  const header = () => {
    const d = diff()
    const tail = ` · +${d.adds} −${d.dels}`
    const room = Math.max(8, props.width - hints().length - tail.length - 3)
    let rel = props.file.rel
    if (rel.length > room) rel = `…${rel.slice(rel.length - room + 1)}`
    return ` ${MARKS[props.file.status]} ${rel}${tail}`
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
        <text fg={statusColor(props.file.status)} bg={ui.barBg} flexShrink={0} content={header()} />
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
          filetype={filetypeForPath(props.file.path)}
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
    </box>
  )
}
