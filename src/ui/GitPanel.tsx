import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Show } from 'solid-js'

import type { FileStatus } from '../core/git'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'

export interface GitChange {
  path: string
  /** Shown to the user; `path` is what git gets. */
  rel: string
  status: FileStatus
}

export interface GitPanelProps {
  branch: string | null
  /** Commits ahead of / behind the upstream, for the header. */
  ahead: number
  behind: number
  changes: GitChange[]
  /** Row under the cursor; may point past the end after a commit shrinks the list. */
  cursor: number
  focused: boolean
  width: number
  inRepo: boolean
  onFocus: () => void
  /** A row clicked: move the cursor there and open its diff. */
  onActivate: (index: number) => void
}

/**
 * The sidebar's source-control view — VS Code's left-hand git panel, sized down:
 * the changed files under the branch, Enter for a diff, `c` to commit, `p` to
 * push. Keys are handled in `app/keyboard.ts` beside the tree's, so this renders
 * and reports clicks, nothing more.
 */
export function GitPanel(props: GitPanelProps) {
  const dimensions = useTerminalDimensions()

  const cursor = () => Math.max(0, Math.min(props.cursor, props.changes.length - 1))

  /**
   * A window over the rows, following the cursor. Change lists are usually
   * shorter than the screen, but `git status` after a big refactor is not —
   * and a cursor below the fold reads as no cursor at all.
   */
  const window = createMemo(() => {
    // Header (2) + hint line (1) + tabs/status chrome (3).
    const rows = Math.max(3, dimensions().height - 6)
    const start = Math.max(0, Math.min(cursor() - rows + 1, props.changes.length - rows))
    return { start, rows: props.changes.slice(start, start + rows) }
  })

  const headline = () => {
    if (!props.inRepo) return 'not a git repository'
    const arrows =
      (props.ahead > 0 ? ` ↑${props.ahead}` : '') + (props.behind > 0 ? ` ↓${props.behind}` : '')
    return `${props.branch ?? 'no branch'}${arrows}`
  }

  return (
    <box
      width={props.width}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      flexShrink={0}
      onMouseDown={() => props.onFocus()}
    >
      <box height={2} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={2}>
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.panelBg}
          content={headline()}
          attributes={TextAttributes.BOLD}
        />
        <text fg={ui.faint} bg={ui.panelBg} content="source control" />
      </box>
      <Show
        when={props.inRepo && props.changes.length > 0}
        fallback={
          <box flexGrow={1} backgroundColor={ui.panelBg} paddingLeft={2}>
            <text
              fg={ui.faint}
              bg={ui.panelBg}
              content={props.inRepo ? 'no changes' : 'open a repository to use git'}
            />
          </box>
        }
      >
        <box flexGrow={1} flexDirection="column" backgroundColor={ui.panelBg}>
          <For each={window().rows}>
            {(change, row) => {
              const index = () => window().start + row()
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
                  {/* The name is the only thing allowed to give, as in the tree:
                      shrinking the mark slid every row's glyphs around. */}
                  <box flexGrow={1} flexDirection="row" backgroundColor={bg()}>
                    <text fg={ui.text} bg={bg()} content={` ${change.rel}`} />
                  </box>
                  <text
                    fg={statusColor(change.status)}
                    bg={bg()}
                    flexShrink={0}
                    content={`${MARKS[change.status]} `}
                  />
                </box>
              )
            }}
          </For>
        </box>
      </Show>
      <Show when={props.inRepo}>
        <box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
          <text fg={ui.faint} bg={ui.panelBg} content="enter diff · c commit · p push" />
        </box>
      </Show>
    </box>
  )
}
