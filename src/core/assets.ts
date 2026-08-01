import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * OpenTUI resolves its bundled tree-sitter runtime (`web-tree-sitter/tree-sitter.wasm`),
 * the parser worker and grammar wasm relative to `import.meta.url`. When the core is
 * loaded from Bun's global install cache that lookup misses, so we pin the resolver to
 * the node_modules directory that actually ships those assets via `OTUI_ASSET_ROOT`.
 *
 * The compiled binary has the opposite problem: its native library lives in the
 * embedded filesystem, and dlopen on such a path makes Bun extract it to a *fresh*
 * temp file on every launch. macOS validates the signature of a file it has never
 * seen — measured at ~250ms per start, against ~3ms for a file it has seen — so the
 * library is staged once to a stable per-build cache path and `OTUI_ASSET_ROOT`
 * points OpenTUI's import at it.
 *
 * Everything here is synchronous on purpose. A top-level await would let sibling
 * modules evaluate while it waits — including the `@opentui/core` import whose
 * library resolution this env var exists to steer — so the first launch on a new
 * build takes the slow path and stages in the background for the next one.
 *
 * Imported for its side effect before anything touches the highlighter.
 */

const here = fileURLToPath(import.meta.url)
/** True inside a `bun build --compile` binary (either spelling of its virtual root). */
const compiled = here.includes('$bunfs') || /^B:[\\/]~BUN/i.test(here)

