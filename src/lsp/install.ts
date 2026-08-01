/**
 * Installing a language server on the user's behalf: an npm package, or a
 * release binary downloaded from a URL.
 *
 * Three decisions worth keeping:
 *
 * - **A prefix of druk's own**, not `npm i -g`. A global install may need sudo,
 *   puts a binary somewhere the user did not choose, and cannot be undone by
 *   deleting a directory. This one can: `rm -rf ~/.local/share/druk/lsp`.
 * - **npm, not nypm's detection.** The npm-shaped servers are node scripts with
 *   a `#!/usr/bin/env node` shebang, so node has to be there to run them — and
 *   where node is, npm is. The compiled druk binary bakes bun, not node, and
 *   cannot stand in for it. A downloaded binary needs neither.
 * - **PATH still wins.** `installedCommand` only answers for a binary druk put
 *   there itself, so a user who installs the server properly gets their copy.
 */
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { firstLine, notInstalled, run } from '../core/process'

/** Long enough for a slow link; short enough to not hang. */
const INSTALL_TIMEOUT_MS = 180_000

export const SERVER_ROOT = join(
  process.env.XDG_DATA_HOME ?? join(os.homedir(), '.local', 'share'),
  'druk',
  'lsp',
)

/**
 * `command` rewritten to run the copy druk installed, or null if there is none.
 * npm servers land in `node_modules/.bin`; downloaded binaries in `bin/` (with
 * the `.exe` suffix Windows needs).
 */
export function installedCommand(command: string[], root = SERVER_ROOT): string[] | null {
  const [executable, ...args] = command
  if (!executable) return null
  const local = join(root, 'node_modules', '.bin', executable)
  if (existsSync(local)) return [local, ...args]
  const downloaded = join(
    root,
    'bin',
    process.platform === 'win32' ? `${executable}.exe` : executable,
  )
  return existsSync(downloaded) ? [downloaded, ...args] : null
}

/** Whether the servers druk installs could run at all. */
export function hasNodeRuntime(): boolean {
  return runsClean('node', ['--version'])
}

function runsClean(bin: string, args: string[]): boolean {
  try {
    const child = Bun.spawnSync([bin, ...args], { stdout: 'ignore', stderr: 'ignore' })
    return child.exitCode === 0
  } catch {
    return false
  }
}

/**
 * Install `packages` into druk's prefix. Resolves to an error message, or null
 * when the server is ready to spawn.
 */
export async function installServer(
  packages: string[],
  root = SERVER_ROOT,
): Promise<string | null> {
  // --no-save keeps npm from writing a package.json describing a "project"
  // that is really just a bin directory; --prefix creates the tree regardless.
  const result = await run(
    'npm',
    ['install', '--prefix', root, '--no-save', '--no-audit', '--no-fund', ...packages],
    { timeout: INSTALL_TIMEOUT_MS },
  )
  if (result.error) {
    return notInstalled(result) ? 'npm is not installed, or not on PATH' : result.error.message
  }
  if (result.timedOut) return 'npm timed out'
  if (result.status === 0) return null
  return firstLine(result.stderr) || `npm exited with code ${result.status}`
}

/**
 * Fetch a release binary into `root/bin`, like `installServer` but for servers
 * that ship as a download rather than an npm package. `name` is the executable
 * the command runs — the file is saved as `name` (`.exe` on Windows) so
 * `installedCommand` finds it. Resolves to an error message, or null on success.
 */
export async function downloadServer(
  url: string,
  name: string,
  root = SERVER_ROOT,
): Promise<string | null> {
  const target = join(root, 'bin', process.platform === 'win32' ? `${name}.exe` : name)
  // Written under a scratch name and renamed once the body is whole: a transfer
  // that dies mid-stream would otherwise leave a truncated file at `target`,
  // which `installedCommand` then hands to `spawn` on every launch forever.
  const partial = `${target}.part`
  try {
    mkdirSync(join(root, 'bin'), { recursive: true })
    const response = await fetch(url, { signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS) })
    if (!response.ok) return `HTTP ${response.status}`
    await Bun.write(partial, response)
    if (process.platform !== 'win32') chmodSync(partial, 0o755)
    renameSync(partial, target)
    return null
  } catch (error) {
    rmSync(partial, { force: true })
    return error instanceof Error ? error.message : String(error)
  }
}
