import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, createSignal, For, Show } from 'solid-js'

import type { Branch } from '../core/git'
import { fuzzyScore } from '../core/search'
import { ui } from '../themes'
import { useListKeys } from './list'
import { listRows, modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { TextInput } from './TextInput'

export interface BranchPickerProps {
  title: string
  branches: Branch[]
  onPick: (branch: Branch) => void
  onClose: () => void
}

/** Pick a branch — to switch to, branch off, merge, rename or delete. */
export function BranchPicker(props: BranchPickerProps) {
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal('')
  const [index, setIndex] = createSignal(0)

  const width = () => modalWidth(dimensions().width, 0.62, 60, 100)
  const visibleRows = () => listRows(dimensions().height, 8, 18)

  const matches = createMemo(() => {
    const q = query().trim()
    const scored: { branch: Branch; score: number }[] = []
    for (const branch of props.branches) {
      const score = fuzzyScore(branch.name, q)
      if (score !== null) scored.push({ branch, score })
    }
    // Ties keep git's own order, which is most-recently-committed first.
    return scored.toSorted((a, b) => a.score - b.score).slice(0, visibleRows())
  })

  const selected = () => Math.min(index(), Math.max(0, matches().length - 1))

  useListKeys({
    count: () => matches().length,
    move: setIndex,
    pick: () => {
      const match = matches()[selected()]
      if (match) props.onPick(match.branch)
    },
    close: () => props.onClose(),
  })

  return (
    <ModalPanel zIndex={150} width={width()} title={` ${props.title} — ${props.branches.length} `}>
      <TextInput
        value={query()}
        placeholder="Type part of a branch name…"
        onInput={v => {
          setQuery(v)
          setIndex(0)
        }}
      />
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      {/* Fixed height for the same reason as the file picker: a list that shrinks
            with every keystroke moves the input field being typed in. */}
      <box flexDirection="column" height={visibleRows()}>
        <Show
          when={matches().length > 0}
          fallback={<text fg={ui.dim} bg={ui.panelBg} content="No matches" />}
        >
          <For each={matches()}>
            {(match, i) => {
              const branch = match.branch
              const active = () => i() === selected()
              const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
              /** The name is what is picked; everything else has to give way. */
              const name = () => branch.name.slice(0, Math.max(8, width() - PAD * 2 - 24))
              const note = () => (branch.remote ? 'remote' : (branch.upstream ?? ''))
              return (
                <box flexDirection="row" backgroundColor={bg()}>
                  <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌ ' : '  '} />
                  <text
                    fg={ui.accent}
                    bg={bg()}
                    flexShrink={0}
                    content={branch.current ? '* ' : '  '}
                  />
                  <box flexGrow={1} backgroundColor={bg()}>
                    <text
                      wrapMode="none"
                      fg={active() ? ui.text : ui.dim}
                      bg={bg()}
                      content={name()}
                    />
                  </box>
                  <text fg={ui.faint} bg={bg()} flexShrink={0} content={note()} />
                </box>
              )
            }}
          </For>
        </Show>
      </box>
      <text fg={ui.dim} bg={ui.panelBg} content="↑↓ move · Enter pick · Esc cancel" />
    </ModalPanel>
  )
}
