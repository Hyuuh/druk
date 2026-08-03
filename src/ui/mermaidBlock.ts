/**
 * The bridge between the mermaid renderer and OpenTUI's markdown renderable: a
 * ```mermaid fence becomes a block of styled cells instead of its source.
 */
import { createMarkdownCodeBlockRenderer, fg, StyledText, TextRenderable } from '@opentui/core'
import type { MarkdownOptions, RenderContext, TextChunk } from '@opentui/core'

import type { Line, Role } from '../core/mermaid'
import { renderMermaid } from '../core/mermaid'
import type { UiColors } from '../themes/types'

function colorFor(role: Role, ui: UiColors): string {
  switch (role) {
    case 'label':
    case 'title': {
      return ui.text
    }
    case 'edgeLabel': {
      return ui.accent
    }
    case 'muted': {
      return ui.faint
    }
    default: {
      return ui.dim
    }
  }
}

export function diagramText(lines: Line[], ui: UiColors): StyledText {
  const chunks: TextChunk[] = []
  lines.forEach((line, index) => {
    if (index > 0) chunks.push(fg(ui.dim)('\n'))
    for (const segment of line) chunks.push(fg(colorFor(segment.role, ui))(segment.text))
  })
  return new StyledText(chunks)
}

/**
 * Answers `undefined` for a fence this cannot draw, which is what leaves the
 * markdown renderable to fall back to the source — the whole of what the author
 * wrote, rather than a half-drawn diagram.
 */
export function mermaidRenderer(ctx: RenderContext, ui: UiColors): MarkdownOptions['renderNode'] {
  return createMarkdownCodeBlockRenderer({
    mermaid: token => {
      const lines = renderMermaid(token.text)
      if (!lines) return undefined
      return new TextRenderable(ctx, {
        content: diagramText(lines, ui),
        // A diagram is a picture: wrapping it at the pane's width would rewrite
        // the picture rather than scroll it.
        wrapMode: 'none',
      })
    },
  })
}
