import type { KeyEvent } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

/**
 * Fuzzy pick between a setting's values — the long lists (26 themes) that ←→
 * would take a dozen presses to cross. The value in force starts selected, so
 * a bare Enter keeps things as they are.
 */
export function SettingPicker(props: {
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
