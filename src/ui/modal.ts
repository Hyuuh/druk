/**
 * Shared geometry, so every modal reads as one family rather than seven hand-picked
 * widths. Sizes follow the terminal: a fixed 58 columns is most of an 80-column
 * window and a postage stamp on a 200-column one.
 */

/** Columns of padding inside a modal's border, each side. */
export const PAD = 2

/**
 * A modal's width: `share` of the terminal, held between `min` and `max`.
 *
 * The terminal has the final say, after `min`. It has to: a modal wider than the
 * screen does not merely overflow, it loses the side of its own border and the
 * panel stops looking like a panel at all.
 */
export function modalWidth(terminal: number, share: number, min: number, max: number): number {
  const wanted = Math.max(min, Math.min(max, Math.round(terminal * share)))
  return Math.max(20, Math.min(wanted, terminal - 2))
}

/**
 * Rows a scrolling list may use: what is left of the terminal after the modal's own
 * chrome, bounded so a very tall window does not give one list the whole screen.
 */
export function listRows(terminal: number, chrome: number, max: number): number {
  return Math.max(3, Math.min(max, terminal - chrome))
}

/**
 * Break `text` onto lines of at most `width`. A `<text>` does not wrap, so a message
 * longer than its modal simply ran off the edge and out of the border.
 */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = ''
    }
    // A single word longer than the width has to be cut; there is nowhere to break it.
    if (word.length > width) {
      if (line) lines.push(line)
      for (let at = 0; at < word.length; at += width) lines.push(word.slice(at, at + width))
      line = ''
      continue
    }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}
