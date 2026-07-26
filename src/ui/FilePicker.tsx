import { relative } from 'node:path'

import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import { fuzzyScore, listFiles } from '../core/search'
import { ui } from '../themes'
import { Overlay } from './Overlay'
import { TextInput } from './TextInput'

export interface FilePickerProps {
  rootDir: string
  showHidden: boolean
  /** Candidates to choose from. Defaults to every file in the project. */
  files?: string[]
  title?: string
  /** How a candidate is shown and matched. Defaults to its project-relative path. */
  display?: (value: string) => string
  onPick: (path: string) => void
  onClose: () => void
}

const VISIBLE_ROWS = 12

export function FilePicker(props: FilePickerProps) {
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)

  // Scanned once per open: a project's file list does not move under you mid-search.
  const files = props.files ?? listFiles(props.rootDir, 5000, props.showHidden)

  const label = (value: string) => props.display?.(value) ?? relative(props.rootDir, value)

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { path: string; score: number }[] = []
    for (const path of files) {
      const score = fuzzyScore(label(path), q)
      if (score !== null) scored.push({ path, score })
    }
    return scored.toSorted((a, b) => a.score - b.score).slice(0, VISIBLE_ROWS)
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

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
      if (match) props.onPick(match.path)
    } else if (k === 'escape') {
      key.preventDefault()
      props.onClose()
    }
  })

  return (
    <Overlay zIndex={150}>
      <box
        width={72}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={` ${props.title ?? 'Open file'} — ${files.length} `}
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
      >
        <TextInput
          value={query()}
          placeholder="Type part of a path…"
          onInput={v => {
            setQuery(v)
            setIndex(0)
          }}
        />
        <Show
          when={matches().length > 0}
          fallback={<text fg={ui.dim} bg={ui.panelBg} content=" No matches" />}
        >
          <For each={matches()}>
            {(match, i) => {
              const active = () => i() === selected()
              const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
              return (
                <text
                  fg={active() ? ui.text : ui.dim}
                  bg={bg()}
                  content={` ${label(match.path).slice(0, 68)}`}
                />
              )
            }}
          </For>
        </Show>
        <text fg={ui.dim} bg={ui.panelBg} content="↑↓ move · Enter open · Esc close" />
      </box>
    </Overlay>
  )
}
