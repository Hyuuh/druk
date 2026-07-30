import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { listRows, modalWidth, PAD } from './modal'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

/** A free-text edit floating over the page — the values no list can hold. */
export interface SettingEdit {
  title: string
  /** What the field opens holding — the value in force, or '' when adding. */
  initial: string
  placeholder?: string
  /**
   * Lines under the field, explaining the syntax the value has to be in. Worth
   * spelling out here rather than in docs: this field *is* the documentation for
   * anything the page cannot offer as a list of values.
   */
  hint?: string[]
  apply: (value: string) => void
}

export interface SettingRow {
  /** Heading the row is grouped under; consecutive rows share one heading. */
  section: string
  label: string
  /** Current value, drawn right-aligned. */
  value: string
  /** Step the setting: → is 1, ← is -1. Two-state settings flip either way. */
  cycle: (dir: 1 | -1) => void
  /**
   * When set, Enter opens a filterable list of every value instead of stepping.
   * A pick may hand back a `SettingEdit` to type into — that is how list rows
   * (formatters, server commands) chain into free text.
   */
  select?: { options: string[]; pick: (index: number) => void | SettingEdit }
  /** When set, Enter opens this edit directly. Takes precedence over `select`. */
  edit?: SettingEdit
}

export interface SettingsViewProps {
  rows: SettingRow[]
  /** Where changes persist, shown at the foot of the page. */
  configFile: string
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  /** The page shares the editor's focus slot; unfocused, its keys stay dead. */
  focused: boolean
  /** A modal above the page owns the keys — this pane's handler runs first. */
  blocked: boolean
  onFocus: () => void
  onClose: () => void
}

/**
 * The settings page: takes the editor's place while open, one row per setting.
 * Every change applies immediately and persists through the row's own `cycle`,
 * so this component owns nothing but the selection and the keyboard.
 */
