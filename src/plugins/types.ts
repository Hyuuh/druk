import type { IconTheme } from '../icons'
import type { ServerSpec } from '../lsp/servers'
import type { Theme } from '../themes'

/** One plugin's contributions, already validated. */
export interface Plugin {
  id: string
  name: string
  version: string
  description: string
  /** The manifest it was read from — the palette's list shows it. */
  source: string
  /** Disabled by `disabledPlugins`: read and listed, but nothing registered. */
  disabled: boolean
  themes: { id: string; theme: Theme }[]
  icons: IconTheme[]
  servers: ServerSpec[]
}

/**
 * Something a manifest got wrong. Reported once, on startup — a plugin that
 * silently contributes nothing is indistinguishable from a plugin that is not
 * installed, which is the state this exists to make visible.
 */
export interface PluginProblem {
  source: string
  reason: string
}

export interface PluginLoad {
  plugins: Plugin[]
  problems: PluginProblem[]
}
