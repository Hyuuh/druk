import { Show } from 'solid-js'

import type { ComparisonCommitDetail, ComparisonContent, ComparisonFile } from '../core/git'
import { ui } from '../themes'
import { ComparisonBinaryView } from './ComparisonBinaryView'
import { DiffView } from './DiffView'
import type { DiffMode } from './DiffView'

export interface CommitViewProps {
  detail: ComparisonCommitDetail
  file: ComparisonFile | null
  content: ComparisonContent | null
  mode: DiffMode
  width: number
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onMoveFile: (delta: number) => void
  onToggleMode: () => void
  onClose: () => void
}

export function CommitView(props: CommitViewProps) {
  const commit = () => props.detail.commit

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={ui.bg}>
      <box height={3} flexDirection="column" backgroundColor={ui.barBg} paddingLeft={1}>
        <text fg={ui.text} bg={ui.barBg} content={`${commit().shortOid} ${commit().subject}`} />
        <text
          fg={ui.dim}
          bg={ui.barBg}
          content={`${commit().authorName} <${commit().authorEmail}> · ${commit().authoredAt}`}
        />
        <text
          fg={ui.faint}
          bg={ui.barBg}
          content={`${props.detail.stats.files} files · ${commit().parents.length} parent${commit().parents.length === 1 ? '' : 's'} · ↑↓ files`}
        />
      </box>
      <box flexGrow={1} flexDirection="column">
        <Show
          when={props.file && props.content}
          fallback={<text fg={ui.dim} bg={ui.bg} content="  loading commit diff…" />}
        >
          <Show
            when={props.content?.binary === false}
            fallback={
              <ComparisonBinaryView
                file={props.file!}
                focused={props.focused}
                blocked={props.blocked}
                onFocus={props.onFocus}
                onClose={props.onClose}
              />
            }
          >
            <DiffView
              file={{
                path: props.file!.path,
                rel: props.file!.path,
                oldPath: props.file!.oldPath,
                status: props.file!.status,
                oldText: props.content && !props.content.binary ? props.content.oldText : '',
                newText: props.content && !props.content.binary ? props.content.newText : '',
              }}
              mode={props.mode}
              width={props.width}
              focused={props.focused}
              blocked={props.blocked}
              onFocus={props.onFocus}
              onMoveFile={props.onMoveFile}
              onToggleMode={props.onToggleMode}
              onClose={props.onClose}
            />
          </Show>
        </Show>
      </box>
    </box>
  )
}