export function SettingsView(props: SettingsViewProps) {
  const dimensions = useTerminalDimensions()
  const [index, setIndex] = createSignal(0)
  /** The value list floating over the page, for the selected row's `select`. */
  const [picking, setPicking] = createSignal(false)
  /** The text field floating over the page, for a row's (or a pick's) `edit`. */
  const [editing, setEditing] = createSignal<SettingEdit | null>(null)
  /** The filter field above the rows; absent until `/` opens it. */
  const [searching, setSearching] = createSignal(false)
  const [query, setQuery] = createSignal('')

  /** Rows the filter leaves, in page order — sorting by score would scramble the sections. */
  const rows = createMemo(() => {
    const q = query().trim()
    if (!q) return props.rows
    return props.rows.filter(row => fuzzyScore(`${row.section} ${row.label}`, q) !== null)
  })

  const selected = () => Math.min(index(), Math.max(0, rows().length - 1))
  const selectedRow = () => rows()[selected()]

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
    setIndex(0)
  }

  /** Enter's meaning: open the row's edit or list when it has one, step otherwise. */
  const activate = (row: SettingRow) => {
    if (row.edit) setEditing(row.edit)
    else if (row.select) setPicking(true)
    else row.cycle(1)
  }

  useKeyboard((key: KeyEvent) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse. The value
    // list owns the keyboard while open — j/k must type into its filter.
    if (props.blocked || !props.focused || key.defaultPrevented || picking() || editing()) return
    const k = key.name
    const count = Math.max(1, rows().length)
    // While the filter field is up every printable key belongs to it — only the
    // keys it has no use for are still the page's, and Esc backs out of the
    // filter before it closes the page.
    if (searching()) {
      if (k === 'up') setIndex((selected() - 1 + count) % count)
      else if (k === 'down') setIndex((selected() + 1) % count)
      else if (k === 'return' || k === 'enter') {
        const row = rows()[selected()]
        if (row) activate(row)
      } else if (k === 'escape') closeSearch()
      else return
      key.preventDefault()
      return
    }
    if (k === 'up' || k === 'k') setIndex((selected() - 1 + count) % count)
    else if (k === 'down' || k === 'j') setIndex((selected() + 1) % count)
    else if (k === 'home') setIndex(0)
    else if (k === 'end') setIndex(count - 1)
    else if (k === 'left' || k === 'h') rows()[selected()]?.cycle(-1)
    else if (k === 'right' || k === 'l') rows()[selected()]?.cycle(1)
    // Ctrl+F is the global file search, so the filter takes the vim-ish key
    // instead — the page has no text to search anyway.
    else if (!key.ctrl && (k === '/' || key.sequence === '/')) {
      setSearching(true)
      setIndex(0)
    } else if (k === 'return' || k === 'enter' || k === 'space') {
      const row = rows()[selected()]
      if (row) activate(row)
    } else if (k === 'escape' || k === 'q') props.onClose()
    else return
    key.preventDefault()
  })

  /**
   * Rows the page can draw. A section heading costs its own row plus a blank one
   * above it, so the window is measured in drawn rows, not settings — and it has
   * to be measured at all: overflowing the column pushes the title bar off the
   * top of the page instead of scrolling, which reads as the page being broken.
   */
  const heading = (at: number) => at === 0 || rows()[at - 1]!.section !== rows()[at]!.section
  const cost = (at: number) => (heading(at) ? (at > 0 ? 3 : 2) : 1)
  /** The filter field and its blank line cost two more rows when it is up. */
  const budget = () => Math.max(3, dimensions().height - 4 - (searching() ? 2 : 0))

  /** First row on screen; moves only when the selection leaves the window. */
  const [top, setTop] = createSignal(0)

  /** How many rows starting at `from` fit in `budget`, at least one. */
  const fits = (from: number) => {
    let drawn = 0
    let count = 0
    while (from + count < rows().length && drawn + cost(from + count) <= budget()) {
      drawn += cost(from + count)
      count += 1
    }
    return Math.max(1, count)
  }

  createEffect(() => {
    const at = selected()
    setTop(previous => {
      if (at < previous) return at
      // Walk the window's start down until the selection is inside it: with
      // variable row heights there is no arithmetic for this.
      let start = previous
      while (start < at && start + fits(start) <= at) start += 1
      return start
    })
  })

  const visible = createMemo(() => {
    const start = Math.min(top(), Math.max(0, rows().length - 1))
    return { start, rows: rows().slice(start, start + fits(start)) }
  })

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    const full = searching()
      ? ' ↑↓ move · Enter change · Esc filter off '
      : ' ↑↓ move · ←→ change · / filter · Esc close '
    if (full.length + 12 <= props.width) return full
    return searching() ? ' ↑↓ · Enter · Esc ' : ' ↑↓ · ←→ · / · Esc '
  }

  /** Path cut from the left to what the row can spare; the tail identifies it. */
  const footer = () => {
    let path = props.configFile
    const room = Math.max(8, props.width - 2)
    if (path.length > room) path = `…${path.slice(path.length - room + 1)}`
    return ` ${path}`
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" backgroundColor={ui.solidBarBg}>
        <text fg={ui.text} bg={ui.solidBarBg} flexShrink={0} content=" Settings" />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} content={hints()} />
      </box>

      <Show when={searching()}>
        <box flexDirection="row" backgroundColor={ui.solidBg} paddingLeft={2} paddingRight={2}>
          <box flexGrow={1}>
            {/* Two focused inputs would split the typing between them, so while
                the value list is up the field is drawn as plain text. */}
            <Show
              when={!picking()}
              fallback={
                <text
                  fg={query() ? ui.text : ui.faint}
                  bg={ui.solidBg}
                  content={query() || 'Filter settings…'}
                />
              }
            >
              <TextInput
                value={query()}
                placeholder="Filter settings…"
                onInput={value => {
                  setQuery(value)
                  setIndex(0)
                  setTop(0)
                }}
              />
            </Show>
          </box>
        </box>
        <text fg={ui.solidBg} bg={ui.solidBg} content="" />
      </Show>

      <Show when={rows().length === 0}>
        <text fg={ui.dim} bg={ui.solidBg} content="  No matching settings" />
      </Show>

      <For each={visible().rows}>
        {(row, at) => {
          const i = () => visible().start + at()
          const active = () => i() === selected()
          const bg = () => (active() ? ui.treeSelectedBg : ui.solidBg)
          const showHeading = () => heading(i())
          return (
            <>
              <Show when={showHeading()}>
                <Show when={i() > 0}>
                  <text fg={ui.solidBg} bg={ui.solidBg} content="" />
                </Show>
                <text fg={ui.faint} bg={ui.solidBg} content={`  ${row.section}`} />
              </Show>
              <box
                flexDirection="row"
                backgroundColor={bg()}
                onMouseDown={() => {
                  props.onFocus()
                  if (active()) activate(row)
                  else setIndex(i())
                }}
              >
                <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                <text fg={active() ? ui.text : ui.dim} bg={bg()} content={row.label} />
                <box flexGrow={1} backgroundColor={bg()} />
                <text
                  fg={active() ? ui.accent : ui.text}
                  bg={bg()}
                  flexShrink={0}
                  content={row.value}
                />
                <text fg={bg()} bg={bg()} flexShrink={0} content=" " />
              </box>
            </>
          )
        }}
      </For>

      <box flexGrow={1} backgroundColor={ui.solidBg} />
      <text fg={ui.faint} bg={ui.solidBg} content={footer()} />

      <Show when={picking()}>
        <SettingPicker
          title={selectedRow()?.label ?? ''}
          options={selectedRow()?.select?.options ?? []}
          activeIndex={(selectedRow()?.select?.options ?? []).indexOf(selectedRow()?.value ?? '')}
          paneWidth={props.width}
          onPick={at => {
            // Close first: picking rebuilds the rows, and a keyed accessor read
            // after that tears the popup down mid-handler ("stale read").
            setPicking(false)
            const edit = selectedRow()?.select?.pick(at)
            if (edit) setEditing(edit)
          }}
          onClose={() => setPicking(false)}
        />
      </Show>

      <Show when={editing()} keyed>
        {(edit: SettingEdit) => (
          <SettingEditor
            edit={edit}
            paneWidth={props.width}
            onDone={value => {
              // Close first, as the picker does: applying rebuilds the rows.
              setEditing(null)
              if (value !== null) edit.apply(value)
            }}
          />
        )}
      </Show>
    </box>
  )
}

