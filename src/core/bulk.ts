/**
 * File operations that report progress instead of freezing the editor.
 *
 * `fs.rmSync(node_modules, { recursive: true })` is one call that takes tens of
 * seconds and blocks the loop for all of it: no repaint, no spinner, nothing to
 * tell you the editor is alive rather than hung. These walk the top level of
 * each target instead, doing one entry at a time and handing the loop back
 * between them, so a status line can count up while the work runs.
 *
 * Entry granularity, not file: recursing to every leaf of a 100 000-file tree
 * costs far more than letting the OS delete a package directory in one go, and
 * a few hundred ticks is already a smooth-looking count.
 */
import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface BulkProgress {
  done: number
  /** Entries known to be in this pass; grows as directories are opened. */
  total: number
}

export interface BulkResult {
  done: number
  /** Names that could not be handled, for the message afterwards. */
  failed: string[]
  /** Where each target ended up, for callers that track paths — open tabs do. */
  moved: Array<{ from: string; to: string }>
}

/** Hand the event loop back so the renderer can paint the count. */
const yieldToLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/**
 * Entries to work through for one target: a directory's children, so progress
 * moves, or the target itself when it is a file or cannot be opened.
 */
async function unitsOf(path: string): Promise<string[]> {
  try {
    if (!(await fs.promises.stat(path)).isDirectory()) return [path]
    const names = await fs.promises.readdir(path)
    return names.map(name => join(path, name))
  } catch {
    return [path]
  }
}

export async function removeAll(
  targets: string[],
  onProgress: (progress: BulkProgress) => void,
): Promise<BulkResult> {
  const failed: string[] = []
  let done = 0

  for (const target of targets) {
    const units = await unitsOf(target)
    const total = units.length
    for (const unit of units) {
      try {
        await fs.promises.rm(unit, { recursive: true, force: true })
      } catch {
        failed.push(basename(unit))
      }
      done++
      onProgress({ done, total })
      await yieldToLoop()
    }
    // The directory itself, now that its children are gone.
    if (units[0] !== target) {
      try {
        await fs.promises.rm(target, { recursive: true, force: true })
      } catch {
        failed.push(basename(target))
      }
    }
  }
  return { done, failed, moved: [] }
}

const copyInto = (from: string, to: string) =>
  fs.promises.cp(from, to, { recursive: true, force: false, errorOnExist: true })

/** Put each target into `dir` with `transfer`, one at a time, reporting progress. */
async function transferAll(
  targets: string[],
  dir: string,
  name: (dir: string, base: string) => string,
  onProgress: (progress: BulkProgress) => void,
  transfer: (from: string, to: string) => Promise<void>,
): Promise<BulkResult> {
  const failed: string[] = []
  const moved: BulkResult['moved'] = []
  let done = 0

  for (const [index, target] of targets.entries()) {
    const to = name(dir, basename(target))
    try {
      await fs.promises.mkdir(dirname(to), { recursive: true })
      await transfer(target, to)
      moved.push({ from: target, to })
      done++
    } catch {
      failed.push(basename(target))
    }
    onProgress({ done, total: targets.length })
    if (index % 4 === 3) await yieldToLoop()
  }
  return { done, failed, moved }
}

/** Copy each target into `dir`, one entry at a time. `name` resolves collisions. */
export const copyAll = (
  targets: string[],
  dir: string,
  name: (dir: string, base: string) => string,
  onProgress: (progress: BulkProgress) => void,
): Promise<BulkResult> => transferAll(targets, dir, name, onProgress, copyInto)

/**
 * Move each target into `dir`. A rename across filesystems fails with `EXDEV`,
 * so those fall back to copy-then-delete — dragging something in from `/tmp` is
 * an ordinary thing to do and must not simply be refused.
 */
export const moveAll = (
  targets: string[],
  dir: string,
  name: (dir: string, base: string) => string,
  onProgress: (progress: BulkProgress) => void,
): Promise<BulkResult> =>
  transferAll(targets, dir, name, onProgress, async (from, to) => {
    try {
      await fs.promises.rename(from, to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await copyInto(from, to)
      await fs.promises.rm(from, { recursive: true, force: true })
    }
  })
