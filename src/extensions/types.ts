import type { IconTheme } from '../icons'
import type { Language } from '../languages'
import type { ServerSpec } from '../lsp/servers'
import type { Theme } from '../themes'

/**
 * What an extension is, in one word each — derived from what it contributes,
 * never declared. A manifest carrying `themes` *is* a theme extension, and a
 * field saying otherwise could only ever be wrong.
 *
 * These are the words the extensions panel's search answers to, so they are
 * user-facing: `lsp` rather than `languageServers`, because that is what someone
 * looking for one types.
 */
export type ExtensionCategory = 'language' | 'lsp' | 'theme' | 'icons'

/** Every category there is, in the order a list of them reads best. */
export const CATEGORIES: ExtensionCategory[] = ['language', 'lsp', 'theme', 'icons']

/** One extension's contributions, already validated. */
export interface Extension {
  id: string
  name: string
  version: string
  description: string
  /** The manifest it was read from — the palette's list shows it. */
  source: string
  /** Disabled by `disabledExtensions`: read and listed, but nothing registered. */
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
  /** Derived from the four lists above; `categoriesOf` is the one place it is decided. */
  categories: ExtensionCategory[]
  /**
   * Files the manifest refers to, relative to its folder. The market fetches
   * these beside `extension.json`; an extension with none is one file.
   */
  assets: string[]
}

/**
 * Something a manifest got wrong. Reported once, on startup — an extension that
 * silently contributes nothing is indistinguishable from an extension that is not
 * installed, which is the state this exists to make visible.
 */
export interface ExtensionProblem {
  source: string
  reason: string
}

export interface ExtensionLoad {
  extensions: Extension[]
  problems: ExtensionProblem[]
}
