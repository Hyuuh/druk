import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY = 'https://registry.npmjs.org/druk/latest'
const TIMEOUT_MS = 2500

export interface UpdateInfo {
  current: string
  latest: string
}

/**
 * Our own version. Walks up from this module looking for druk's package.json,
 * which works both from `src/` in development and from `dist/` once published.
 */
export function currentVersion(): string {
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

function versionParts(v: string): number[] {
  return v
    .split('-')[0]!
    .split('.')
    .map(n => Number.parseInt(n, 10) || 0)
}

/** True when `latest` is newer than `current` (semver-ish, numeric compare). */
export function isNewer(latest: string, current: string): boolean {
  const [a, b] = [versionParts(latest), versionParts(current)]
  for (let i = 0; i < 3; i++) {
    const l = a[i] ?? 0
    const c = b[i] ?? 0
    if (l !== c) return l > c
  }
  return false
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
