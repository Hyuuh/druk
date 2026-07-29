import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { listRows, modalWidth, PAD } from './modal'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export interface SettingRow {
  /** Heading the row is grouped under; consecutive rows share one heading. */
  section: string
  label: string
  /** Current value, drawn right-aligned. */
  value: string
  /** Step the setting: → is 1, ← is -1. Two-state settings flip either way. */
  cycle: (dir: 1 | -1) => void
  /** When set, Enter opens a filterable list of every value instead of stepping. */
  select?: { options: string[]; pick: (index: number) => void }
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

  const selected = () => Math.min(index(), Math.max(0, props.rows.length - 1))
  const selectedRow = () => props.rows[selected()]

  /** Enter's meaning: open the row's list when it has one, step otherwise. */
  const activate = (row: SettingRow) => {
    if (row.select) setPicking(true)
    else row.cycle(1)
  }

  useKeyboard((key: KeyEvent) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse. The value
    // list owns the keyboard while open — j/k must type into its filter.
    if (props.blocked || !props.focused || key.defaultPrevented || picking()) return
    const k = key.name
    const count = Math.max(1, props.rows.length)
    if (k === 'up' || k === 'k') setIndex((selected() - 1 + count) % count)
    else if (k === 'down' || k === 'j') setIndex((selected() + 1) % count)
    else if (k === 'home') setIndex(0)
    else if (k === 'end') setIndex(count - 1)
    else if (k === 'left' || k === 'h') props.rows[selected()]?.cycle(-1)
    else if (k === 'right' || k === 'l') props.rows[selected()]?.cycle(1)
    else if (k === 'return' || k === 'enter' || k === 'space') {
      const row = props.rows[selected()]
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
  const heading = (at: number) =>
    at === 0 || props.rows[at - 1]!.section !== props.rows[at]!.section
  const cost = (at: number) => (heading(at) ? (at > 0 ? 3 : 2) : 1)
  const budget = () => Math.max(3, dimensions().height - 4)

  /** First row on screen; moves only when the selection leaves the window. */
  const [top, setTop] = createSignal(0)

  /** How many rows starting at `from` fit in `budget`, at least one. */
  const fits = (from: number) => {
    let drawn = 0
    let count = 0
    while (from + count < props.rows.length && drawn + cost(from + count) <= budget()) {
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
    const start = Math.min(top(), Math.max(0, props.rows.length - 1))
    return { start, rows: props.rows.slice(start, start + fits(start)) }
  })

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    const full = ' ↑↓ move · ←→ change · Enter list · Esc close '
    if (full.length + 12 <= props.width) return full
    return ' ↑↓ · ←→ · Esc '
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
      backgroundColor={ui.bg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" backgroundColor={ui.barBg}>
        <text fg={ui.text} bg={ui.barBg} flexShrink={0} content=" Settings" />
        <box flexGrow={1} backgroundColor={ui.barBg} />
        <text fg={ui.dim} bg={ui.barBg} flexShrink={0} content={hints()} />
      </box>

      <For each={visible().rows}>
        {(row, at) => {
          const i = () => visible().start + at()
          const active = () => i() === selected()
          const bg = () => (active() ? ui.treeSelectedBg : ui.bg)
          const showHeading = () => heading(i())
          return (
            <>
              <Show when={showHeading()}>
                <Show when={i() > 0}>
                  <text fg={ui.bg} bg={ui.bg} content="" />
                </Show>
                <text fg={ui.faint} bg={ui.bg} content={`  ${row.section}`} />
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

      <box flexGrow={1} backgroundColor={ui.bg} />
      <text fg={ui.faint} bg={ui.bg} content={footer()} />

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
            selectedRow()?.select?.pick(at)
          }}
          onClose={() => setPicking(false)}
        />
      </Show>
    </box>
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
