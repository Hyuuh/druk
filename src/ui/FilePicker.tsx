import { relative } from 'node:path'

import type { KeyEvent } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import { fuzzyScore, listFiles } from '../core/search'
import { ui } from '../themes'
import { listRows, modalWidth, PAD } from './modal'
import { Overlay, topInset } from './Overlay'
import { TextInput } from './TextInput'

export interface FilePickerProps {
  rootDir: string
  /** Candidates to choose from. Defaults to every file in the project. */
  files?: string[]
  title?: string
  onPick: (path: string) => void
  onClose: () => void
}

export function FilePicker(props: FilePickerProps) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(dimensions().width, 0.62, 72, 110)
  /** Border, input, blank line and footer. */
  const visibleRows = () => listRows(dimensions().height - topInset(dimensions().height), 8, 18)

  // Scanned once per open: a project's file list does not move under you mid-search.
  const files = props.files ?? listFiles(props.rootDir, 5000)

  const label = (value: string) => relative(props.rootDir, value)

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { path: string; score: number }[] = []
    for (const path of files) {
      const score = fuzzyScore(label(path), q)
      if (score !== null) scored.push({ path, score })
    }
    return scored.toSorted((a, b) => a.score - b.score).slice(0, visibleRows())
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
    <Overlay zIndex={150} align="top">
      <box
        width={width()}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title={` ${props.title ?? 'Open file'} — ${files.length} `}
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
      >
        <TextInput
          value={query()}
          placeholder="Type part of a path…"
          onInput={v => {
            setQuery(v)
            setIndex(0)
          }}
        />
        <text fg={ui.panelBg} bg={ui.panelBg} content="" />
        {/* Fixed height, not content height: the panel is centered, so a list that
            shrinks with every keystroke moves the input field the user is typing in. */}
        <box flexDirection="column" height={visibleRows()}>
          <Show
            when={matches().length > 0}
            fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matches" />}
          >
            <For each={matches()}>
              {(match, i) => {
                const active = () => i() === selected()
                const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
                /** The name reads first; the folders it sits in are context. */
                const shown = () => label(match.path).slice(0, width() - PAD * 2 - 4)
                const cut = () => shown().lastIndexOf('/') + 1
                return (
                  <box flexDirection="row" backgroundColor={bg()}>
                    <text
                      fg={ui.accent}
                      bg={bg()}
                      flexShrink={0}
                      content={active() ? '▌ ' : '  '}
                    />
                    {/* Only when there is a folder: an empty <text> still occupies
                        one column, which shifted root-level files a cell right. */}
                    <Show when={cut() > 0}>
                      <text
                        fg={ui.faint}
                        bg={bg()}
                        flexShrink={0}
                        content={shown().slice(0, cut())}
                      />
                    </Show>
                    <box flexGrow={1} backgroundColor={bg()}>
                      <text
                        fg={active() ? ui.text : ui.dim}
                        bg={bg()}
                        content={shown().slice(cut())}
                      />
                    </box>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
        <text fg={ui.dim} bg={ui.panelBg} content="↑↓ move · Enter open · Esc close" />
      </box>
    </Overlay>
  )
}
