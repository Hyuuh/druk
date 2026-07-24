import type { ReactNode } from 'react'

/** Full-screen centered layer for modals and overlays. */
export function Overlay({ zIndex = 100, children }: { zIndex?: number; children: ReactNode }) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      zIndex={zIndex}
    >
      {children}
    </box>
  )
}
