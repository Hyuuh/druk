import { useTerminalDimensions } from '@opentui/solid'
import { For } from 'solid-js'

import { ui } from '../themes'
import { modalWidth, PAD } from './modal'
import { Overlay } from './Overlay'

export const ROWS: [string, string][] = [
  ['Ctrl+P', 'Command palette (+ themes)'],
  ['Ctrl+O', 'Open file (fuzzy)'],
  ['Ctrl+S', 'Save file'],
  ['Ctrl+G', 'Go to line'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+C', 'Copy selection — quits if none'],
  ['Ctrl+X / Ctrl+V', 'Cut / paste'],
  ['Ctrl+F', 'Find in file (Tab to replace)'],
  ['Enter / Ctrl+A', 'Replace this match / all (in replace)'],
  ['Ctrl+R', 'Find in project'],
  ['Ctrl+N', 'New file'],
  ['Ctrl+Opt+N', 'New folder'],
  ['Ctrl+W', 'Close tab'],
  ['Ctrl+Q', 'Quit'],
  ['Ctrl+Opt+← / →', 'Previous / next tab'],
  ['Ctrl+T', 'Switch to open tab'],
  ['Ctrl+B', 'Show / hide sidebar'],
  ['[ / ]', 'Narrow / widen sidebar (in tree)'],
  ['Tab', 'Tree → editor · indent in editor'],
  ['Shift+Tab', 'Outdent'],
  ['Esc', 'Editor → tree'],
  ['x / c / p', 'Cut / copy / paste here (in tree)'],
  ['drag', 'Drop a file on a folder to move it'],
  ['↑ / ↓', 'Move in tree / popup'],
  ['Shift+↑ / ↓', 'Select a range (in tree)'],
  ['→ / ←', 'Expand / collapse folder'],
  ['Enter', 'Open file / toggle folder'],
  ['a / A', 'New file / folder (in tree)'],
  ['r / d', 'Rename / delete (in tree)'],
  ['Mouse', 'Click tabs, tree rows, editor'],
]

export function HelpOverlay() {
  const dimensions = useTerminalDimensions()
  const width = () => modalWidth(dimensions().width, 0.52, 58, 84)

  return (
    <Overlay zIndex={200}>
      <box
        width={width()}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title=" Keyboard shortcuts "
        titleColor={ui.text}
        paddingLeft={PAD}
        paddingRight={PAD}
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={ROWS}>
          {([key, desc]) => (
            <box flexDirection="row">
              <box width={20} flexShrink={0}>
                <text fg={ui.accent} bg={ui.panelBg} content={key} />
              </box>
              <box flexGrow={1}>
                <text fg={ui.text} bg={ui.panelBg} content={desc} />
              </box>
            </box>
          )}
        </For>
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <text fg={ui.dim} bg={ui.panelBg} content="Press Esc to close" />
      </box>
    </Overlay>
  )
}
