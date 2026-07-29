import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Show } from 'solid-js'

import { ui } from '../themes'
import { welcomeKeys } from './keys'

/** Terminal rows the tabs, status bar and the block's own header take, so the
 * key list can be trimmed to what is left instead of overflowing the pane. */
const CHROME_ROWS = 8

export interface WelcomeProps {
  /** Folder druk was opened in, as the tree titles it. */
  rootName: string
  branch: string | null
  version: string
}

/**
 * The empty editor. Keys come from `keys.ts` so a rebinding cannot leave this
 * screen advertising the old chord, and the key column is padded to a common
 * width — every row is its own centred text renderable, so without the padding
 * the columns stagger.
 */
export function Welcome(props: WelcomeProps) {
  const dimensions = useTerminalDimensions()
  const rows = createMemo(() => {
    const all = welcomeKeys()
    const room = Math.max(0, dimensions().height - CHROME_ROWS)
    const width = Math.max(...all.map(([key]) => key.length))
    return all.slice(0, room).map(([key, label]) => [key.padEnd(width), label] as const)
  })

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={ui.bg}
      alignItems="center"
      justifyContent="center"
    >
      {/* One left-aligned block, centred as a whole: centring each row on its own
          is what made the key column stagger. */}
      <box flexDirection="column" backgroundColor={ui.bg} alignItems="flex-start">
        <text
          fg={ui.accent}
          bg={ui.bg}
          content={`druk v${props.version}`}
          attributes={TextAttributes.BOLD}
        />
        <text
          fg={ui.dim}
          bg={ui.bg}
          content={props.branch ? `${props.rootName} · ${props.branch}` : props.rootName}
        />
        <Show when={rows().length > 0}>
          <text fg={ui.faint} bg={ui.bg} content="" />
          <For each={rows()}>
            {([key, label]) => (
              <box flexDirection="row" backgroundColor={ui.bg}>
                <text fg={ui.dim} bg={ui.bg} content={`${key}  `} />
                <text fg={ui.faint} bg={ui.bg} content={label} />
              </box>
            )}
          </For>
        </Show>
      </box>
    </box>
  )
}
