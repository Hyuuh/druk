import fs from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectInstall, upgradeCommand } from './upgrade'

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
 * How to upgrade the copy that is running, for the banner to suggest. Same
 * detection `druk update` runs on, so the two can never disagree.
 */
export function updateCommand(
  execPath = process.execPath,
  home = homedir(),
  scriptPath = process.argv[1] ?? '',
): string {
  return upgradeCommand(detectInstall(execPath, scriptPath, home))
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
