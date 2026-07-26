import type { JSX } from '@opentui/solid'

/** Full-screen centered layer for modals and overlays. */
export function Overlay(props: { zIndex?: number; children: JSX.Element }) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      zIndex={props.zIndex ?? 100}
    >
      {props.children}
    </box>
  )
}
