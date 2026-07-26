import { For } from 'solid-js'

import { ui } from '../themes'
import { Overlay } from './Overlay'

const ROWS: [string, string][] = [
  ['Ctrl+P', 'Command palette (+ themes)'],
  ['Ctrl+O', 'Open file (fuzzy)'],
  ['Ctrl+S', 'Save file'],
  ['Ctrl+G', 'Go to line'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+D', 'Add cursor at next match'],
  ['Ctrl+C / X / V', 'Copy / cut / paste'],
  ['Ctrl+F', 'Find in file (Tab to replace)'],
  ['Ctrl+Shift+F', 'Find in project'],
  ['Ctrl+N', 'New file'],
  ['Ctrl+Shift+N', 'New folder'],
  ['Ctrl+W', 'Close tab'],
  ['Ctrl+Q', 'Quit'],
  ['Ctrl+Opt+← / →', 'Previous / next tab'],
  ['Ctrl+T', 'Switch to open tab'],
  ['Ctrl+B', 'Show / hide sidebar'],
  ['Tab / Esc', 'Focus editor / tree'],
  ['↑ / ↓', 'Move in tree / popup'],
  ['→ / ←', 'Expand / collapse folder'],
  ['Enter', 'Open file / toggle folder'],
  ['a / A', 'New file / folder (in tree)'],
  ['r / d', 'Rename / delete (in tree)'],
  ['Mouse', 'Click tabs, tree rows, editor'],
]

export function HelpOverlay() {
  return (
    <Overlay zIndex={200}>
      <box
        width={54}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title=" Keyboard shortcuts "
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={ROWS}>
          {([key, desc]) => (
            <box flexDirection="row">
              <box width={18}>
                <text fg={ui.accent} bg={ui.panelBg} content={key} />
              </box>
              <text fg={ui.text} bg={ui.panelBg} content={desc} />
            </box>
          )}
        </For>
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <text fg={ui.dim} bg={ui.panelBg} content="Press Esc to close" />
      </box>
    </Overlay>
  )
}
