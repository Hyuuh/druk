import { basename, relative } from 'node:path'

import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import type { Match } from '../core/search'
import { searchProject, searchText } from '../core/search'
import { ui } from '../themes'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export type SearchScope = 'file' | 'project'

export interface SearchPanelProps {
  scope: SearchScope
  rootDir: string
  activePath: string | null
  activeContent: string
  onPick: (match: Match) => void
  /** Replace every match in the open file. Absent for project-wide search. */
  onReplaceAll?: (query: string, replacement: string) => void
  onClose: () => void
}

const VISIBLE_ROWS = 10
const MIN_QUERY = 2

export function SearchPanel(props: SearchPanelProps) {
  const [query, setQuery] = createSignal('')
  const [replacement, setReplacement] = createSignal('')
  const [replacing, setReplacing] = createSignal(false)
  const [index, setIndex] = createSignal(0)

  const matches = createMemo(() => {
    const q = query()
    if (q.length < MIN_QUERY) return []
    return props.scope === 'project'
      ? searchProject(props.rootDir, q)
      : searchText(props.activeContent, q, props.activePath ?? '')
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))
  const windowed = createMemo(() => {
    const start = Math.max(
      0,
      Math.min(selected() - VISIBLE_ROWS + 1, matches().length - VISIBLE_ROWS),
    )
    return { start, rows: matches().slice(start, start + VISIBLE_ROWS) }
  })

  useKeyboard((key: KeyEvent) => {
    const k = key.name
    const count = Math.max(1, matches().length)
    if (k === 'up') {
      key.preventDefault()
      setIndex(i => (i - 1 + count) % count)
    } else if (k === 'down') {
      key.preventDefault()
      setIndex(i => (i + 1) % count)
    } else if (k === 'tab' && props.onReplaceAll) {
      key.preventDefault()
      setReplacing(r => !r)
    } else if (k === 'return' || k === 'enter') {
      key.preventDefault()
      if (replacing() && props.onReplaceAll) {
        props.onReplaceAll(query(), replacement())
        return
      }
      const match = matches()[selected()]
      if (match) props.onPick(match)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onClose()
    }
  })

  const summary = () => {
    if (query().length < MIN_QUERY) return 'Type at least 2 characters'
    if (matches().length === 0) return 'No matches'
    return `${selected() + 1} of ${matches().length}${matches().length >= 200 ? '+' : ''}`
  }

  return (
    <Overlay zIndex={150}>
      <box
        width={76}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={props.scope === 'project' ? ' Search in project ' : ' Search in file '}
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
      >
        <TextInput
          value={query()}
          placeholder="Search…"
          onInput={v => {
            setQuery(v)
            setIndex(0)
          }}
        />
        <Show when={replacing()}>
          <TextInput value={replacement()} placeholder="Replace with…" onInput={setReplacement} />
        </Show>
        <text fg={ui.dim} bg={ui.panelBg} content={summary()} />
        <For each={windowed().rows}>
          {(match, i) => {
            const active = () => windowed().start + i() === selected()
            const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
            const where =
              props.scope === 'project'
                ? `${relative(props.rootDir, match.path) || basename(match.path)}:${match.line + 1}`
                : `${match.line + 1}:${match.col + 1}`
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <box width={props.scope === 'project' ? 34 : 10}>
                  <text fg={active() ? ui.accent : ui.dim} bg={bg()} content={` ${where}`} />
                </box>
                <text
                  fg={active() ? ui.text : ui.dim}
                  bg={bg()}
                  content={match.text.trim().slice(0, 38)}
                />
              </box>
            )
          }}
        </For>
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content={
            props.onReplaceAll
              ? replacing()
                ? '↑↓ move · Enter replace all · Tab back to search · Esc close'
                : '↑↓ move · Enter jump · Tab replace · Esc close'
              : '↑↓ move · Enter jump · Esc close'
          }
        />
      </box>
    </Overlay>
  )
}
