/**
 * File icons — the glyph the tree draws where the expansion arrow otherwise
 * goes, and the registry extensions add icon themes to.
 *
 * One ships with druk: `unicode`, whose glyphs are geometric shapes every font
 * has. It is not the default — `iconTheme: 'none'` is, because a terminal cannot
 * be asked what its font holds and a row of tofu is worse than no icons at all,
 * and a set that needs a patched font (`material-icons`, `nerd-icons`) is a
 * market extension for that same reason.
 *
 * A theme replaces the arrow rather than sitting beside it: the folder glyph
 * has an open and a closed form, so expansion is still readable and the row
 * costs no extra column.
 */
import { createSignal } from 'solid-js'

export interface IconEntry {
  /** One cell wide. A wider glyph shifts every name in the tree by a column. */
  glyph: string
  /** `#rrggbb`; the row's dim colour when absent. */
  color?: string
}

export interface IconTheme {
  id: string
  name: string
  /**
   * The glyphs are in a font's private-use area, so only a patched font has
   * them. Nothing can ask a terminal what its font holds, which is why this is
   * declared and then said out loud when the theme is picked.
   */
  patchedFont?: boolean
  /** Fallback for a file no rule matched. */
  file: IconEntry
  folder: IconEntry
  folderOpen: IconEntry
  /** Whole file names, lowercase — `package.json`, `.gitignore`. */
  names: Record<string, IconEntry>
  /**
   * Extensions without the dot, lowercase. A compound key (`d.ts`, `test.ts`)
   * is matched before the plain one, so the longest suffix wins.
   */
  extensions: Record<string, IconEntry>
  /** Folder names, lowercase — `src`, `node_modules`. */
  folders: Record<string, IconEntry>
  /**
   * The open form of a named folder. A theme that names folders needs it or
   * expansion stops being readable: the icon took the arrow's column, so
   * `src` would look the same shut as open.
   */
  foldersOpen: Record<string, IconEntry>
}

/** The value of `iconTheme` that draws nothing at all. */
export const NO_ICONS = 'none'

const entry = (glyph: string, color?: string): IconEntry => (color ? { glyph, color } : { glyph })

/**
 * Shapes, not pictures: every glyph here is a BMP geometric or punctuation
 * character, which is one cell wide in any terminal and present in any font.
 */
const unicode: IconTheme = {
  id: 'unicode',
  name: 'Unicode shapes',
  file: entry('·'),
  folder: entry('▸'),
  folderOpen: entry('▾'),
  names: {
    'package.json': entry('▤'),
    'bun.lock': entry('▤'),
    'package-lock.json': entry('▤'),
    'dockerfile': entry('▦'),
    'makefile': entry('▦'),
    'license': entry('¶'),
    'readme.md': entry('¶'),
  },
  extensions: {
    ts: entry('◆'),
    tsx: entry('◆'),
    js: entry('◇'),
    jsx: entry('◇'),
    mjs: entry('◇'),
    cjs: entry('◇'),
    py: entry('◆'),
    rs: entry('◆'),
    go: entry('◆'),
    rb: entry('◆'),
    php: entry('◆'),
    java: entry('◆'),
    c: entry('◇'),
    h: entry('◇'),
    cpp: entry('◇'),
    zig: entry('◆'),
    lua: entry('◆'),
    swift: entry('◆'),
    sh: entry('▷'),
    bash: entry('▷'),
    zsh: entry('▷'),
    md: entry('¶'),
    txt: entry('¶'),
    json: entry('▤'),
    jsonc: entry('▤'),
    yaml: entry('▤'),
    yml: entry('▤'),
    toml: entry('▤'),
    html: entry('◈'),
    css: entry('◈'),
    scss: entry('◈'),
    png: entry('▣'),
    jpg: entry('▣'),
    jpeg: entry('▣'),
    gif: entry('▣'),
    svg: entry('▣'),
    zip: entry('▦'),
    tar: entry('▦'),
    gz: entry('▦'),
    lock: entry('▪'),
  },
  folders: {},
  foldersOpen: {},
}

export const BUILTIN_ICON_THEMES: IconTheme[] = [unicode]

/** Every theme by id, built-ins and whatever extensions registered. */
const registry: Record<string, IconTheme> = Object.fromEntries(
  BUILTIN_ICON_THEMES.map(theme => [theme.id, theme]),
)

/** Registered by an extension, and dropped again when extensions reload. */
const fromExtensions = new Set<string>()

// A signal for the same reason the theme registry has one: the settings page's
// list is built in a reactive scope, and a mutated object repaints nothing.
const [names, setNames] = createSignal<string[]>(Object.keys(registry))

export function registerIconTheme(theme: IconTheme): void {
  registry[theme.id] = theme
  fromExtensions.add(theme.id)
  setNames(Object.keys(registry))
}

export function clearExtensionIconThemes(): void {
  for (const id of fromExtensions) {
    // An extension may have registered over a shipped id; dropping it has to put the
    // shipped theme back rather than leave the setting naming nothing.
    const shipped = BUILTIN_ICON_THEMES.find(theme => theme.id === id)
    if (shipped) registry[id] = shipped
    else delete registry[id]
  }
  fromExtensions.clear()
  setNames(Object.keys(registry))
}

/** `none` first: it is a value of the setting, not a theme anyone registered. */
export const iconThemeNames = (): string[] => [NO_ICONS, ...names()]

export const iconThemeLabel = (id: string): string =>
  id === NO_ICONS ? 'none' : (registry[id]?.name ?? id)

export const iconThemeNeedsFont = (id: string): boolean => registry[id]?.patchedFont === true

export const isIconThemeName = (value: unknown): value is string =>
  typeof value === 'string' && (value === NO_ICONS || value in registry)

/**
 * A folder's name with the decoration projects put around it stripped:
 * `.github`, `_test` and `__tests__` are the folder a theme spells `github` and
 * `test`. Listing all five spellings is what an icon theme would otherwise have
 * to do — the upstream Material set generates exactly these variants — and it
 * multiplies a large folder map by five for nothing.
 */
const folderKey = (name: string): string => name.replace(/^__(.+)__$/, '$1').replace(/^[._-]+/, '')

/**
 * The glyph for one tree row, or null when icons are off or the theme is gone —
 * an extension can be uninstalled while its id is still in the config.
 */
export function iconFor(
  themeId: string,
  node: { name: string; isDir: boolean; expanded?: boolean },
): IconEntry | null {
  if (themeId === NO_ICONS) return null
  const theme = registry[themeId]
  if (!theme) return null
  const name = node.name.toLowerCase()
  if (node.isDir) {
    const key = folderKey(name)
    // A named folder with no open form falls back to its shut one rather than to
    // the generic open folder: the name is what the glyph is there to say.
    const named = node.expanded
      ? (theme.foldersOpen[name] ??
        theme.foldersOpen[key] ??
        theme.folders[name] ??
        theme.folders[key])
      : (theme.folders[name] ?? theme.folders[key])
    return named ?? (node.expanded ? theme.folderOpen : theme.folder)
  }
  const byName = theme.names[name]
  if (byName) return byName
  // Left to right, so a compound extension (`d.ts`) is tried before `ts`.
  for (let at = name.indexOf('.'); at !== -1; at = name.indexOf('.', at + 1)) {
    const found = theme.extensions[name.slice(at + 1)]
    if (found) return found
  }
  return theme.file
}
