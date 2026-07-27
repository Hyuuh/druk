import { dirname, resolve } from 'node:path'

import { exists, isDirectory } from './fs'
import { currentVersion } from './update'

export const HELP = `druk — terminal code editor

Usage: druk [path]

  path            file or directory to open (default: the current directory)

Options:
  -h, --help      show this help
  -v, --version   show the version
`

/** Output for a flag that prints and exits, or null when there is no such flag. */
export function flagOutput(arg: string | undefined): string | null {
  if (arg === '-h' || arg === '--help') return HELP
  if (arg === '-v' || arg === '--version') return `${currentVersion()}\n`
  return null
}

export interface Target {
  /** The project: what the tree, project search and git all work against. */
  rootDir: string
  /** Set only by `druk <file>`: the one file to open. */
  openFile: string | null
}

/**
 * What `druk <arg>` should open. Null when the path does not exist — the caller
 * reports that and exits, rather than starting on an empty tree the way passing a
 * typo used to.
 *
 * A file makes its own folder the project. Nothing else would give the tree, the
 * project search or git anywhere to look, and `Ctrl+B` is still allowed to bring the
 * sidebar in.
 */
export function resolveTarget(arg: string | undefined, cwd: string): Target | null {
  const target = resolve(cwd, arg ?? '.')
  if (!exists(target)) return null
  if (isDirectory(target)) return { rootDir: target, openFile: null }
  return { rootDir: dirname(target), openFile: target }
}
