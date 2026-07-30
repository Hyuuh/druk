import { extname } from 'node:path'

/**
 * Extensions the rendered view offers itself for. `.mdx` is deliberately absent:
 * its JSX blocks are not markdown, and a renderer that swallows them shows a
 * document with holes in it.
 */
const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd'])

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTS.has(extname(path).toLowerCase())
}
