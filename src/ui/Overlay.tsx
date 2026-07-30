import { RGBA } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
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

/** Below this many rows a launcher takes the whole height and sits centred. */
const SHORT_TERMINAL = 28

/**
 * Rows above a `top`-anchored panel: enough to clear the tab strip, so a launcher
 * does not look like it grew out of the tabs — and nothing at all on a terminal
 * too short to spend them, where every row belongs to the list.
 *
 * Exported because the inset comes out of the panel's own height budget: a list
 * sized for the whole terminal and then pushed down by this runs off the bottom.
 */
export const topInset = (height: number) => (height >= SHORT_TERMINAL ? 3 : 0)

export function Overlay(props: {
  zIndex?: number
  /**
   * `top` for the launchers — the palette and the file picker. Reaching for one
   * is a thought that starts at the top of the screen, and a list that grows
   * downward from a fixed point does not shift its first row as it filters,
   * which a centred one does on every keystroke.
   */
  align?: 'center' | 'top'
  children: JSX.Element
}) {
  const dimensions = useTerminalDimensions()
  const inset = () => (props.align === 'top' ? topInset(dimensions().height) : 0)
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent={inset() > 0 ? 'flex-start' : 'center'}
      paddingTop={inset()}
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
