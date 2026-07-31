/**
 * Shared list behaviour, so a panel and a launcher scroll and highlight the same
 * way. Every one of these was copied between components before it lived here,
 * and the copies had already started to disagree.
 */
import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { createEffect, createSignal } from 'solid-js'

import { ui } from '../themes'

/**
 * The window of `items` around `selected`, and where it starts.
 *
 * `lead` is how many rows of the list stay visible past the selection: one for a
 * plain list, more where the row above carries context (a search result's file
 * heading) that has to survive the scroll.
 */
export function windowAround<T>(
  items: readonly T[],
  selected: number,
  size: number,
  lead = 1,
): { start: number; rows: T[] } {
  const start = Math.max(0, Math.min(selected - size + lead, items.length - size))
  return { start, rows: items.slice(start, start + size) }
}

/**
 * A window that moves only when the cursor leaves it, the way a scrollbox does.
 * Deriving the start from the cursor alone instead scrolls on every keypress,
 * pinning the selected row to the bottom of the panel.
 *
 * Returns the first row on screen. Reactive: it re-clamps as the cursor moves,
 * the list shrinks, or the terminal resizes.
 */
export function createPanelWindow(cursor: () => number, total: () => number, rows: () => number) {
  const [top, setTop] = createSignal(0)
  createEffect(() => {
    const size = rows()
    const at = cursor()
    const length = total()
    setTop(previous => {
      const start = Math.max(0, Math.min(previous, length - size))
      if (at < start) return at
      if (at >= start + size) return at - size + 1
      return start
    })
  })
  return top
}

/**
 * The keyboard a filtered picker has: ↑/↓ wrapping around the list, Enter to
 * take the selection, Esc to leave. `move` is given a wrapped index, so a picker
 * never has to spell the modulus out for itself.
 */
export function useListKeys(handlers: {
  count: () => number
  move: (next: (index: number) => number) => void
  pick: () => void
  close: () => void
}) {
  useKeyboard((key: KeyEvent) => {
    const count = Math.max(1, handlers.count())
    const step = (delta: number) => handlers.move(index => (index + delta + count) % count)
    if (key.name === 'up') {
      key.preventDefault()
      step(-1)
    } else if (key.name === 'down') {
      key.preventDefault()
      step(1)
    } else if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault()
      handlers.pick()
    } else if (key.name === 'escape') {
      key.preventDefault()
      handlers.close()
    }
  })
}

/**
 * A sidebar row's background: the selection reads differently depending on
 * whether the panel holding it has the keyboard.
 */
export const rowBg = (selected: boolean, focused: boolean): string =>
  selected ? (focused ? ui.treeSelectedBg : ui.treeFocusBg) : ui.sidebarBg
