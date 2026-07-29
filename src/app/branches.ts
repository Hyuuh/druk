import { createSignal } from 'solid-js'

import {
  createBranch,
  deleteBranch,
  inRepository,
  listBranches,
  localBranchName,
  mergeBranch,
  renameBranch,
  switchBranch,
} from '../core/git'
import type { Branch } from '../core/git'
import type { GitOp } from './git'
import type { PromptState } from './prompts'
import type { Status } from './status'

/** What picking a branch in the picker goes on to do with it. */
export type BranchMode = 'switch' | 'from' | 'merge' | 'rename' | 'delete' | 'deleteForce'

interface PickerSpec {
  title: string
  /** Branches this mode may act on; the rest never reach the list. */
  keep: (branch: Branch) => boolean
  /** Said instead of opening an empty picker. */
  empty: string
}

const PICKERS: Record<BranchMode, PickerSpec> = {
  switch: {
    title: 'Switch to branch',
    keep: branch => !branch.current,
    empty: 'No other branch to switch to',
  },
  from: { title: 'New branch from', keep: () => true, empty: 'No branch to start from' },
  merge: {
    title: 'Merge into the current branch',
    keep: branch => !branch.current,
    empty: 'No other branch to merge',
  },
  // A remote-tracking branch is a copy of what the remote said; renaming or
  // deleting one locally only loses track of it, so both are local-only.
  rename: {
    title: 'Rename branch',
    keep: branch => !branch.remote,
    empty: 'No local branch to rename',
  },
  delete: {
    title: 'Delete branch',
    keep: branch => !branch.remote && !branch.current,
    empty: 'No other local branch to delete',
  },
  deleteForce: {
    title: 'Delete branch (force)',
    keep: branch => !branch.remote && !branch.current,
    empty: 'No other local branch to delete',
  },
}

/**
 * Branch commands: the picker they all start from, and the mutations they end
 * in. Everything destructive goes through a prompt first, so this module opens
 * one and `prompts.ts` calls back into the runners below once it is answered.
 */
export function createBranches(deps: {
  rootDir: string
  status: Status
  gitOp: GitOp
  prompts: PromptState
}) {
  const { rootDir, status, gitOp, prompts } = deps

  /** The open branch picker: what it lists and what picking will mean. */
  const [pick, setPick] = createSignal<{ mode: BranchMode; branches: Branch[] } | null>(null)

  const pickTitle = () => {
    const open = pick()
    return open ? PICKERS[open.mode].title : ''
  }

  const open = (mode: BranchMode) => {
    if (!inRepository(rootDir)) return status.say('Not a git repository', 'warn')
    const spec = PICKERS[mode]
    const branches = listBranches(rootDir).filter(spec.keep)
    if (branches.length === 0) return status.say(spec.empty)
    setPick({ mode, branches })
  }

  const create = (name: string, from: string | null) =>
    gitOp('Creating branch', () => createBranch(rootDir, name, from), {
      touchesTree: true,
      done: () => `On ${name}`,
    })

  /** New branch off HEAD — the one branch command with nothing to pick first. */
  const newBranch = () => {
    if (!inRepository(rootDir)) return status.say('Not a git repository', 'warn')
    prompts.setPrompt({ kind: 'newBranch', from: null })
  }

  const choose = (branch: Branch) => {
    const mode = pick()?.mode
    setPick(null)
    switch (mode) {
      case 'switch':
        return gitOp('Switching branch', () => switchBranch(rootDir, branch.name, branch.remote), {
          touchesTree: true,
          done: () => `On ${localBranchName(branch.name)}`,
        })
      case 'from':
        return prompts.setPrompt({ kind: 'newBranch', from: branch.name })
      case 'merge':
        return prompts.setPrompt({ kind: 'mergeBranch', name: branch.name })
      case 'rename':
        return prompts.setPrompt({ kind: 'renameBranch', from: branch.name })
      case 'delete':
      case 'deleteForce':
        return prompts.setPrompt({
          kind: 'deleteBranch',
          name: branch.name,
          force: mode === 'deleteForce',
        })
    }
  }

  const rename = (from: string, to: string) =>
    gitOp('Renaming branch', () => renameBranch(rootDir, from, to), {
      done: () => `Renamed ${from} to ${to}`,
    })

  const remove = (name: string, force: boolean) =>
    gitOp('Deleting branch', () => deleteBranch(rootDir, name, force), {
      done: () => `Deleted ${name}`,
    })

  const merge = (name: string) =>
    gitOp('Merging', () => mergeBranch(rootDir, name), {
      touchesTree: true,
      // git's own summary ("Fast-forward", "Merge made by the 'ort' strategy")
      // says more about what happened than any sentence here could.
      done: result => result.detail || `Merged ${name}`,
    })

  return { pick, setPick, pickTitle, open, newBranch, choose, create, rename, remove, merge }
}

export type Branches = ReturnType<typeof createBranches>
