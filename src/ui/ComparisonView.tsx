import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { Show } from 'solid-js'
import type { Accessor } from 'solid-js'

import type { ComparisonCommitDetail, ComparisonContent, ComparisonFile } from '../core/git'
import { ui } from '../themes'
import { DiffView, diffStatusColor } from './DiffView'
import type { DiffMode } from './DiffView'

export interface ComparisonViewProps {
  /** Null for a commit whose first-parent diff is empty — a merge, most often. */
  file: ComparisonFile | null
  /** Null while the blobs are still being read — the row opened first. */
  content: ComparisonContent | null
  /** Set when the file is one of a commit's, which adds its header and pager. */
  commit: ComparisonCommitDetail | null
  mode: DiffMode
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  focused: boolean
  /** A modal above the page owns the keys — this pane's handler runs first. */
  blocked: boolean
  onFocus: () => void
  onMoveFile: (delta: number) => void
  onToggleMode: () => void
  onClose: () => void
}

/**
 * A file from a branch comparison, over the editor slot. One page whichever way
 * the row was reached: a commit adds a header above the diff and makes ←/→ page
 * through its files, and anything with no diff to draw — binary, still loading,
 * a commit that changed nothing — becomes a message in the same frame.
 */
export function ComparisonView(props: ComparisonViewProps) {
  /** The one case `DiffView` can draw, and the one it owns the keyboard for. */
  const text = () => (props.content?.binary === false ? props.content : null)

  useKeyboard((key: KeyEvent) => {
    if (props.blocked || !props.focused || key.defaultPrevented || text()) return
    if (props.commit && (key.name === 'left' || key.name === 'right')) {
      props.onMoveFile(key.name === 'left' ? -1 : 1)
    } else if (key.name === 'escape' || key.name === 'q') {
      props.onClose()
    } else return
    key.preventDefault()
  })

  const fileHeader = (file: ComparisonFile) =>
    `${file.status} ${file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}`

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={props.onFocus}
    >
      <Show when={props.commit}>
        {(detail: Accessor<ComparisonCommitDetail>) => {
          const commit = () => detail().commit
          const parents = () => commit().parents.length
          return (
            <box height={3} flexDirection="column" backgroundColor={ui.solidBarBg} paddingLeft={1}>
              <text
                fg={ui.text}
                bg={ui.solidBarBg}
                content={`${commit().shortOid} ${commit().subject}`}
              />
              <text
                fg={ui.dim}
                bg={ui.solidBarBg}
                content={`${commit().authorName} <${commit().authorEmail}> · ${commit().authoredAt}`}
              />
              <text
                fg={ui.faint}
                bg={ui.solidBarBg}
                content={`${detail().stats.files} files · ${parents()} parent${parents() === 1 ? '' : 's'} · ←→ files · Esc back`}
              />
            </box>
          )
        }}
      </Show>
      <Show when={props.file} fallback={<Message title="No file changes in this commit." />}>
        {(file: Accessor<ComparisonFile>) => (
          <Show
            when={text()}
            fallback={
              <box flexGrow={1} flexDirection="column" backgroundColor={ui.solidBg}>
                <box backgroundColor={ui.solidBarBg} paddingLeft={1}>
                  <text
                    fg={diffStatusColor(file().status)}
                    bg={ui.solidBarBg}
                    content={fileHeader(file())}
                  />
                </box>
                <Show when={props.content} fallback={<Message title="Loading the diff…" />}>
                  <Message title="Binary file" detail="A textual diff is not available." />
                </Show>
              </box>
            }
          >
            {(content: Accessor<{ oldText: string; newText: string }>) => (
              <DiffView
                file={{
                  path: file().path,
                  rel: file().path,
                  oldPath: file().oldPath,
                  status: file().status,
                  oldText: content().oldText,
                  newText: content().newText,
                }}
                mode={props.mode}
                width={props.width}
                focused={props.focused}
                blocked={props.blocked}
                onFocus={props.onFocus}
                onMoveFile={props.commit ? props.onMoveFile : undefined}
                onToggleMode={props.onToggleMode}
                onClose={props.onClose}
              />
            )}
          </Show>
        )}
      </Show>
    </box>
  )
}

function Message(props: { title: string; detail?: string }) {
  return (
    <box flexGrow={1} flexDirection="column" backgroundColor={ui.solidBg} padding={2}>
      <text fg={ui.text} bg={ui.solidBg} content={props.title} />
      <Show when={props.detail}>
        {(detail: Accessor<string>) => <text fg={ui.dim} bg={ui.solidBg} content={detail()} />}
      </Show>
      <text fg={ui.faint} bg={ui.solidBg} content="Esc closes this page." />
    </box>
  )
}