function findAssetRoot(): string | null {
  let dir = dirname(here)
  for (let i = 0; i < 10; i++) {
    const nm = join(dir, 'node_modules')
    // Only claim this root when it holds the native library too: pointing
    // OTUI_ASSET_ROOT at a tree that is missing the dylib breaks startup.
    if (
      existsSync(join(nm, 'web-tree-sitter', 'tree-sitter.wasm')) &&
      existsSync(join(nm, `@opentui/core-${process.platform}-${process.arch}`))
    ) {
      return nm
    }
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

const NATIVE_FILE: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'libopentui.dylib',
  linux: 'libopentui.so',
  win32: 'opentui.dll',
}

type EmbeddedFile = Blob & { name?: string }

/**
 * OpenTUI's own embedded copies of the native library, found by their stable name.
 *
 * Plural because a Linux binary holds two: `@opentui/core-linux-<arch>` and
 * `@opentui/core-linux-<arch>-musl` are both installed — only the musl package
 * declares `libc`, so `bun install` keeps both on a glibc machine — and OpenTUI
 * imports each from a branch on `OPENTUI_LIBC`, so the bundler embeds both.
 */
function embeddedNativeLibraries(file: string): EmbeddedFile[] {
  const dot = file.lastIndexOf('.')
  const stem = file.slice(0, dot)
  const ext = file.slice(dot)
  const found: EmbeddedFile[] = []
  for (const blob of Bun.embeddedFiles as ReadonlyArray<EmbeddedFile>) {
    const name = blob.name ?? ''
    // The bundler content-hashes asset names: `libopentui-bjcmj8ep.dylib`.
    if (name === file || (name.startsWith(`${stem}-`) && name.endsWith(ext))) found.push(blob)
  }
  return found
}

/**
 * The package directory OpenTUI will look the library up under, or null when it
 * would refuse the value of `OPENTUI_LIBC` and throw before any of this matters.
 */
function assetKey(): string | null {
  const key = `@opentui/core-${process.platform}-${process.arch}`
  if (process.platform !== 'linux') return key
  const libc = process.env.OPENTUI_LIBC
  if (!libc || libc === 'glibc') return key
  return libc === 'musl' ? `${key}-musl` : null
}

/**
 * Each libc's DT_NEEDED, as it sits NUL-terminated in the library's .dynstr —
 * the only thing that tells the two Linux builds apart, since Bun names embedded
 * files after a hash of their contents. Staging the wrong one is not a slow
 * start but a dead editor: dlopen resolves `libc.so` against glibc's linker
 * script and reports `invalid ELF header`.
 */
const LIBC_NEEDED = { glibc: 'libc.so.6\0', musl: 'libc.so\0' } as const

/** The one library built against this libc, or null if that is not exactly one. */
export async function forLibc<T extends Blob>(
  libs: T[],
  libc: keyof typeof LIBC_NEEDED,
): Promise<T | null> {
  const matches: T[] = []
  for (const lib of libs) {
    if (Buffer.from(await lib.arrayBuffer()).includes(LIBC_NEEDED[libc], 0, 'latin1')) {
      matches.push(lib)
    }
  }
  return matches.length === 1 ? matches[0]! : null
}

function cacheHome(): string {
  return process.env.XDG_CACHE_HOME ?? join(os.homedir(), '.cache')
}

/** Everything but the current build's directory, so upgrades do not accumulate. */
function sweepStaleCaches(base: string, keep: string): void {
  try {
    for (const entry of readdirSync(base)) {
      if (entry !== keep) rmSync(join(base, entry), { recursive: true, force: true })
    }
  } catch {
    // cleanup is best-effort; a leftover directory costs disk, not correctness
  }
}

/** Set only when the compiled binary staged its own root — dev roots stay for good. */
let stagedRoot: string | null = null

function stageCompiledRoot(): void {
  const file = NATIVE_FILE[process.platform]
  const key = assetKey()
  if (!file || !key) return
  try {
    const libs = embeddedNativeLibraries(file)
    const names = libs.map(lib => lib.name)
    if (!names.length || names.some(name => !name)) return
    const base = join(cacheHome(), 'druk', 'native')
    // Every embedded name, so the directory changes whenever any of the libraries
    // does: a new build never dlopens the previous build's library, and the 1.12.0
    // caches — which held the musl library under the glibc key — can never be hit.
    const root = join(base, names.sort().join('+'))
    const dest = join(root, key, file)
    // Which of the candidates was staged is settled by the directory name, so the
    // size only has to say the file is whole; the rename below is what guarantees it.
    if (existsSync(dest) && libs.some(lib => statSync(dest).size === lib.size)) {
      process.env.OTUI_ASSET_ROOT = root
      stagedRoot = root
      return
    }
    // First launch on this build: this run pays the temp extraction as before,
    // and the copy is staged in the background for every launch after it. Which
    // is also where the libc check belongs — reading a candidate to the end is
    // the price of telling them apart, and nothing here may block the editor.
    void (async () => {
      try {
        const wanted =
          process.platform === 'linux'
            ? await forLibc(libs, key.endsWith('-musl') ? 'musl' : 'glibc')
            : libs[0]!
        if (!wanted) return
        mkdirSync(dirname(dest), { recursive: true })
        // Write-then-rename: two first runs racing must never leave a
        // half-written library at the path dlopen is about to load.
        const tmp = `${dest}.${process.pid}.tmp`
        await Bun.write(tmp, wanted)
        renameSync(tmp, dest)
        sweepStaleCaches(base, root.slice(base.length + 1))
      } catch {
        // staging is best-effort: without it startup still works, only slower
      }
    })()
  } catch {
    // same: never let cache trouble break startup
  }
}

if (!process.env.OTUI_ASSET_ROOT) {
  if (compiled) {
    stageCompiledRoot()
  } else {
    const root = findAssetRoot()
    if (root) process.env.OTUI_ASSET_ROOT = root
  }
}

/**
 * The staged root holds *only* the native library, but once `OTUI_ASSET_ROOT` is
 * set OpenTUI requires every asset it ever looks up to exist under it — the next
 * lookup (tree-sitter's wasm, on the first highlight) would throw and silently
 * kill highlighting. The library path is read during `@opentui/core`'s import, so
 * `index.tsx` calls this immediately after the imports settle. A no-op in dev,
 * where the node_modules root really does hold everything.
 */
export function releaseAssetRoot(): void {
  if (stagedRoot && process.env.OTUI_ASSET_ROOT === stagedRoot) {
    delete process.env.OTUI_ASSET_ROOT
  }
  stagedRoot = null
}
