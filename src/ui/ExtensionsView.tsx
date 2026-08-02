import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { SettingEditor } from './SettingEditor'
import type { SettingEdit } from './SettingEditor'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

export interface ExtensionRow {
  /** Heading the row is grouped under; consecutive rows share one heading. */
  section: string
  label: string
  /** Dim text after the label — what it contributes, or what the market says. */
  detail?: string
  /** Drawn right-aligned: a version, a state, a setting's value. */
  value: string
  /** Enter. A row may hand back a free-text edit, the way a setting's does. */
  activate?: () => void | SettingEdit
  /** Backspace — offered only where there is something to delete. */
  remove?: () => void
  /**
   * Drawn only once the filter holds text. The market is dozens of entries the
   * user did not ask for, and listing them buries what is installed — so it is
   * reached by searching for it, not by scrolling past it.
   */
  searchOnly?: boolean
  /** Drawn only while the filter is empty, and Enter opens the filter. */
  startSearch?: boolean
}

export interface ExtensionsViewProps {
  rows: ExtensionRow[]
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
 * The extensions page: takes the editor's place while open, one row per
 * extension. What each row does belongs to the controller that built it, so this
 * component owns nothing but the selection and the keyboard — the same division
 * `SettingsView` keeps.
 */
export function ExtensionsView(props: ExtensionsViewProps) {
  const dimensions = useTerminalDimensions()
  const [index, setIndex] = createSignal(0)
  /** The text field floating over the page, for a row whose activate edits text. */
  const [editing, setEditing] = createSignal<SettingEdit | null>(null)
  /** The filter field above the rows; absent until `/` opens it. */
  const [searching, setSearching] = createSignal(false)
  const [query, setQuery] = createSignal('')

  /** Rows the filter leaves, in page order — sorting by score would scramble the sections. */
  const rows = createMemo(() => {
    const q = query().trim()
    if (!q) return props.rows.filter(row => !row.searchOnly)
    return props.rows.filter(
      row =>
        !row.startSearch &&
        fuzzyScore(`${row.section} ${row.label} ${row.detail ?? ''}`, q) !== null,
    )
  })

  const selected = () => Math.min(index(), Math.max(0, rows().length - 1))

  const activate = (row: ExtensionRow) => {
    if (row.startSearch) {
      setSearching(true)
      setIndex(0)
      return
    }
    const edit = row.activate?.()
    if (edit) setEditing(edit)
  }

  useKeys((key: KeyEvent) => {
    // A page, not a modal: keys count only when this pane holds the focus, and
    // a chord the global keymap already claimed is not ours to reuse.
    if (props.blocked || !props.focused || key.defaultPrevented || editing()) return
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
      } else if (k === 'escape') {
        setSearching(false)
        setQuery('')
        setIndex(0)
      } else return
      key.preventDefault()
      return
    }
    if (k === 'up' || k === 'k') setIndex((selected() - 1 + count) % count)
    else if (k === 'down' || k === 'j') setIndex((selected() + 1) % count)
    else if (k === 'home') setIndex(0)
    else if (k === 'end') setIndex(count - 1)
    else if (k === 'backspace' || k === 'delete') {
      const remove = rows()[selected()]?.remove
      if (!remove) return
      remove()
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
   * above it, so the window is measured in drawn rows, not extensions — and it
   * has to be measured at all: overflowing the column pushes the title bar off
   * the top of the page instead of scrolling, which reads as the page being
   * broken.
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

  const title = () => ' Extensions'

  /**
   * A market blurb or an extensions folder is longer than any pane, and an
   * unclamped one wraps — which in a flex row pushes the value column down onto
   * lines of its own and reads as the page being broken. Cut instead.
   */
  const detail = (row: ExtensionRow) => {
    if (!row.detail) return ''
    const room = props.width - row.label.length - row.value.length - 8
    if (room < 8) return ''
    if (row.detail.length <= room) return row.detail
    // A path's tail is the part worth reading, a blurb's head is; the detail
    // says which by starting with `~` or `/`.
    return /^[~/]/.test(row.detail)
      ? `…${row.detail.slice(row.detail.length - room + 1)}`
      : `${row.detail.slice(0, room - 1)}…`
  }

  /** Long spelling when the pane can afford it, initials beside a sidebar. */
  const hints = () => {
    const uninstall = rows()[selected()]?.remove ? ' · Bksp uninstall' : ''
    const full = searching()
      ? ' ↑↓ move · Enter choose · Esc filter off '
      : ` ↑↓ move · Enter choose${uninstall} · / filter · Esc close `
    if (full.length + title().length + 2 <= props.width) return full
    return searching() ? ' ↑↓ · Enter · Esc ' : ' ↑↓ · Enter · / · Esc '
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
            <TextInput
              value={query()}
              placeholder="Filter extensions…"
              onInput={value => {
                setQuery(value)
                setIndex(0)
                setTop(0)
              }}
            />
          </box>
        </box>
        <text fg={ui.solidBg} bg={ui.solidBg} content="" />
      </Show>

      <Show when={rows().length === 0}>
        <text fg={ui.dim} bg={ui.solidBg} content="  No matching extensions" />
      </Show>

      <For each={visible().rows}>
        {(row, at) => {
          const i = () => visible().start + at()
          const active = () => i() === selected()
          const bg = () => (active() ? ui.treeSelectedBg : ui.solidBg)
          return (
            <>
              <Show when={heading(i())}>
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
                <text
                  fg={active() ? ui.text : ui.dim}
                  bg={bg()}
                  flexShrink={0}
                  content={row.label}
                />
                <Show when={detail(row)}>
                  <text fg={ui.faint} bg={bg()} flexShrink={0} content={`  ${detail(row)}`} />
                </Show>
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

      <Show when={editing()} keyed>
        {(edit: SettingEdit) => (
          <SettingEditor
            edit={edit}
            paneWidth={props.width}
            onDone={values => {
              // Close first: applying rebuilds the rows, and a keyed accessor
              // read after that tears the modal down mid-handler.
              setEditing(null)
              if (values !== null) edit.apply(values)
            }}
          />
        )}
      </Show>
    </box>
  )
}
