import { basename, relative } from 'node:path'

import { TextAttributes } from '@opentui/core'
import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import type { Context, Match, SearchOptions } from '../core/search'
import { buildQuery, contextAround, contextIn, searchProject, searchText } from '../core/search'
import { ui } from '../themes'
import { windowAround } from './list'
import { modalWidth, PAD } from './modal'
import { ModalPanel, topInset } from './Overlay'
import { TextInput } from './TextInput'

export type SearchScope = 'file' | 'project'

export interface SearchPanelProps {
  scope: SearchScope
  rootDir: string
  activePath: string | null
  activeContent: string
  /** What the editor had selected, so the obvious query is already typed. */
  initialQuery?: string
  /** Open with the replacement field already showing. */
  replacing?: boolean
  onPick: (match: Match) => void
  /** Replace the selected match only. Absent for project-wide search. */
  onReplaceOne?: (match: Match, replacement: string) => void
  /** Replace every match in the open file. Absent for project-wide search. */
  onReplaceAll?: (query: string, replacement: string, options: SearchOptions) => void
  onClose: () => void
}

const MIN_QUERY = 2

/** Lines either side of the selected match in the preview. */
const CONTEXT = 2

/**
 * A project scan reads every file in the tree — around 90ms across 2 600 files, and
 * it grows from there. Running that on the keystroke means each character freezes
 * the editor, so the scan waits for the typing to settle. In-file search is only
 * string work on the open buffer, so it stays immediate.
 */
const SCAN_DEBOUNCE_MS = 140

/**
 * A file heading, or one of its matches. `at` indexes into `matches()` — a heading
 * points at the first of its own, so the summary and preview read the same off both.
 * Selection lands on a match, or on a heading once it is folded and stands in for them.
 */
type Row =
  | { kind: 'file'; path: string; count: number; at: number; folded: boolean }
  | { kind: 'match'; match: Match; at: number }

/** An open file's heading is scenery; a folded one stands in for its matches. */
const selectable = (row: Row) => row.kind === 'match' || row.folded

