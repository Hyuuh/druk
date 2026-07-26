import { describe, expect, test } from 'bun:test'

import type { MouseEvent, TextareaRenderable } from '@opentui/core'

import { ignoreScrollOutsideBounds } from '../src/ui/EditorPane'

/** A stand-in for the textarea: the renderer only needs bounds and the hook. */
function fakeEditor(seen: MouseEvent[]) {
  return {
    x: 30,
    y: 1,
    width: 50,
    height: 18,
    onMouseEvent(event: MouseEvent) {
      seen.push(event)
    },
  } as unknown as TextareaRenderable
}

const event = (type: string, x: number, y: number) => ({ type, x, y }) as unknown as MouseEvent

describe('scroll delivered to the focused editor', () => {
  test('is dropped when the pointer is over the sidebar', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)

    // The renderer's hit test misses the tree and falls back to the focused editor.
    ;(editor as unknown as { onMouseEvent: (e: MouseEvent) => void }).onMouseEvent(
      event('scroll', 3, 8),
    )
    expect(seen).toHaveLength(0)
  })

  test('still scrolls when the pointer is over the editor', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)
    ;(editor as unknown as { onMouseEvent: (e: MouseEvent) => void }).onMouseEvent(
      event('scroll', 59, 8),
    )
    expect(seen).toHaveLength(1)
  })

  test('leaves every other mouse event alone, wherever it lands', () => {
    const seen: MouseEvent[] = []
    const editor = fakeEditor(seen)
    ignoreScrollOutsideBounds(editor)
    ;(editor as unknown as { onMouseEvent: (e: MouseEvent) => void }).onMouseEvent(
      event('down', 3, 8),
    )
    expect(seen).toHaveLength(1)
  })
})
