import { join, relative } from 'node:path'

import { comparisonFileContent } from '../core/git'
import type { ComparisonFile } from '../core/git'
import type { DiffContent, DiffEntry } from './diffDocument'

// `rel` is from the opened folder, the file's own path from its repository: with several repos they differ.
export function comparisonEntry(
  repo: string,
  rootDir: string,
  file: ComparisonFile
): DiffEntry {
  const rel = (path: string) => relative(rootDir, join(repo, path))
  return {
    adds: file.additions,
    dels: file.deletions,
    key: file.path,
    oldRel: file.oldPath ? rel(file.oldPath) : null,
    path: join(repo, file.path),
    rel: rel(file.path),
    status: file.status,
  }
}

export async function comparisonContent(
  repo: string,
  file: ComparisonFile
): Promise<DiffContent> {
  const loaded = await comparisonFileContent(repo, file)
  if (!loaded.ok) {
    return { detail: loaded.detail, kind: 'error' }
  }
  return loaded.value.binary
    ? { kind: 'binary' }
    : {
        kind: 'text',
        newText: loaded.value.newText,
        oldText: loaded.value.oldText,
      }
}

// Entries and a loader over one set of files, looked up by the entry's key.
export function comparisonSource(
  repo: string,
  rootDir: string,
  files: ComparisonFile[]
) {
  const byKey = new Map(files.map((file) => [file.path, file]))
  return {
    entries: files.map((file) => comparisonEntry(repo, rootDir, file)),
    load: (entry: DiffEntry): Promise<DiffContent> | DiffContent => {
      const file = byKey.get(entry.key)
      return file
        ? comparisonContent(repo, file)
        : { detail: 'Not in this change', kind: 'error' }
    },
  }
}
