import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import type { ComparisonFile } from '../core/git'
import { ui } from '../themes'

export interface ComparisonBinaryViewProps {
  file: ComparisonFile
  focused: boolean
  blocked: boolean
  onFocus: () => void
  onClose: () => void
}

export function ComparisonBinaryView(props: ComparisonBinaryViewProps) {
  useKeyboard((key: KeyEvent) => {
    if (props.blocked || !props.focused || key.defaultPrevented) return
    if (key.name !== 'escape' && key.name !== 'q') return
    key.preventDefault()
    props.onClose()
  })

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.bg}
      onMouseDown={props.onFocus}
    >
      <box backgroundColor={ui.barBg} paddingLeft={1}>
        <text
          fg={ui.gitModified}
          bg={ui.barBg}
          content={`${props.file.status} ${props.file.path}`}
        />
      </box>
      <box flexGrow={1} flexDirection="column" backgroundColor={ui.bg} padding={2}>
        <text fg={ui.text} bg={ui.bg} content="Binary file" />
        <text fg={ui.dim} bg={ui.bg} content="A textual diff is not available." />
        <text
          fg={ui.faint}
          bg={ui.bg}
          content={
            props.file.oldPath ? `${props.file.oldPath} → ${props.file.path}` : props.file.path
          }
        />
      </box>
      <text fg={ui.dim} bg={ui.barBg} content=" Esc close " />
    </box>
  )
}
