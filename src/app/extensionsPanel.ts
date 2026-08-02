/**
 * The sidebar's extensions view: the rows it draws, the cursor that walks them,
 * and what pressing one does.
 *
 * The same division the git panel keeps — this owns the list and the state,
 * `ui/ExtensionsPanel.tsx` draws it and reports clicks — and every operation a
 * row performs belongs to somebody else: `settings` writes the config and
 * reloads the manifests, `market` fetches and installs.
 *
 * Available starts folded. The catalog is dozens of entries the user did not ask
 * for, and unfolded above what they have installed it buries it; the count on
 * the section row is what says there is something behind it.
 */
import { createMemo, createSignal } from 'solid-js'

import type { MarketEntry } from '../core/market'
import { isNewer } from '../core/update'
import { contributionSummary, extensions } from '../extensions'
import type { Extension } from '../extensions'
import type { Market } from './market'
import type { Settings } from './settings'
import type { Status } from './status'

export type ExtensionRow =
  | { kind: 'section'; id: string; label: string; count: number; collapsed: boolean }
  | {
      kind: 'installed'
      id: string
      label: string
      version: string
      /** What the market has that this does not, or null. */
      update: string | null
      disabled: boolean
      builtin: boolean
      /** What it contributes — the search matches on it too. */
      about: string
    }
  | { kind: 'available'; id: string; label: string; version: string; about: string }

const SECTIONS = { installed: 'INSTALLED', available: 'AVAILABLE' } as const

export function createExtensionsPanel(deps: {
  settings: Settings
  market: Market
  status: Status
}) {
  const { settings, market, status } = deps

  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({ available: true })
  const [cursor, setCursor] = createSignal(0)
  /** The panel's own search field; null until `/` opens it. */
  const [query, setQuery] = createSignal<string | null>(null)

  const matches = (haystack: string) => {
    const q = query()?.trim().toLowerCase()
    if (!q) return true
    return haystack.toLowerCase().includes(q)
  }

  const installedList = createMemo(() =>
    extensions()
      .map((extension: Extension) => {
        const latest = market.catalog().find(entry => entry.id === extension.id)
        return {
          kind: 'installed' as const,
          id: extension.id,
          label: extension.name,
          version: extension.version,
          update:
            latest && !extension.builtin && isNewer(latest.version, extension.version)
              ? latest.version
              : null,
          disabled: extension.disabled,
          builtin: extension.builtin,
          about: contributionSummary(extension),
        }
      })
      .filter(row => matches(`${row.label} ${row.id} ${row.about}`)),
  )

  const availableList = createMemo(() => {
    const held = new Set(extensions().map(extension => extension.id))
    return market
      .catalog()
      .filter((entry: MarketEntry) => !held.has(entry.id))
      .map(entry => ({
        kind: 'available' as const,
        id: entry.id,
        label: entry.name,
        version: entry.version,
        about: entry.description,
      }))
      .filter(row => matches(`${row.label} ${row.id} ${row.about}`))
  })

  const rows = createMemo<ExtensionRow[]>(() => {
    const out: ExtensionRow[] = []
    const push = (key: 'installed' | 'available', list: ExtensionRow[]) => {
      // A search that matched nothing in a section drops the heading too: an
      // empty heading reads as a list that failed to load.
      if (list.length === 0 && query()) return
      // A search opens what it found — a hit behind a folded heading is the same
      // as no hit at all.
      const shut = !query() && collapsed()[key] === true
      out.push({
        kind: 'section',
        id: key,
        label: SECTIONS[key],
        count: list.length,
        collapsed: shut,
      })
      if (!shut) out.push(...list)
    }
    push('installed', installedList())
    push('available', availableList())
    return out
  })

  const at = () => Math.max(0, Math.min(cursor(), rows().length - 1))
  const row = () => rows()[at()]

  const move = (delta: number) => setCursor(Math.max(0, Math.min(at() + delta, rows().length - 1)))
  const moveTo = (index: number) => setCursor(Math.max(0, Math.min(index, rows().length - 1)))

  const toggleSection = (id: string) =>
    setCollapsed(current => ({ ...current, [id]: !current[id] }))

  /** → and ←, which only ever mean "open" and "shut" — and only on a heading. */
  const fold = (shut: boolean) => {
    const current = row()
    if (current?.kind !== 'section' || current.collapsed === shut) return
    toggleSection(current.id)
  }

  /** Enter: fold a heading, flip an installed one, install an available one. */
  const activate = (index = at()) => {
    moveTo(index)
    const current = rows()[Math.max(0, Math.min(index, rows().length - 1))]
    if (!current) return
    if (current.kind === 'section') return toggleSection(current.id)
    if (current.kind === 'available') return market.install(current.id)
    settings.toggleExtension(current.id)
  }

  /** Backspace: uninstall, where there is a folder on disk to delete. */
  const remove = () => {
    const current = row()
    if (current?.kind !== 'installed') return
    market.remove(current.id)
  }

  const reload = (): void => {
    const load = settings.reloadExtensions()
    const problem = load.problems[0]
    if (problem) return void status.say(`Extension: ${problem.reason}`, 'warn')
    status.say(
      `${load.extensions.length} extension${load.extensions.length === 1 ? '' : 's'} reloaded`,
    )
  }

  const openSearch = () => setQuery(current => current ?? '')
  const closeSearch = () => {
    setQuery(null)
    setCursor(0)
  }
  const search = (value: string) => {
    setQuery(value)
    // Onto the first hit, not onto the heading above it: after typing a name the
    // next key is Enter, and Enter on a heading folds a section instead of
    // installing what was searched for.
    const first = rows().findIndex(entry => entry.kind !== 'section')
    setCursor(Math.max(0, first))
  }

  return {
    rows,
    cursor: at,
    move,
    moveTo,
    activate,
    fold,
    remove,
    reload,
    query,
    openSearch,
    closeSearch,
    search,
    /** The header's count, which the search does not narrow. */
    installedCount: () => extensions().length,
    checkNow: () => void market.checkNow(),
    updateAll: () => void market.updateAll(),
  }
}

export type ExtensionsPanel = ReturnType<typeof createExtensionsPanel>
