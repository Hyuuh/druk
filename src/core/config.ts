/**
 * User settings, persisted as JSON at `$XDG_CONFIG_HOME/druk/config.json`
 * (default `~/.config/druk/config.json`).
 *
 * To add a setting: add the field to `Config`, give it a value in `DEFAULTS`,
 * and validate it in `parse()`. Anything missing or invalid falls back to the
 * default, so a hand-edited config can never break startup.
 */
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { isThemeName } from '../themes'
import type { ThemeName } from '../themes'

export const CONFIG_FILE = join(
  process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'),
  'druk',
  'config.json',
)

export interface Config {
  /** Color scheme id — see src/themes. */
  theme: ThemeName
  /** Modal editing (normal / insert / visual). */
  vim: boolean
  /** Columns per indent level: indent guides and literal tabs both use it. */
  tabSize: number
  /** Show .DS_Store, .git and friends in the tree. */
  showHidden: boolean
  /** Wrap long lines instead of scrolling horizontally. */
  wordWrap: boolean
  /** Check npm for a newer druk on startup. */
  checkUpdates: boolean
  /** Version whose update notice was dismissed; suppresses the banner for it. */
  skipUpdate: string
}

export const DEFAULTS: Config = {
  theme: 'dark',
  vim: false,
  tabSize: 2,
  showHidden: true,
  wordWrap: false,
  checkUpdates: true,
  skipUpdate: '',
}

function parse(raw: unknown): Config {
  const obj = (raw ?? {}) as Partial<Record<keyof Config, unknown>>
  return {
    theme: isThemeName(obj.theme) ? obj.theme : DEFAULTS.theme,
    vim: typeof obj.vim === 'boolean' ? obj.vim : DEFAULTS.vim,
    tabSize:
      typeof obj.tabSize === 'number' && obj.tabSize >= 1 && obj.tabSize <= 16
        ? Math.floor(obj.tabSize)
        : DEFAULTS.tabSize,
    checkUpdates: typeof obj.checkUpdates === 'boolean' ? obj.checkUpdates : DEFAULTS.checkUpdates,
    skipUpdate: typeof obj.skipUpdate === 'string' ? obj.skipUpdate : DEFAULTS.skipUpdate,
    showHidden: typeof obj.showHidden === 'boolean' ? obj.showHidden : DEFAULTS.showHidden,
    wordWrap: typeof obj.wordWrap === 'boolean' ? obj.wordWrap : DEFAULTS.wordWrap,
  }
}

/** Read the config file, falling back to defaults on any error or bad value. */
export function loadConfig(): Config {
  try {
    return parse(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

/** Persist config to disk (best-effort). */
export function saveConfig(config: Config): void {
  try {
    fs.mkdirSync(dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  } catch {
    // best-effort — running without a writable home just means no persistence
  }
}
