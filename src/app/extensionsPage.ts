/**
 * The extensions page as rows.
 *
 * The same arrangement as the settings page: this builds the list, `ui/
 * ExtensionsView.tsx` draws it and owns nothing but the selection. Everything a
 * row does is somebody else's operation — `settings` writes the config and
 * reloads the manifests, `market` fetches and installs — so a row is a label and
 * a callback, never state of its own.
 */
import { homedir } from 'node:os'

import { MARKET_URL } from '../core/market'
import { isNewer } from '../core/update'
import { contributionSummary, extensions, EXTENSIONS_DIR } from '../extensions'
import type { ExtensionRow } from '../ui/ExtensionsView'
import type { SettingEdit } from '../ui/SettingEditor'
import type { Market } from './market'
import type { Settings } from './settings'
import type { Status } from './status'

const home = homedir()

export function createExtensionsPage(deps: { settings: Settings; market: Market; status: Status }) {
  const { settings, market, status } = deps

  /** By id, so an installed row can say what the market has that it does not. */
  const catalogEntry = (id: string) => market.catalog().find(entry => entry.id === id)

  const installedRows = (): ExtensionRow[] =>
    extensions().map(extension => {
      const latest = catalogEntry(extension.id)
      const update =
        latest && !extension.builtin && isNewer(latest.version, extension.version)
          ? latest.version
          : null
      return {
        section: 'Installed',
        label: extension.name,
        detail: contributionSummary(extension),
        value: `${extension.disabled ? '✗' : '✓'} ${extension.version}${update ? ` → ${update}` : ''}`,
        activate: () => settings.toggleExtension(extension.id),
        // A built-in has no folder to delete: it lives inside the binary, and
        // the next load would bring it straight back. Disabling is what exists.
        ...(extension.builtin ? null : { remove: () => market.remove(extension.id) }),
      }
    })

  /**
   * The market, minus what is already installed, behind one row that opens a
   * list of its own. Every entry as page rows would be dozens of them above the
   * handful that manage what is installed — and the page's `/` is the *page's*
   * filter, so making it double as a market search would be two jobs on one key.
   */
  const availableRows = (): ExtensionRow[] => {
    const catalog = market.catalog()
    if (catalog.length === 0) {
      return [
        {
          section: 'Available',
          label: 'Nothing fetched yet',
          detail: 'Enter reads the market',
          value: '',
          activate: () => void market.checkNow(),
        },
      ]
    }
    const held = new Set(extensions().map(extension => extension.id))
    const offered = catalog.filter(entry => !held.has(entry.id))
    if (offered.length === 0) {
      return [
        {
          section: 'Available',
          label: 'Everything in the market is installed',
          value: '',
          activate: () => void market.checkNow(),
        },
      ]
    }
    return [
      {
        section: 'Available',
        label: 'Browse the market',
        detail: 'Enter opens the list',
        value: `${offered.length}`,
        select: {
          title: 'Market',
          // The blurb is in the option because the list filters on options —
          // typing "gopls" has to find the Go extension, whose name never says it.
          options: offered.map(
            entry =>
              `${entry.name} ${entry.version}${entry.description ? ` — ${entry.description}` : ''}`,
          ),
          pick: at => market.install(offered[at]!.id),
        },
      },
    ]
  }

  const reload = (): void => {
    const load = settings.reloadExtensions()
    const problem = load.problems[0]
    if (problem) return void status.say(`Extension: ${problem.reason}`, 'warn')
    status.say(
      `${load.extensions.length} extension${load.extensions.length === 1 ? '' : 's'} reloaded`,
    )
  }

  const marketRows = (): ExtensionRow[] => {
    const pending = market.updates()
    return [
      {
        section: 'Market',
        label: 'Check for updates',
        value: pending.length === 0 ? 'up to date' : `${pending.length} waiting`,
        activate: () => void market.checkNow(),
      },
      ...(pending.length > 0
        ? [
            {
              section: 'Market',
              label: 'Update everything',
              detail: pending.map(update => update.entry.name).join(', '),
              value: '',
              activate: () => void market.updateAll(),
            },
          ]
        : []),
      {
        section: 'Market',
        label: 'Check at startup',
        value: settings.config.extensionUpdates ? 'on' : 'off',
        activate: settings.toggleMarket,
      },
      {
        // Free text: a registry is a URL nobody would pick from a list, and the
        // only two answers that matter are druk's own and a fork's.
        section: 'Market',
        label: 'Registry',
        value:
          settings.config.extensionRegistry === MARKET_URL
            ? 'druk'
            : settings.config.extensionRegistry,
        activate: (): SettingEdit => ({
          title: 'Extension registry',
          fields: [{ initial: settings.config.extensionRegistry, placeholder: MARKET_URL }],
          hint: ['An https folder holding index.json and <id>/extension.json', 'Empty: druk’s own'],
          apply: values => settings.applyRegistry(values[0] ?? ''),
        }),
      },
      {
        // Manifests are read once, at startup — this is how a theme being
        // written is seen without restarting the editor.
        section: 'Market',
        label: 'Reload from disk',
        // Home-relative: a home path is what the user would type, and the row
        // clips what will not fit — from the front, which is the useless end.
        detail:
          home && EXTENSIONS_DIR.startsWith(`${home}/`)
            ? `~${EXTENSIONS_DIR.slice(home.length)}`
            : EXTENSIONS_DIR,
        value: '',
        activate: reload,
      },
    ]
  }

  const rows = (): ExtensionRow[] => [...installedRows(), ...availableRows(), ...marketRows()]

  return { rows }
}

export type ExtensionsPage = ReturnType<typeof createExtensionsPage>
