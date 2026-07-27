import { RGBA } from '@opentui/core'
import type { JSX } from '@opentui/solid'

/**
 * Dim over everything behind a modal. This is real alpha compositing — the terminal
 * cell keeps its character and its colours are blended toward black, so the editor
 * stays legible underneath while clearly reading as inactive. Verified: white text
 * under a 0.45 scrim comes out around #8c8c8c rather than being painted over.
 *
 * Black at partial alpha rather than a theme colour, because it has to recede on a
 * light palette as well as a dark one.
 */
const SCRIM = RGBA.fromValues(0, 0, 0, 0.45)

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
      <box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        backgroundColor={SCRIM}
      />
      {props.children}
    </box>
  )
}
