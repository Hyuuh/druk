import fs from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY = 'https://registry.npmjs.org/druk/latest'
const TIMEOUT_MS = 2500

export interface UpdateInfo {
  current: string
  latest: string
}

/** Baked in by build.ts; undefined when running from source. */
declare const __DRUK_VERSION__: string

/**
 * Our own version. The released binary carries it as a build-time constant — it has no
 * package.json to read — so the walk below only ever runs from source.
 */
export function currentVersion(): string {
  if (typeof __DRUK_VERSION__ === 'string') return __DRUK_VERSION__

  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg?.name === 'druk' && typeof pkg.version === 'string') return pkg.version
    } catch {}
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return '0.0.0'
}

/**
 * How to upgrade the copy that is running, guessed from where its executable sits.
 * Telling a Homebrew user to run `npm install -g` sends them off to install a second
 * druk that their `PATH` will not even find.
 */
export function updateCommand(execPath = process.execPath, home = homedir()): string {
  if (execPath.includes('/Cellar/') || execPath.includes('/homebrew/')) {
    return 'brew upgrade letstri/tap/druk'
  }
  if (execPath.startsWith(join(home, '.druk'))) {
    return 'curl -fsSL https://druk.letstri.dev/install | bash'
  }
  return 'npm install -g druk@latest'
}

/** True when `latest` is newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  try {
    return Bun.semver.order(latest, current) === 1
  } catch {
    // `order` throws on anything unparseable, and `latest` comes off the network.
    return false
  }
}

/**
 * Ask npm for the published version. Best-effort: any failure (offline, slow,
 * malformed) resolves to null and the editor starts as usual.
 */
export async function checkForUpdate(current = currentVersion()): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(REGISTRY, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const latest = ((await res.json()) as { version?: unknown }).version
    if (typeof latest !== 'string' || !isNewer(latest, current)) return null
    return { current, latest }
  } catch {
    return null
  }
}
