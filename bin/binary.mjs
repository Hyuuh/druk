/**
 * Finding — and if need be fetching — the executable for this machine.
 *
 * druk ships one npm package holding no binary at all. The usual arrangement is a
 * package per platform listed as optional dependencies, but publishing those needs a
 * credential that can create packages, and the release runs on GitHub's OIDC identity,
 * which may only publish to `druk` itself. The binaries live on the GitHub release the
 * same workflow produces, so this fetches from there instead: one npm package, one
 * credential, nothing to publish by hand.
 *
 * The cost is that installing needs the network — which is why the fetch is attempted
 * twice, once from postinstall and again on first run, so `--ignore-scripts` and a
 * flaky install both still end up with a working editor.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const platform = process.platform === 'win32' ? 'windows' : process.platform
export const target = `${platform}-${process.arch}`
export const exe = platform === 'windows' ? 'druk.exe' : 'druk'
export const version = pkg.version

/** Every target the release carries; anything else has no binary to fetch. */
const SUPPORTED = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64'])
export const supported = SUPPORTED.has(target)

const asset = `druk-${target}.${platform === 'linux' ? 'tar.gz' : 'zip'}`
const repo =
  pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') ??
  'https://github.com/letstri/druk'
/** `DRUK_DOWNLOAD_BASE` points the fetch at a mirror, for networks that cannot reach GitHub. */
const base = process.env.DRUK_DOWNLOAD_BASE ?? `${repo}/releases/download/v${version}`
const url = `${base}/${asset}`

/**
 * Where the binary may live, best first: beside the shim, then a per-user cache.
 * A global install is often root-owned while `druk` runs as someone else, so the
 * first-run fetch needs somewhere writable of its own to fall back to.
 */
const inPackage = join(here, exe)
const inCache = join(homedir(), '.cache', 'druk', version, exe)

export function findBinary() {
  if (existsSync(inPackage)) return inPackage
  if (existsSync(inCache)) return inCache
  // Running from a clone: whatever `bun run build` last produced.
  const local = join(dirname(here), 'dist', target, exe)
  return existsSync(local) ? local : null
}

/**
 * Download and unpack the release asset. Returns the path, or null if it could not.
 * `timeout` (ms) bounds the whole download — headers and body both, since a stalled
 * body is how a slow mirror hangs an install forever.
 */
export async function fetchBinary({ timeout } = {}) {
  if (!supported) return null
  const temp = join(tmpdir(), `druk-${version}-${process.pid}`)
  try {
    const signal = timeout ? AbortSignal.timeout(timeout) : undefined
    const response = await fetch(url, { redirect: 'follow', signal })
    if (!response.ok) return null
    mkdirSync(temp, { recursive: true })
    const archive = join(temp, asset)
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
    if (!unpack(archive, temp)) return null

    const unpacked = join(temp, exe)
    if (!existsSync(unpacked)) return null
    if (platform !== 'windows') chmodSync(unpacked, 0o755)

    for (const destination of [inPackage, inCache]) {
      // Copy beside the destination, then rename into place. Renaming straight from
      // the unpack directory fails with EXDEV wherever tmpdir is its own filesystem —
      // /tmp is tmpfs on Ubuntu 24.10+ — and the rename is what keeps a half-written
      // file from ever sitting where the shim will run it.
      const partial = `${destination}.partial`
      try {
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(unpacked, partial)
        if (platform !== 'windows') chmodSync(partial, 0o755)
        renameSync(partial, destination)
        return destination
      } catch {
        rmSync(partial, { force: true })
        // Not writable — try the next place.
      }
    }
    return null
  } catch {
    return null
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

/**
 * `tar` handles both formats everywhere that matters: it is bsdtar on macOS and on
 * Windows 10 and later, which reads zip as happily as tar.gz. PowerShell is the
 * fallback for a Windows without it.
 */
function unpack(archive, into) {
  const tar = spawnSync('tar', ['-xf', archive, '-C', into], { stdio: 'pipe', windowsHide: true })
  if (tar.status === 0) return true
  if (platform !== 'windows') return false
  const expand = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${into}' -Force`,
    ],
    { stdio: 'pipe', windowsHide: true },
  )
  return expand.status === 0
}
