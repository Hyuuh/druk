import { TextAttributes } from '@opentui/core'
import { Show } from 'solid-js'

import { MODE_LABELS } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { ui } from '../themes'

export interface StatusBarProps {
  message: string
  isError: boolean
  filetype?: string
  cursor?: { line: number; col: number }
  dirty: boolean
  vimMode: VimMode | null
  branch: string | null
}

export function StatusBar(props: StatusBarProps) {
  return (
    <box height={1} flexDirection="row" backgroundColor={ui.barBg} flexShrink={0}>
      <Show when={props.vimMode}>
        {(mode: () => VimMode) => (
          <box backgroundColor={ui.statusBg} paddingLeft={1} paddingRight={1}>
            <text
              fg={ui.statusFg}
              bg={ui.statusBg}
              content={MODE_LABELS[mode()]}
              attributes={TextAttributes.BOLD}
            />
          </box>
        )}
      </Show>

      <box flexGrow={1} paddingLeft={2}>
        <text fg={props.isError ? ui.error : ui.dim} bg={ui.barBg} content={props.message} />
      </box>

      <Show when={props.branch}>
        {(branch: () => string) => (
          <box paddingRight={2}>
            <text fg={ui.dim} bg={ui.barBg} content={`⎇ ${branch()}`} />
          </box>
        )}
      </Show>
      <Show when={props.dirty}>
        <box paddingRight={2}>
          <text fg={ui.dirty} bg={ui.barBg} content="● unsaved" />
        </box>
      </Show>
      <Show when={props.cursor}>
        {(cursor: () => { line: number; col: number }) => (
          <box paddingRight={2}>
            <text
              fg={ui.dim}
              bg={ui.barBg}
              content={`Ln ${cursor().line + 1}, Col ${cursor().col + 1}`}
            />
          </box>
        )}
      </Show>
      <Show when={props.filetype}>
        {(filetype: () => string) => (
          <box paddingRight={2}>
            <text fg={ui.accent} bg={ui.barBg} content={filetype()} />
          </box>
        )}
      </Show>
    </box>
  )
}
