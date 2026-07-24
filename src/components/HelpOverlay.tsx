import { ui } from '../theme'
import { Overlay } from './Overlay'

const ROWS: Array<[string, string]> = [
  ['Ctrl+P', 'Command palette (+ themes)'],
  ['Ctrl+S', 'Save file'],
  ['Ctrl+N', 'New file'],
  ['Ctrl+Shift+N', 'New folder'],
  ['Ctrl+W', 'Close tab'],
  ['Ctrl+Q', 'Quit'],
  ['Ctrl+B', 'Toggle tree ⇄ editor'],
  ['Ctrl+← / Ctrl+→', 'Previous / next tab'],
  ['↑ / ↓', 'Move in tree / popup'],
  ['→ / ←', 'Expand / collapse folder'],
  ['Enter / Tab', 'Open, toggle, accept completion'],
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
        borderColor={ui.accent}
        title=" Keyboard shortcuts "
        titleColor={ui.text}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        {ROWS.map(([key, desc]) => (
          <box key={key} flexDirection="row">
            <box width={18}>
              <text fg={ui.accent} bg={ui.panelBg} content={key} />
            </box>
            <text fg={ui.text} bg={ui.panelBg} content={desc} />
          </box>
        ))}
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <text fg={ui.dim} bg={ui.panelBg} content="Press Esc to close" />
      </box>
    </Overlay>
  )
}
