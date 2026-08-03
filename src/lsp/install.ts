/**
 * Installing a language server on the user's behalf: an npm package, or a
 * release binary downloaded from a URL.
 *
 * Three decisions worth keeping:
 *
 * - **A prefix of druk's own**, not `npm i -g`. A global install may need sudo,
 *   puts a binary somewhere the user did not choose, and cannot be undone by
 *   deleting a directory. This one can: `rm -rf ~/.local/share/druk/lsp`.
 * - **Whichever manager the user has — but node either way.** The npm-shaped
 *   servers are node scripts with a `#!/usr/bin/env node` shebang, so node has
 *   to be there to *run* them however they were fetched. bun will happily
 *   install one on a machine with no node and leave behind a server that can
 *   never spawn, which is why the offer is withheld there. The compiled druk
 *   binary bakes bun, not node, and cannot stand in for it. A downloaded binary
 *   needs neither.
 * - **One prefix, one manager.** A `node_modules` written half by npm and half
 *   by pnpm is not a tree either of them can take apart, so whichever filled it
 *   is recorded and every later install and removal is handed to that one.
 * - **PATH still wins.** `installedCommand` only answers for a binary druk put
 *   there itself, so a user who installs the server properly gets their copy.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

import { firstLine, notInstalled, run } from '../core/process'
import type { ProcessResult } from '../core/process'
import type { ServerInstall } from './servers'

/** Long enough for a slow link; short enough to not hang. */
const INSTALL_TIMEOUT_MS = 180_000

export type PackageManager = 'npm' | 'bun' | 'pnpm'

/**
 * Best first, which is what the choice modal lands its cursor on. yarn is absent
 * deliberately: Berry resolves through Plug'n'Play and writes no `node_modules`
 * at all, so an install that reported success would leave `installedCommand`
 * with nothing to find.
 */
const MANAGERS: PackageManager[] = ['npm', 'bun', 'pnpm']

/** Names the manager that filled the prefix, so a later removal matches it. */
const MANAGER_FILE = '.manager'

export const SERVER_ROOT = join(
  process.env.XDG_DATA_HOME ?? join(os.homedir(), '.local', 'share'),
  'druk',
  'lsp',
)

/**
 * The managers that could fetch a server, best first — empty when none could.
 * Node's absence empties it whatever else is installed: see the note at the top
 * of this file, the servers are node scripts whichever tool downloads them.
 */
export function availablePackageManagers(root = SERVER_ROOT): PackageManager[] {
  if (!which('node')) return []
  // A prefix one manager already wrote is not one another can take apart, so the
  // question is asked once and its answer stands until the directory is deleted.
  const chosen = savedManager(root)
  if (chosen) return which(chosen) ? [chosen] : []
  return MANAGERS.filter(manager => which(manager))
}

/**
 * `Bun.which` reads the real environment rather than `process.env`, so the PATH
 * is handed over explicitly — without it a test cannot take a program away, and
 * neither can anything that edits PATH after startup.
 */
function which(bin: string): string | null {
  return Bun.which(bin, { PATH: process.env.PATH ?? '' })
}

function savedManager(root: string): PackageManager | null {
  try {
    const saved = readFileSync(join(root, MANAGER_FILE), 'utf8').trim()
    return MANAGERS.find(manager => manager === saved) ?? null
  } catch {
    return null
  }
}

function rememberManager(root: string, manager: PackageManager): void {
  try {
    writeFileSync(join(root, MANAGER_FILE), manager)
  } catch {
    // The packages are in; losing the note only costs the next removal its
    // manager, and npm is the guess it falls back to.
  }
}

/**
 * Only npm is told not to save. It is the one that would otherwise leave a
 * package.json describing a "project" that is really a bin directory — while
 * bun and pnpm need the dependency written down or their own `remove` finds
 * nothing to take and leaves the executable behind, exiting 0 as it does.
 */
const INSTALL_ARGS: Record<PackageManager, (root: string) => string[]> = {
  npm: root => ['install', '--prefix', root, '--no-save', '--no-audit', '--no-fund'],
  bun: root => ['add', '--cwd', root],
  pnpm: root => ['add', '--dir', root],
}

const REMOVE_ARGS: Record<PackageManager, (root: string) => string[]> = {
  npm: root => ['uninstall', '--prefix', root, '--no-audit', '--no-fund'],
  bun: root => ['remove', '--cwd', root],
  pnpm: root => ['remove', '--dir', root],
}

/** What went wrong running `manager`, or null when it did what was asked. */
function failureOf(result: ProcessResult, manager: PackageManager): string | null {
  if (result.error) {
    return notInstalled(result)
      ? `${manager} is not installed, or not on PATH`
      : result.error.message
  }
  if (result.timedOut) return `${manager} timed out`
  if (result.status === 0) return null
  return firstLine(result.stderr) || `${manager} exited with code ${result.status}`
}

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

/**
 * Delete druk's own copy of a server. Resolves to an error message, or null when
 * there is nothing of it left.
 *
 * Driven by the manifest's `install` rather than by scanning the directory: an
 * npm server's executable is a link into a package whose name only the manifest
 * knows, and handing that name back to the manager is the one thing that also
 * takes the dependencies that came with it. A `manual` install is druk's to
 * remove in no sense — it was never druk's to put there.
 */
export async function removeServer(
  install: ServerInstall,
  executable: string,
  root = SERVER_ROOT,
): Promise<string | null> {
  if (install.kind === 'download') {
    const target = join(
      root,
      'bin',
      process.platform === 'win32' ? `${executable}.exe` : executable,
    )
    try {
      rmSync(target, { force: true })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  if (install.kind !== 'npm') return 'druk did not install it'
  // Whoever wrote the tree takes it apart; npm for one filled before the note
  // existed, which is what every install used then.
  const manager = savedManager(root) ?? 'npm'
  const result = await run(manager, [...REMOVE_ARGS[manager](root), ...install.packages], {
    timeout: INSTALL_TIMEOUT_MS,
  })
  const failure = failureOf(result, manager)
  if (failure) return failure
  // npm exits 0 for a package that was not there; what the caller promised the
  // user is that the executable is gone, so that is what is checked.
  return installedCommand([executable], root) ? `${executable} is still in ${root}` : null
}

/**
 * Install `packages` into druk's prefix. Resolves to an error message, or null
 * when the server is ready to spawn.
 */
export async function installServer(
  packages: string[],
  root = SERVER_ROOT,
  manager: PackageManager = 'npm',
): Promise<string | null> {
  // The managers are given a directory to work in rather than one to create,
  // and pnpm refuses a path that is not there at all.
  mkdirSync(root, { recursive: true })
  const result = await run(manager, [...INSTALL_ARGS[manager](root), ...packages], {
    timeout: INSTALL_TIMEOUT_MS,
  })
  const failure = failureOf(result, manager)
  if (failure) return failure
  rememberManager(root, manager)
  return null
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
