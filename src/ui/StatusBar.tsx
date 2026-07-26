import { TextAttributes } from '@opentui/core'
import { Show } from 'solid-js'

import { MODE_LABELS } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import { ui } from '../themes'

/** How loudly a status message asks to be read. */
export type Tone = 'info' | 'warn' | 'error'

export interface StatusBarProps {
  message: string
  tone: Tone
  filetype?: string
  cursor?: { line: number; col: number }
  dirty: boolean
  vimMode: VimMode | null
  branch: string | null
  /** Commits the branch is ahead of / behind its upstream. */
  ahead: number
  behind: number
  /** Files differing from HEAD in the working tree. */
  changed: number
}

// `dirty` is the palette's amber, already meaning "needs attention, nothing broke".
const TONE_COLORS: Record<Tone, () => string> = {
  info: () => ui.dim,
  warn: () => ui.dirty,
  error: () => ui.error,
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
        <text fg={TONE_COLORS[props.tone]()} bg={ui.barBg} content={props.message} />
      </box>

      <Show when={props.changed > 0}>
        <box paddingRight={2}>
          <text fg={ui.gitModified} bg={ui.barBg} content={`~${props.changed}`} />
        </box>
      </Show>
      <Show when={props.branch}>
        {(branch: () => string) => (
          <box flexDirection="row" paddingRight={2}>
            <text fg={ui.dim} bg={ui.barBg} content={`⎇ ${branch()}`} />
            <Show when={props.ahead > 0}>
              <text fg={ui.gitAdded} bg={ui.barBg} content={` ↑${props.ahead}`} />
            </Show>
            <Show when={props.behind > 0}>
              <text fg={ui.gitModified} bg={ui.barBg} content={` ↓${props.behind}`} />
            </Show>
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
