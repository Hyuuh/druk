import type { ComparisonFileStatus, FileStatus } from '../core/git'
import { MARKS, statusColor } from './FileTree'

export type DiffMode = 'inline' | 'split'
export type DiffFileStatus = FileStatus | ComparisonFileStatus

// Bytes across both sides: one native span edit per capture stalls on a package-lock (#66).
export const DIFF_HIGHLIGHT_LIMIT = 1024 * 1024

export const DIFF_HIGHLIGHT_MAX_LINES = 1000

export const DIFF_MAX_LINES = 10_000

export const HATCH = '╱'

// hunk's default: below this a side-by-side pane is too narrow to read either side.
export const DIFF_AUTO_SPLIT_WIDTH = 160

export function resolveDiffView(
  view: DiffMode | 'auto',
  width: number
): DiffMode {
  if (view !== 'auto') {
    return view
  }
  return width >= DIFF_AUTO_SPLIT_WIDTH ? 'split' : 'inline'
}

export function diffMark(status: DiffFileStatus): string {
  if (status === 'renamed') {
    return 'R'
  }
  if (status === 'copied') {
    return 'C'
  }
  if (status === 'typeChanged') {
    return 'T'
  }
  return MARKS[status]
}

export function diffStatusLabel(status: DiffFileStatus): string | undefined {
  switch (status) {
    case 'added':
    case 'untracked': {
      return 'new'
    }
    case 'deleted':
    case 'renamed':
    case 'copied': {
      return status
    }
    case 'typeChanged': {
      return 'type'
    }
    default: {
      return undefined
    }
  }
}

export function diffStatusColor(status: DiffFileStatus): string {
  if (
    status === 'added' ||
    status === 'untracked' ||
    status === 'deleted' ||
    status === 'modified'
  ) {
    return statusColor(status)
  }
  return statusColor('modified')
}

export function blend(color: string, base: string, amount: number): string {
  const rgb = (hex: string): number[] | null =>
    /^#[0-9a-f]{6}$/iu.test(hex)
      ? [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
      : null
  const from = rgb(color)
  const to = rgb(base)
  if (!from || !to) {
    return base
  }
  const mix = (i: number) =>
    Math.round(from[i]! * amount + to[i]! * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(1)}${mix(2)}`
}

export function isPlainDiff(
  oldText: string,
  newText: string,
  lines: number
): boolean {
  return (
    oldText.length + newText.length > DIFF_HIGHLIGHT_LIMIT ||
    lines > DIFF_HIGHLIGHT_MAX_LINES
  )
}

/** The new-side line a reader landing in this file wants: the first one that differs. */
export function firstChangedLine(oldText: string, newText: string): number {
  const old = oldText.split('\n')
  const now = newText.split('\n')
  let at = 0
  while (at < old.length && at < now.length && old[at] === now[at]) {
    at += 1
  }
  return Math.min(at, Math.max(0, now.length - 1))
}
