import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import type {
  BranchComparison,
  ComparisonCommit,
  ComparisonFileDraft,
  ComparisonFileStatus,
} from '../core/git'
import { ui } from '../themes'
import { statusColor } from './FileTree'

export interface ComparePanelProps {
  state: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  comparison: BranchComparison | null
  files: ComparisonFileDraft[]
  commits: ComparisonCommit[]
  mode: 'files' | 'commits'
  cursor: number
  focused: boolean
  width: number
  error: string
  onFocus: () => void
  onActivate: (index: number) => void
}

const MARKS: Record<ComparisonFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T',
}

const color = (status: ComparisonFileStatus) =>
  status === 'added'
    ? statusColor('added')
    : status === 'deleted'
      ? statusColor('deleted')
      : statusColor('modified')

/** Branch-comparison mode inside the existing source-control sidebar. */
export function ComparePanel(props: ComparePanelProps) {
  const dimensions = useTerminalDimensions()
  const rows = () => (props.mode === 'files' ? props.files : props.commits)
  const cursor = () => Math.max(0, Math.min(props.cursor, rows().length - 1))
  // Sidebar tabs + six header rows + footer + tabs/status chrome.
  const pageRows = () => Math.max(3, dimensions().height - 11)
  const [top, setTop] = createSignal(0)

  createEffect(() => {
    const visible = pageRows()
    const at = cursor()
    const total = rows().length
    setTop(previous => {
      const start = Math.max(0, Math.min(previous, total - visible))
      if (at < start) return at
      if (at >= start + visible) return at - visible + 1
      return start
    })
  })

  const visibleFiles = createMemo(() => props.files.slice(top(), top() + pageRows()))
  const visibleCommits = createMemo(() => props.commits.slice(top(), top() + pageRows()))
  const summary = () => {
    const comparison = props.comparison
    if (!comparison) return `${props.files.length} files`
    const behind = comparison.behind > 0 ? ` ↓${comparison.behind}` : ''
    return `↑${comparison.ahead}${behind} ${comparison.stats.files} files`
  }

  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      flexShrink={0}
      flexGrow={1}
      flexBasis={0}
      onMouseDown={() => props.onFocus()}
    >
      <box height={6} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={2}>
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.panelBg}
          content={props.comparison?.compare.name ?? 'branch comparison'}
          attributes={TextAttributes.BOLD}
        />
        <text fg={ui.faint} bg={ui.panelBg} content="compare" />
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content={`base  ${props.comparison?.base.name ?? 'loading…'}`}
        />
        <text fg={ui.dim} bg={ui.panelBg} content={summary()} />
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content={
            props.comparison
              ? `+${props.comparison.stats.additions} −${props.comparison.stats.deletions}`
              : ''
          }
        />
        <text
          fg={ui.accent}
          bg={ui.panelBg}
          content={props.mode === 'files' ? '[Files]  Commits' : 'Files  [Commits]'}
        />
      </box>
      <Show
        when={rows().length > 0}
        fallback={
          <box flexGrow={1} backgroundColor={ui.panelBg} paddingLeft={2}>
            <text
              fg={ui.faint}
              bg={ui.panelBg}
              content={
                props.state === 'error'
                  ? props.error
                  : props.state === 'loading'
                    ? 'loading comparison…'
                    : 'no differences'
              }
            />
          </box>
        }
      >
        <box flexGrow={1} flexDirection="column" backgroundColor={ui.panelBg}>
          <Show
            when={props.mode === 'files'}
            fallback={
              <For each={visibleCommits()}>
                {(commit, row) => {
                  const index = () => top() + row()
                  const selected = () => index() === cursor()
                  const bg = () =>
                    selected() ? (props.focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg
                  return (
                    <box
                      height={1}
                      flexDirection="row"
                      backgroundColor={bg()}
                      onMouseDown={() => props.onActivate(index())}
                    >
                      <text fg={ui.text} bg={bg()} content={` ${commit.subject}`} flexGrow={1} />
                      <text
                        fg={ui.faint}
                        bg={bg()}
                        content={`${commit.shortOid} `}
                        flexShrink={0}
                      />
                    </box>
                  )
                }}
              </For>
            }
          >
            <For each={visibleFiles()}>
              {(file, row) => {
                const index = () => top() + row()
                const selected = () => index() === cursor()
                const bg = () =>
                  selected() ? (props.focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg
                const totals = () =>
                  file.binary === true
                    ? 'binary'
                    : file.additions === undefined || file.deletions === undefined
                      ? '…'
                      : `+${file.additions} −${file.deletions}`
                return (
                  <box
                    height={1}
                    flexDirection="row"
                    backgroundColor={bg()}
                    onMouseDown={() => props.onActivate(index())}
                  >
                    <text fg={ui.text} bg={bg()} content={` ${file.path}`} flexGrow={1} />
                    <text fg={ui.faint} bg={bg()} content={`${totals()} `} flexShrink={0} />
                    <text
                      fg={color(file.status)}
                      bg={bg()}
                      content={`${MARKS[file.status]} `}
                      flexShrink={0}
                    />
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
      </Show>
      <box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
        <text fg={ui.faint} bg={ui.panelBg} content="↑↓ open · c commits · B base · Esc back" />
      </box>
    </box>
  )
}
