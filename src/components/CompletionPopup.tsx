import { ui } from '../theme'

export interface CompletionPopupProps {
  items: string[]
  index: number
  top: number
  left: number
}

export function CompletionPopup({ items, index, top, left }: CompletionPopupProps) {
  // +1 for the leading space in each row, +2 for the border.
  const width = Math.min(30, Math.max(...items.map(i => i.length)) + 3)
  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={width}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      border
      borderColor={ui.accent}
      zIndex={50}
    >
      {items.map((item, i) => {
        const bg = i === index ? ui.treeSelectedBg : ui.panelBg
        return <text key={item} fg={i === index ? ui.text : ui.dim} bg={bg} content={` ${item}`} />
      })}
    </box>
  )
}
