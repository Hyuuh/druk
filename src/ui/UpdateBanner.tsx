import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'

import type { UpdateInfo } from '../core/update'
import { ui } from '../themes'
import { Overlay } from './Overlay'

export interface UpdateBannerProps {
  update: UpdateInfo
  onClose: () => void
  onSkip: () => void
}

export function UpdateBanner(props: UpdateBannerProps) {
  useKeyboard((key: KeyEvent) => {
    const k = key.name
    key.preventDefault()
    if (k === 'escape' || k === 'return' || k === 'enter') props.onClose()
    else if (k === 's') props.onSkip()
  })

  return (
    <Overlay zIndex={170}>
      <box
        width={56}
        flexDirection="column"
        backgroundColor={ui.panelBg}
        border
        borderStyle="rounded"
        borderColor={ui.accent}
        title=" Update available "
        titleColor={ui.accent}
        paddingLeft={1}
        paddingRight={1}
      >
        <text
          fg={ui.text}
          bg={ui.panelBg}
          content={`druk ${props.update.current} is installed, ${props.update.latest} is out.`}
        />
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <text fg={ui.accent} bg={ui.panelBg} content="  npm install -g druk@latest" />
        <text fg={ui.dim} bg={ui.panelBg} content="" />
        <text
          fg={ui.dim}
          bg={ui.panelBg}
          content="Enter or Esc to dismiss · s to skip this version"
        />
      </box>
    </Overlay>
  )
}
