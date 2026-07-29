import type { Branches } from './branches'
import type { EditorBridge } from './editor'
import type { FileOps } from './fileOps'
import type { Git, GitOp } from './git'
import type { Lsp } from './lsp'
import type { Overlays } from './Overlays'
import type { Panes } from './panes'
import type { PromptHandlers, PromptState } from './prompts'
import type { Settings } from './settings'
import type { Status } from './status'
import type { Tree } from './tree'
import type { Workspace } from './workspace'

/** Every controller, assembled once in App and handed to the wiring that spans them. */
export interface AppContext {
  rootDir: string
  status: Status
  settings: Settings
  tree: Tree
  panes: Panes
  editor: EditorBridge
  git: Git
  gitOp: GitOp
  lsp: Lsp
  branches: Branches
  workspace: Workspace
  fileOps: FileOps
  prompts: PromptState & PromptHandlers
  overlays: Overlays
}
