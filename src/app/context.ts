import type { Branches } from './branches'
import type { Comparison } from './comparison'
import type { EditorBridge } from './editor'
import type { FileOps } from './fileOps'
import type { Git, GitOp } from './git'
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
  branches: Branches
  comparison: Comparison
  workspace: Workspace
  fileOps: FileOps
  prompts: PromptState & PromptHandlers
  overlays: Overlays
}
