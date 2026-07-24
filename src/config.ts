import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

import { themes } from './theme'
import type { ThemeName } from './theme'

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'), 'druk')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

export interface Config {
  theme: ThemeName
}

const DEFAULTS: Config = { theme: 'dark' }

/** Read the config file, falling back to defaults on any error or bad value. */
export function loadConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    return { theme: raw?.theme in themes ? raw.theme : DEFAULTS.theme }
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
