import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'

import type { ChangeRow, DirRow, FileRow } from '../core/changeTree'
import { ui } from '../themes'
import { MARKS, statusColor } from './FileTree'

/** `Show`'s `when` takes a value, not a predicate: these hand it the narrowed row
 * (or nothing) so the block inside needs no cast. */
const dirRow = (row: ChangeRow) => (row.kind === 'dir' ? row : undefined)
const fileRow = (row: ChangeRow) => (row.kind === 'file' ? row : undefined)

const glyph = (dir: DirRow) => (dir.collapsed ? '▸ ' : '▾ ')

export interface GitPanelProps {
  branch: string | null
  /** Commits ahead of / behind the upstream, for the header. */
  ahead: number
  behind: number
  /** Every row the panel draws — folder rows included in tree view. */
  rows: ChangeRow[]
  /** Branch the list is against, or null for HEAD and the working tree. */
  base: string | null
  /** Row under the cursor; may point past the end after a commit shrinks the list. */
  cursor: number
  focused: boolean
  width: number
  inRepo: boolean
  onFocus: () => void
  /** A row clicked: move the cursor there, and diff it or fold it. */
  onActivate: (index: number) => void
}

/**
 * The sidebar's source-control view — VS Code's left-hand git panel, sized down:
 * the changed files under the branch, the cursor paging the diff page beside it,
 * `c` to commit, `p` to push. Keys are handled in `app/keyboard.ts` beside the
 * tree's, so this renders and reports clicks, nothing more.
 */
export function GitPanel(props: GitPanelProps) {
  const dimensions = useTerminalDimensions()

  const cursor = () => Math.max(0, Math.min(props.cursor, props.rows.length - 1))

  // Header (2) + hint line (1) + sidebar tabs (1) + tabs/status chrome (3).
  const pageRows = () => Math.max(3, dimensions().height - 7)

  /**
   * First row on screen. Change lists are usually shorter than the panel, but
   * `git status` after a big refactor is not, and a cursor below the fold reads
   * as no cursor at all.
   */
  const [top, setTop] = createSignal(0)

  // The window moves only when the cursor leaves it, as the tree's scrollbox does.
  // Deriving the start from the cursor alone instead scrolls on every keypress,
  // pinning the selected row to the bottom of the panel.
  createEffect(() => {
    const rows = pageRows()
    const at = cursor()
    const total = props.rows.length
    setTop(previous => {
      const start = Math.max(0, Math.min(previous, total - rows))
      if (at < start) return at
      if (at >= start + rows) return at - rows + 1
      return start
    })
  })

  const visible = createMemo(() => props.rows.slice(top(), top() + pageRows()))

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
      flexGrow={1}
      flexBasis={0}
      onMouseDown={() => props.onFocus()}
    >
      <box height={2} flexDirection="column" backgroundColor={ui.panelBg} paddingLeft={2}>
        <text
          fg={props.focused ? ui.text : ui.dim}
          bg={ui.panelBg}
          content={headline()}
          attributes={TextAttributes.BOLD}
        />
        {/* The base has to be said somewhere: against another branch every file
            it touches is marked, which reads as a broken tree until you know why. */}
        <text
          fg={props.base ? ui.accent : ui.faint}
          bg={ui.panelBg}
          content={props.base ? `vs ${props.base}` : 'source control'}
        />
      </box>
      <Show
        when={props.inRepo && props.rows.length > 0}
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
          <For each={visible()}>
            {(row, at) => {
              const index = () => top() + at()
              const selected = () => index() === cursor()
              const bg = () =>
                selected() ? (props.focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.panelBg
              return (
                <box
                  height={1}
                  flexDirection="row"
                  backgroundColor={bg()}
                  // Deliberately not stopped: the panel's own handler runs after
                  // this one and focuses it, which is where the keyboard belongs —
                  // the arrows page the diff from here.
                  onMouseDown={() => props.onActivate(index())}
                >
                  {/* Indent and glyph never give, as in the tree: shrinking them
                      slid every row's marks a column left. The name is the only
                      thing allowed to give. */}
                  <text
                    fg={ui.faint}
                    bg={bg()}
                    flexShrink={0}
                    content={` ${'│ '.repeat(row.depth)}`}
                  />
                  {/* `when` narrows the union for the block below it — the two
                      row kinds share no fields past `depth` and `label`. */}
                  <Show when={dirRow(row)}>
                    {(dir: () => DirRow) => (
                      <text fg={ui.dim} bg={bg()} flexShrink={0} content={glyph(dir())} />
                    )}
                  </Show>
                  <box flexGrow={1} flexDirection="row" backgroundColor={bg()}>
                    <text
                      fg={row.kind === 'dir' ? ui.folder : ui.text}
                      bg={bg()}
                      content={row.kind === 'dir' ? row.label : ` ${row.label}`}
                      attributes={row.kind === 'dir' ? TextAttributes.BOLD : undefined}
                    />
                  </box>
                  {/* A folded folder says how many changes it is hiding, so the row
                      still carries its files' worth of information while it is shut. */}
                  <Show when={dirRow(row)}>
                    {(dir: () => DirRow) => (
                      <text
                        fg={ui.faint}
                        bg={bg()}
                        flexShrink={0}
                        content={dir().collapsed ? `${dir().files} ` : ' '}
                      />
                    )}
                  </Show>
                  <Show when={fileRow(row)}>
                    {(file: () => FileRow) => (
                      <text
                        fg={statusColor(file().change.status)}
                        bg={bg()}
                        flexShrink={0}
                        content={`${MARKS[file().change.status]} `}
                      />
                    )}
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
      <Show when={props.inRepo}>
        <box height={1} backgroundColor={ui.panelBg} paddingLeft={1}>
          <text
            fg={ui.faint}
            bg={ui.panelBg}
            content="↑↓ diff · →← fold · c commit · p push · B compare"
          />
        </box>
      </Show>
    </box>
  )
}
