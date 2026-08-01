import { homedir } from 'node:os'

import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import type { ConfigScope } from '../core/config'
import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

/** One input inside an edit. A lone field needs no label; several do. */
export interface SettingField {
  label?: string
  /** What the field opens holding — the value in force, or '' when adding. */
  initial: string
  placeholder?: string
}

/** A free-text edit floating over the page — the values no list can hold. */
export interface SettingEdit {
  title: string
  /** Drawn top to bottom; Tab moves between them, and `apply` gets them in order. */
  fields: SettingField[]
  /**
   * Lines under the fields, explaining what the values have to be. Worth
   * spelling out here rather than in docs: this modal *is* the documentation for
   * anything the page cannot offer as a list of values.
   */
  hint?: string[]
  apply: (values: string[]) => void
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
  select?: {
    options: string[]
    pick: (index: number) => void | SettingEdit
    /** Paint a value while the selection sits on it — used by the theme rows. */
    preview?: (index: number) => void
    /** Put back what the config says, once the list is gone. */
    restore?: () => void
  }
  /** When set, Enter opens this edit directly. Takes precedence over `select`. */
  edit?: SettingEdit
  /** The project's own settings file is what supplies this value. */
  local?: boolean
  /** Drop that project override — offered only where there is one to drop. */
  clear?: () => void
}

export interface SettingsViewProps {
  rows: SettingRow[]
  /** Which file the rows show and changes are written to. */
  scope: ConfigScope
  onToggleScope: () => void
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