/** One text field over the page: Enter applies what it holds, Esc walks away. */
function SettingEditor(props: {
  edit: SettingEdit
  /** The overlay is confined to the settings pane, so the modal sizes to it. */
  paneWidth: number
  /** The typed value, or null for Esc. */
  onDone: (value: string | null) => void
}) {
  const [value, setValue] = createSignal(props.edit.initial)
  const width = () => modalWidth(props.paneWidth, 0.7, 30, 60)

  useKeyboard((key: KeyEvent) => {
    if (key.defaultPrevented) return
    const k = key.name
    if (k === 'return' || k === 'enter') {
      key.preventDefault()
      props.onDone(value())
    } else if (k === 'escape') {
      key.preventDefault()
      props.onDone(null)
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
        title={` ${props.edit.title} `}
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <TextInput value={value()} placeholder={props.edit.placeholder} onInput={setValue} />
        <text fg={ui.panelBg} bg={ui.panelBg} content="" />
        <For each={props.edit.hint ?? []}>
          {line => <text fg={ui.faint} bg={ui.panelBg} content={line} />}
        </For>
        <text fg={ui.dim} bg={ui.panelBg} content="Enter apply · Esc cancel" />
      </box>
    </Overlay>
  )
}

/**
 * Fuzzy pick between a setting's values — the long lists (26 themes) that ←→
 * would take a dozen presses to cross. The value in force starts selected, so
 * a bare Enter keeps things as they are.
 */
function SettingPicker(props: {
  title: string
  options: string[]
  /** Index of the value in force, marked and selected first. */
  activeIndex: number
  /** The overlay is confined to the settings pane, so the modal sizes to it. */
  paneWidth: number
  onPick: (index: number) => void
  onClose: () => void
}) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(Math.max(0, props.activeIndex))

  const width = () => modalWidth(props.paneWidth, 0.7, 30, 60)
  const visibleRows = () => listRows(dimensions().height, 8, 18)

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { at: number; score: number }[] = []
    for (let at = 0; at < props.options.length; at++) {
      const score = fuzzyScore(props.options[at]!, q)
      if (score !== null) scored.push({ at, score })
    }
    return scored.toSorted((a, b) => a.score - b.score)
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

  /** First row shown: slides so the selection stays inside the window. */
  const windowStart = () => Math.max(0, selected() - visibleRows() + 1)

  useKeyboard((key: KeyEvent) => {
    if (key.defaultPrevented) return
    const k = key.name
    const count = Math.max(1, matches().length)
    if (k === 'up') {
      key.preventDefault()
      setIndex((selected() - 1 + count) % count)
    } else if (k === 'down') {
      key.preventDefault()
      setIndex((selected() + 1) % count)
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
        title={` ${props.title} `}
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <TextInput
          value={query()}
          placeholder="Type to filter…"
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
          <For each={matches().slice(windowStart(), windowStart() + visibleRows())}>
            {(match, i) => {
              const active = () => windowStart() + i() === selected()
              const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
              return (
                <box flexDirection="row" backgroundColor={bg()}>
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                  <text
                    fg={match.at === props.activeIndex ? ui.accent : active() ? ui.text : ui.dim}
                    bg={bg()}
                    content={props.options[match.at]!.slice(0, width() - PAD * 2 - 2)}
                  />
                  <box flexGrow={1} backgroundColor={bg()} />
                </box>
              )
            }}
          </For>
        </Show>
        <text fg={ui.dim} bg={ui.panelBg} content="↑↓ move · Enter pick · Esc back" />
      </box>
    </Overlay>
  )
}
