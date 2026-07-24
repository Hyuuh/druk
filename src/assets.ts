import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * OpenTUI resolves its bundled tree-sitter runtime (`web-tree-sitter/tree-sitter.wasm`),
 * the parser worker and grammar wasm relative to `import.meta.url`. When the core is
 * loaded from Bun's global install cache that lookup misses, so we pin the resolver to
 * the node_modules directory that actually ships those assets via `OTUI_ASSET_ROOT`.
 *
 * Imported for its side effect before anything touches the highlighter.
 */
function findAssetRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    const nm = join(dir, 'node_modules')
    if (existsSync(join(nm, 'web-tree-sitter', 'tree-sitter.wasm'))) return nm
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  try {
    const wasm = fileURLToPath(import.meta.resolve('web-tree-sitter/tree-sitter.wasm'))
    return dirname(dirname(wasm))
  } catch {
    return null
  }
}

if (!process.env.OTUI_ASSET_ROOT) {
  const root = findAssetRoot()
  if (root) process.env.OTUI_ASSET_ROOT = root
}