  useKeys((key: KeyEvent) => {
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
    // The global keymap hands Tab to whatever holds the editor slot, so it is
    // this page's to spend on the thing it has two of: files to write.
    else if (k === 'tab') props.onToggleScope()
    else if (k === 'backspace' || k === 'delete') {
      const clear = rows()[selected()]?.clear
      if (!clear) return
      clear()
    }
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

  /** Which of the two files is on show — the page is otherwise identical. */
  const title = () => ` Settings — ${props.scope === 'project' ? 'Project' : 'User'}`

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    const reset = selectedRow()?.clear ? ' · Bksp reset' : ''
    const full = searching()
      ? ' ↑↓ move · Enter change · Esc filter off '
      : ` ↑↓ move · ←→ change · Tab scope${reset} · / filter · Esc close `
    if (full.length + title().length + 2 <= props.width) return full
    return searching() ? ' ↑↓ · Enter · Esc ' : ' ↑↓ · ←→ · Tab · / · Esc '
  }

  /**
   * The file the changes land in, plus what the ◆ rows mean — which is not the
   * same thing in the two scopes: here it is "set in this file", on the user's
   * page it is "and the project overrides it anyway".
   */
  const footer = () => {
    const marked = props.rows.some(row => row.local)
    const legend = !marked
      ? ''
      : props.scope === 'project'
        ? ' · ◆ set here'
        : ' · ◆ set by project'
    // `~` first: a home-relative path is what the user would type, and cutting
    // the front off an absolute one leaves the unreadable middle of a temp dir.
    const home = homedir()
    let path =
      home && props.configFile.startsWith(`${home}/`)
        ? `~${props.configFile.slice(home.length)}`
        : props.configFile
    const room = Math.max(8, props.width - 2 - legend.length)
    if (path.length > room) path = `…${path.slice(path.length - room + 1)}`
    return ` ${path}${legend}`
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
        <text fg={ui.text} bg={ui.solidBarBg} flexShrink={0} content={title()} />
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
                <Show when={row.local}>
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content="◆ " />
                </Show>
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
        {(() => {
          const row = selectedRow()
          return (
            <SettingPicker
              title={row?.label ?? ''}
              options={row?.select?.options ?? []}
              activeIndex={(row?.select?.options ?? []).indexOf(row?.value ?? '')}
              paneWidth={props.width}
              onPick={at => {
                // Close first: picking rebuilds the rows, and a keyed accessor read
                // after that tears the popup down mid-handler ("stale read").
                setPicking(false)
                const edit = row?.select?.pick(at)
                if (edit) setEditing(edit)
              }}
              onClose={() => setPicking(false)}
              onPreview={row?.select?.preview}
              onRestore={row?.select?.restore}
            />
          )
        })()}
      </Show>

      <Show when={editing()} keyed>
        {(edit: SettingEdit) => (
          <SettingEditor
            edit={edit}
            paneWidth={props.width}
            onDone={values => {
              // Close first, as the picker does: applying rebuilds the rows.
              setEditing(null)
              if (values !== null) edit.apply(values)
            }}
          />
        )}
      </Show>
    </box>
  )
}

/** A form over the page: Enter applies what the fields hold, Esc walks away. */
function SettingEditor(props: {
  edit: SettingEdit
  /** The overlay is confined to the settings pane, so the modal sizes to it. */
  paneWidth: number
  /** The typed values, in field order, or null for Esc. */
  onDone: (values: string[] | null) => void
}) {
  const [values, setValues] = createSignal(props.edit.fields.map(field => field.initial))
  const [focus, setFocus] = createSignal(0)
  const width = () => modalWidth(props.paneWidth, 0.7, 30, 60)
  const count = () => props.edit.fields.length

  useKeys((key: KeyEvent) => {
    if (key.defaultPrevented) return
    const k = key.name
    if (k === 'return' || k === 'enter') {
      key.preventDefault()
      props.onDone(values())
    } else if (k === 'escape') {
      key.preventDefault()
      props.onDone(null)
    } else if (count() > 1 && (k === 'tab' || k === 'up' || k === 'down')) {
      key.preventDefault()
      const dir = k === 'up' || (k === 'tab' && key.shift) ? -1 : 1
      setFocus(at => (at + dir + count()) % count())
    }
  })

  const setField = (at: number, value: string) =>
    setValues(previous => previous.map((old, i) => (i === at ? value : old)))

  return (
    <ModalPanel zIndex={150} width={width()} title={` ${props.edit.title} `}>
      <For each={props.edit.fields}>
        {(field, at) => (
          <>
            <Show when={field.label}>
              <text
                fg={at() === focus() ? ui.text : ui.dim}
                bg={ui.panelBg}
                content={field.label!}
              />
            </Show>
            {/* Two focused inputs would split the typing between them, so the
                  field without the cursor is drawn as plain text. */}
            <Show
              when={at() === focus()}
              fallback={
                <text
                  fg={values()[at()] ? ui.dim : ui.faint}
                  bg={ui.panelBg}
                  content={values()[at()] || field.placeholder || ''}
                />
              }
            >
              <TextInput
                value={values()[at()]!}
                placeholder={field.placeholder}
                onInput={value => setField(at(), value)}
              />
            </Show>
          </>
        )}
      </For>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <For each={props.edit.hint ?? []}>
        {line => <text fg={ui.faint} bg={ui.panelBg} content={line} />}
      </For>
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={
          count() > 1 ? 'Tab next field · Enter apply · Esc cancel' : 'Enter apply · Esc cancel'
        }
      />
    </ModalPanel>
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
  onPreview?: (index: number) => void
  onRestore?: () => void
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

  let lastPreviewed: number | undefined
  createEffect(() => {
    const match = matches()[selected()]
    if (match && props.onPreview && match.at !== lastPreviewed) {
      lastPreviewed = match.at
      props.onPreview(match.at)
    }
  })

  // On the way out, not on Escape: `onPick` closes the list before it applies the
  // value, so the restore lands first and a pick that paints nothing itself — the
  // light and dark theme rows, which only take effect when the OS appearance
  // flips — is left showing the theme in force rather than the one it previewed.
  onCleanup(() => props.onRestore?.())

  /** First row shown: slides so the selection stays inside the window. */
  const windowStart = () => Math.max(0, selected() - visibleRows() + 1)

  useKeys((key: KeyEvent) => {
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
    } else if (k === 'escape' || k === 'left') {
      key.preventDefault()
      props.onClose()
    }
  })

  return (
    <ModalPanel zIndex={150} width={width()} title={` ${props.title} `}>
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
    </ModalPanel>
  )
}