export function SearchPanel(props: SearchPanelProps) {
  const dimensions = useTerminalDimensions()
  // Read once: the panel is mounted fresh each time it opens, and re-reading would
  // fight whatever has been typed since.
  const opened = props.initialQuery ?? ''
  const [query, setQuery] = createSignal(opened)
  /** The query the results belong to; trails `query` while a project scan is pending. */
  const [scanned, setScanned] = createSignal(opened)
  const [replacement, setReplacement] = createSignal('')
  const [replacing, setReplacing] = createSignal(props.replacing ?? false)
  /** Row the selection is nearest to, not the match: rows outnumber matches. */
  const [index, setIndex] = createSignal(0)
  /** Paths whose matches are hidden behind their heading. */
  const [folded, setFolded] = createSignal<ReadonlySet<string>>(new Set())
  const [options, setOptions] = createSignal<SearchOptions>({})

  let scanTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (scanTimer) clearTimeout(scanTimer)
  })

  const type = (value: string) => {
    setQuery(value)
    setIndex(0)
    // The folds belong to the result set they were made in; carrying them over
    // leaves a fresh search with files already hidden for no visible reason.
    setFolded(new Set<string>())
    if (props.scope !== 'project') return setScanned(value)
    if (scanTimer) clearTimeout(scanTimer)
    scanTimer = setTimeout(() => setScanned(value), SCAN_DEBOUNCE_MS)
  }

  const pending = () => props.scope === 'project' && scanned() !== query()

  const matches = createMemo(() => {
    const q = scanned()
    if (q.length < MIN_QUERY) return []
    return props.scope === 'project'
      ? searchProject(props.rootDir, q, options())
      : searchText(props.activeContent, q, props.activePath ?? '', options())
  })

  /**
   * Matches grouped under their file. Grouping is what buys the line text the whole
   * width: the old flat list spent 34 columns repeating the same path on every row.
   */
  const rows = createMemo<Row[]>(() => {
    const out: Row[] = []
    const all = matches()
    const hidden = folded()
    for (let i = 0; i < all.length; i++) {
      const match = all[i]!
      if (props.scope === 'project' && match.path !== all[i - 1]?.path) {
        let count = 0
        while (all[i + count]?.path === match.path) count++
        const shut = hidden.has(match.path)
        out.push({ kind: 'file', path: match.path, count, at: i, folded: shut })
        if (shut) {
          i += count - 1
          continue
        }
      }
      out.push({ kind: 'match', match, at: i })
    }
    return out
  })

  /** Index into `rows()` of the selected row, or -1 when there is nothing to select. */
  const selected = createMemo(() => {
    const all = rows()
    if (all.length === 0) return -1
    const from = Math.min(index(), all.length - 1)
    for (let i = from; i < all.length; i++) if (selectable(all[i]!)) return i
    for (let i = from - 1; i >= 0; i--) if (selectable(all[i]!)) return i
    return -1
  })

  const cursor = () => rows()[selected()]
  /** The selected match — a folded heading answers with the first it hides. */
  const current = () => matches()[cursor()?.at ?? -1]

  const move = (step: number) => {
    const all = rows()
    if (all.length === 0) return
    let at = selected()
    for (let n = 0; n < all.length; n++) {
      at = (at + step + all.length) % all.length
      if (selectable(all[at]!)) break
    }
    setIndex(at)
  }

  const toggleFold = () => {
    const row = cursor()
    if (!row) return
    const path = row.kind === 'file' ? row.path : row.match.path
    const folding = !folded().has(path)
    setFolded(prev => {
      const next = new Set(prev)
      if (folding) next.add(path)
      else next.delete(path)
      return next
    })
    // The rows just moved under the selection: folding takes its matches away, so
    // land on the heading that now stands for them, and unfolding gives them back.
    const heading = rows().findIndex(row => row.kind === 'file' && row.path === path)
    if (heading >= 0) setIndex(folding ? heading : heading + 1)
  }

  /**
   * The widest of the modals, and deliberately so: every other one shows short
   * labels, while this one shows lines of source that mean nothing truncated.
   */
  const width = () => modalWidth(dimensions().width, 0.86, 64, 160)
  /** Inside the border *and* the padding — miss either and every long row wraps. */
  const contentWidth = () => width() - 2 - PAD * 2

  /**
   * The text that would take each hit's place, or '' when nothing would. Every row
   * shows it beside the hit as it is typed, so the result is visible before anything
   * is written — which is the whole reason to look at the list before pressing Enter.
   */
  const swap = () => (replacing() ? replacement() : '')

  /** Surroundings of the selected match, or null when there is no room to show them. */
  const preview = createMemo<Context | null>(() => {
    const match = current()
    if (!match || dimensions().height < 18) return null
    return props.scope === 'project'
      ? contextAround(match.path, match.line, CONTEXT)
      : contextIn(props.activeContent, match.line, CONTEXT)
  })

  /**
   * Rows the list may use. Named apart from `modal.ts`'s `listRows` on purpose: this
   * one has a preview to make room for. The panel has to fit a short terminal, and
   * the list gives way before the preview does — a preview of nothing is useless,
   * but a list of two rows is still a list.
   */
  const resultRows = () => {
    const chrome =
      7 + topInset(dimensions().height) + (replacing() ? 1 : 0) + (preview() ? CONTEXT * 2 + 2 : 0)
    return Math.max(2, Math.min(18, dimensions().height - chrome))
  }

  /** The window of rows on screen, kept over the selected row. */
  // Lead 2: one row of lead-in, so the file heading above the selection stays visible.
  const windowed = createMemo(() => windowAround(rows(), selected(), resultRows(), 2))

  /** Ctrl+C / Ctrl+W / Ctrl+R flips an option; the results recompute from scratch. */
  const toggleOption = (name: keyof SearchOptions) => {
    setOptions(prev => ({ ...prev, [name]: !prev[name] }))
    setIndex(0)
    setFolded(new Set<string>())
  }
  const OPTION_KEYS: Partial<Record<string, keyof SearchOptions>> = {
    c: 'caseSensitive',
    w: 'wholeWord',
    r: 'regex',
  }

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    const option = key.ctrl ? OPTION_KEYS[k] : undefined
    if (option) {
      key.preventDefault()
      toggleOption(option)
    } else if (k === 'up') {
      key.preventDefault()
      move(-1)
    } else if (k === 'down') {
      key.preventDefault()
      move(1)
    } else if (k === 'tab' && props.onReplaceAll) {
      key.preventDefault()
      setReplacing(r => !r)
      // Tab is the replace toggle wherever replacing is offered, so folding only
      // takes it in project search — which is also the only scope with headings.
    } else if (k === 'tab' && props.scope === 'project') {
      key.preventDefault()
      toggleFold()
    } else if (key.ctrl && k === 'a' && replacing() && props.onReplaceAll) {
      key.preventDefault()
      props.onReplaceAll(query(), replacement(), options())
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      // A heading is only ever selected while folded, where Enter is the way back in.
      if (cursor()?.kind === 'file') return toggleFold()
      const match = current()
      if (!match) return
      // Replacing one match at a time is the point of the mode; the whole file goes
      // through Ctrl+A, which is the harder move to make by accident.
      if (replacing() && props.onReplaceOne) props.onReplaceOne(match, replacement())
      else props.onPick(match)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onClose()
    }
  })

  /** The active toggles, said the way the footer names them. */
  const flags = () => {
    const on = options()
    const parts = [on.caseSensitive && 'case', on.wholeWord && 'word', on.regex && 'regex']
    const active = parts.filter(Boolean)
    return active.length > 0 ? ` · ${active.join(' ')}` : ''
  }

  const summary = () => {
    if (query().length < MIN_QUERY) return `Type at least 2 characters${flags()}`
    // Say so rather than showing the previous query's count as if it were current.
    if (pending()) return `Searching…${flags()}`
    if (options().regex && !buildQuery(scanned(), options())) return `Invalid regex${flags()}`
    const all = matches()
    if (all.length === 0) return `No matches${flags()}`
    const files = new Set(all.map(m => m.path)).size
    const capped = all.length >= 200 ? '+' : ''
    const where = props.scope === 'project' ? ` in ${files} file${files === 1 ? '' : 's'}` : ''
    return `${(cursor()?.at ?? 0) + 1} of ${all.length}${capped}${where}${flags()}`
  }

  const label = (path: string) => relative(props.rootDir, path) || basename(path)

  /**
   * The line, cut to `room` around the match rather than from column 0. A hit 200
   * columns into a minified line was simply not in the old fixed 38-column slice, so
   * the row showed the query's own result without the query in it.
   */
  const sliceAround = (text: string, col: number, room: number) => {
    if (text.length <= room) return { text, col, cut: false }
    const start = Math.max(0, Math.min(col - 12, text.length - room))
    return { text: text.slice(start, start + room), col: col - start, cut: start > 0 }
  }

  return (
    <ModalPanel
      zIndex={150}
      align="top"
      width={width()}
      title={props.scope === 'project' ? ' Search in project ' : ' Search in file '}
    >
      <TextInput value={query()} placeholder="Search…" onInput={type} />
      <Show when={replacing()}>
        <TextInput value={replacement()} placeholder="Replace with…" onInput={setReplacement} />
      </Show>
      <text fg={ui.dim} bg={ui.panelBg} content={summary()} />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />

      <For each={windowed().rows}>
        {(row, i) => {
          const at = () => windowed().start + i()
          const active = () => at() === selected()

          if (row.kind === 'file') {
            const bg = () => (active() ? ui.treeSelectedBg : ui.solidBarBg)
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <text
                  fg={ui.folder}
                  bg={bg()}
                  flexShrink={0}
                  content={`${row.folded ? '▸' : '▾'} ${label(row.path)} `}
                  attributes={TextAttributes.BOLD}
                />
                {/* Spacer first, so the count lands on the right edge. */}
                <box flexGrow={1} backgroundColor={bg()} />
                <text
                  fg={active() ? ui.accent : ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={`${row.count} match${row.count === 1 ? '' : 'es'} `}
                />
              </box>
            )
          }

          const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
          const gutter = () => `${row.match.line + 1}`.padStart(5)
          // Room left after the marker (1), the line number and its gap (7) and the
          // cut marker (1). One column over and the row wraps onto a second line —
          // and the replacement shown beside the hit takes its share of it too.
          const cut = () =>
            sliceAround(row.match.text, row.match.col, contentWidth() - 9 - swap().length)
          const head = () => cut().text.slice(0, cut().col)
          const hit = () => cut().text.slice(cut().col, cut().col + row.match.length)
          const tail = () => cut().text.slice(cut().col + row.match.length)

          return (
            <box flexDirection="row" backgroundColor={bg()}>
              <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌' : ' '} />
              <text
                fg={active() ? ui.accent : ui.faint}
                bg={bg()}
                flexShrink={0}
                content={`${gutter()}  `}
              />
              <text fg={ui.dim} bg={bg()} flexShrink={0} content={cut().cut ? '…' : ''} />
              <text fg={active() ? ui.text : ui.dim} bg={bg()} flexShrink={0} content={head()} />
              {/* The hit itself, so the eye lands on why the row is here — struck
                    through once there is a replacement to put in its place. */}
              <text
                fg={swap() ? ui.gitDeleted : ui.accent}
                bg={bg()}
                flexShrink={0}
                content={hit()}
                attributes={swap() ? TextAttributes.STRIKETHROUGH : TextAttributes.BOLD}
              />
              <Show when={swap()}>
                <text
                  fg={ui.gitAdded}
                  bg={bg()}
                  flexShrink={0}
                  content={swap()}
                  attributes={TextAttributes.BOLD}
                />
              </Show>
              <box flexGrow={1} backgroundColor={bg()}>
                <text fg={active() ? ui.text : ui.dim} bg={bg()} content={tail()} />
              </box>
            </box>
          )
        }}
      </For>

      <Show when={preview()}>
        {(around: () => Context) => (
          <box flexDirection="column" backgroundColor={ui.solidBg} marginTop={1}>
            <For each={around().lines}>
              {(line, i) => {
                const at = () => around().start + i()
                const isMatch = () => at() === current()?.line
                return (
                  <box
                    flexDirection="row"
                    backgroundColor={isMatch() ? ui.currentLine : ui.solidBg}
                  >
                    <text
                      fg={ui.gutter}
                      bg={isMatch() ? ui.currentLine : ui.solidBg}
                      flexShrink={0}
                      content={`${`${at() + 1}`.padStart(5)} `}
                    />
                    <box flexGrow={1} backgroundColor={isMatch() ? ui.currentLine : ui.solidBg}>
                      {/* The selected line carries the same before/after as its row
                            above it, or the two would disagree about what the file is
                            about to say. */}
                      <Show
                        when={isMatch() && swap() && current()}
                        fallback={
                          <text
                            fg={isMatch() ? ui.text : ui.faint}
                            bg={isMatch() ? ui.currentLine : ui.solidBg}
                            content={line.slice(0, contentWidth() - 6)}
                          />
                        }
                      >
                        {(match: () => Match) => (
                          <box flexDirection="row" backgroundColor={ui.currentLine}>
                            <text
                              fg={ui.text}
                              bg={ui.currentLine}
                              flexShrink={0}
                              content={line.slice(0, match().col)}
                            />
                            <text
                              fg={ui.gitDeleted}
                              bg={ui.currentLine}
                              flexShrink={0}
                              content={line.slice(match().col, match().col + match().length)}
                              attributes={TextAttributes.STRIKETHROUGH}
                            />
                            <text
                              fg={ui.gitAdded}
                              bg={ui.currentLine}
                              flexShrink={0}
                              content={swap()}
                              attributes={TextAttributes.BOLD}
                            />
                            <box flexGrow={1} backgroundColor={ui.currentLine}>
                              <text
                                fg={ui.text}
                                bg={ui.currentLine}
                                content={line.slice(match().col + match().length)}
                              />
                            </box>
                          </box>
                        )}
                      </Show>
                    </box>
                  </box>
                )
              }}
            </For>
          </box>
        )}
      </Show>

      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={
          props.onReplaceAll
            ? replacing()
              ? '↑↓ move · Enter replace · Ctrl+A replace all · Tab back · Esc close'
              : '↑↓ move · Enter jump · Tab replace · Ctrl+C/W/R case/word/regex · Esc close'
            : '↑↓ move · Enter jump · Tab fold · Ctrl+C/W/R case/word/regex · Esc close'
        }
      />
    </ModalPanel>
  )
}
