import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Show } from 'solid-js'

import type { BranchComparison, ComparisonCommit, ComparisonFile } from '../core/git'
import { ui } from '../themes'
import { diffMark, diffStatusColor } from './DiffView'
import { createPanelWindow, rowBg } from './list'

export interface ComparePanelProps {
  state: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  comparison: BranchComparison | null
  files: ComparisonFile[]
  commits: ComparisonCommit[]
  mode: 'files' | 'commits'
  cursor: number
  focused: boolean
  width: number
  error: string
  onFocus: () => void
  onActivate: (index: number) => void
}

/** Branch-comparison mode inside the existing source-control sidebar. */
export function ComparePanel(props: ComparePanelProps) {
  const dimensions = useTerminalDimensions()
  const rows = () => (props.mode === 'files' ? props.files : props.commits)
  const cursor = () => Math.max(0, Math.min(props.cursor, rows().length - 1))
  // Sidebar tabs + five header rows + footer + tabs/status chrome.
  const pageRows = () => Math.max(3, dimensions().height - 10)
  const top = createPanelWindow(cursor, () => rows().length, pageRows)

  // One window over whichever list is showing: slicing both meant the hidden one
  // was re-sliced on every cursor move for nothing.
  const visibleFiles = createMemo(() =>
    props.mode === 'files' ? props.files.slice(top(), top() + pageRows()) : [],
  )
  const visibleCommits = createMemo(() =>
    props.mode === 'commits' ? props.commits.slice(top(), top() + pageRows()) : [],
  )
  const summary = () => {
    const comparison = props.comparison
    if (!comparison) return ''
    const behind = comparison.behind > 0 ? ` ↓${comparison.behind}` : ''
    const { files, additions, deletions } = comparison.stats
    return `↑${comparison.ahead}${behind} · ${files} files · +${additions} −${deletions}`
  }

  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.sidebarBg}
      flexShrink={0}
      flexGrow={1}
      flexBasis={0}
      onMouseDown={() => props.onFocus()}
    >
      <box height={5} flexDirection="column" backgroundColor={ui.sidebarBg} paddingLeft={2}>
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.sidebarBg}
          content={props.comparison?.compare.name ?? 'branch comparison'}
          attributes={TextAttributes.BOLD}
        />
        <text fg={ui.faint} bg={ui.sidebarBg} content="compare" />
        <text
          fg={ui.dim}
          bg={ui.sidebarBg}
          content={`base  ${props.comparison?.base.name ?? 'loading…'}`}
        />
        <text fg={ui.dim} bg={ui.sidebarBg} content={summary()} />
        <text
          fg={ui.accent}
          bg={ui.sidebarBg}
          content={props.mode === 'files' ? '[Files]  Commits' : 'Files  [Commits]'}
        />
      </box>
      <Show
        when={rows().length > 0}
        fallback={
          <box flexGrow={1} backgroundColor={ui.sidebarBg} paddingLeft={2}>
            <text
              fg={ui.faint}
              bg={ui.sidebarBg}
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
        <box flexGrow={1} flexDirection="column" backgroundColor={ui.sidebarBg}>
          <Show
            when={props.mode === 'files'}
            fallback={
              <For each={visibleCommits()}>
                {(commit, row) => {
                  const index = () => top() + row()
                  const bg = () => rowBg(index() === cursor(), props.focused)
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
                const bg = () => rowBg(index() === cursor(), props.focused)
                const totals = () =>
                  file.binary ? 'binary' : `+${file.additions} −${file.deletions}`
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
                      fg={diffStatusColor(file.status)}
                      bg={bg()}
                      content={`${diffMark(file.status)} `}
                      flexShrink={0}
                    />
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
      </Show>
      <box height={1} backgroundColor={ui.sidebarBg} paddingLeft={1}>
        <text
          fg={ui.faint}
          bg={ui.sidebarBg}
          content="↑↓ open · c commits · / filter · B base · Esc"
        />
      </box>
    </box>
  )
}
