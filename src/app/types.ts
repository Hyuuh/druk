/** Which pane owns the keyboard when no overlay is open. */
export type Focus = 'tree' | 'editor'

export interface FileBuffer {
  content: string
  dirty: boolean
  /** Disk mtime this buffer was last in sync with; used to detect outside edits. */
  mtime: number
}

/** Dirty buffers a disk sync refused to touch, split by what happened to the file. */
export interface DiskSync {
  changed: string[]
  deleted: string[]
}

/** An unsaved buffer whose file also changed on disk. */
export interface Conflict {
  path: string
  disk: string
  /** The file is gone: there is no outside version to accept. */
  deleted: boolean
}

export type Prompt =
  | { kind: 'gotoLine' }
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'rename'; target: string }
  | { kind: 'delete'; targets: string[] }
  | { kind: 'closeDirty'; paths: string[]; names: string[] }
  | { kind: 'quitDirty'; names: string[] }
  | { kind: 'commit'; paths: string[] }
  | { kind: 'undoCommit'; subject: string }
  /** `from` is the branch to start at, or null for HEAD. */
  | { kind: 'newBranch'; from: string | null }
  | { kind: 'renameBranch'; from: string }
  | { kind: 'deleteBranch'; name: string; force: boolean }
  | { kind: 'mergeBranch'; name: string }
  /** A language server is missing and druk can fetch it; `id` is the server id. */
  | { kind: 'installServer'; id: string; name: string; packages: string[] }
  | null

export type PromptKind = NonNullable<Prompt>['kind']

/** What a yes/no prompt asks and how loudly it asks it. */
export interface Confirmation {
  title: string
  message: string
  verb: string
  danger: boolean
}
