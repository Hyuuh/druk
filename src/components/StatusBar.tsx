import { ui } from '../theme'

export interface StatusBarProps {
  message: string
  isError: boolean
  filetype?: string
  cursor?: { line: number; col: number }
  dirty: boolean
}

export function StatusBar({ message, isError, filetype, cursor, dirty }: StatusBarProps) {
  const right = [
    dirty ? '● modified' : '',
    cursor ? `Ln ${cursor.line + 1}, Col ${cursor.col + 1}` : '',
    filetype ?? 'plain',
  ]
    .filter(Boolean)
    .join('   ')

  return (
    <box
      height={1}
      flexDirection="row"
      backgroundColor={isError ? ui.error : ui.statusBg}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexGrow={1}>
        <text fg={ui.statusFg} bg={isError ? ui.error : ui.statusBg} content={message} />
      </box>
      <text fg={ui.statusFg} bg={isError ? ui.error : ui.statusBg} content={right} />
    </box>
  )
}
