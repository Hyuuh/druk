import { dirname, resolve } from 'node:path'

import { exists, isDirectory } from './fs'
import { currentVersion } from './update'

export const HELP = `druk — terminal code editor

Usage: druk [path]
       druk update

  path            file or directory to open (default: the current directory)
  update          upgrade druk itself, however it was installed

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
  /** 0-based line from `druk file.ts:42`; null when none was asked for. */
  line: number | null
}

/**
 * What `druk <arg>` should open. Null when the path does not exist — the caller
 * reports that and exits, rather than starting on an empty tree the way passing a
 * typo used to.
 *
 * A file makes its own folder the project. Nothing else would give the tree, the
 * project search or git anywhere to look, and `Ctrl+B` is still allowed to bring the
 * sidebar in.
 *
 * `file.ts:42` opens the file at that line — but only when no file is literally
 * named `file.ts:42`, which is a legal (if cursed) filename.
 */
export function resolveTarget(arg: string | undefined, cwd: string): Target | null {
  const target = resolve(cwd, arg ?? '.')
  if (exists(target)) {
    if (isDirectory(target)) return { rootDir: target, openFile: null, line: null }
    return { rootDir: dirname(target), openFile: target, line: null }
  }

  // Lazy, so `file.ts:42:7` reads as line 42 column 7, not a file named `file.ts:42`.
  const at = /^(.+?):(\d+)(?::\d+)?$/.exec(arg ?? '')
  if (at) {
    const file = resolve(cwd, at[1]!)
    if (exists(file) && !isDirectory(file)) {
      return { rootDir: dirname(file), openFile: file, line: Math.max(0, Number(at[2]) - 1) }
    }
  }
  return null
}
