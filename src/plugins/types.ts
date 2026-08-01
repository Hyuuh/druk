import type { IconTheme } from '../icons'
import type { Language } from '../languages'
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
  /**
   * Shipped inside the binary. Nothing to update or uninstall — but it can be
   * disabled, and a copy installed from the market takes its place.
   */
  builtin: boolean
  themes: { id: string; theme: Theme }[]
  icons: IconTheme[]
  languages: Language[]
  servers: ServerSpec[]
  /**
   * Files the manifest refers to, relative to its folder. The market fetches
   * these beside `plugin.json`; a plugin with none is one file.
   */
  assets: string[]
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
