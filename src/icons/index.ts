/**
 * File icons — the glyph the tree draws where the expansion arrow otherwise
 * goes, and the registry plugins add icon themes to.
 *
 * Two ship with druk: `unicode`, whose glyphs are geometric shapes every font
 * has, and `nerd`, which needs a patched font. Neither is the default —
 * `iconTheme: 'none'` is, because a terminal cannot be asked what its font
 * holds and a row of tofu is worse than no icons at all.
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
}

/**
 * Nerd Font codepoints — the Devicons and Font Awesome ranges a patched font
 * carries. Deliberately a small set: a glyph druk gets wrong is a wrong picture
 * on every row that matches it, and a plugin icon theme is how anyone who wants
 * the full devicon table gets one.
 */
const nerd: IconTheme = {
  id: 'nerd',
  name: 'Nerd Font',
  file: entry('\uF15B'),
  folder: entry('\uF07B', '#7aa2f7'),
  folderOpen: entry('\uF07C', '#7aa2f7'),
  names: {
    'package.json': entry('\uE71E', '#cb3837'),
    'package-lock.json': entry('\uE71E', '#cb3837'),
    'bun.lock': entry('\uF023', '#f7e4c4'),
    'bun.lockb': entry('\uF023', '#f7e4c4'),
    'dockerfile': entry('\uF308', '#2496ed'),
    'makefile': entry('\uF013', '#6d8086'),
    'license': entry('\uF15C', '#d0bf41'),
    '.gitignore': entry('\uF1D3', '#f14c28'),
    '.gitattributes': entry('\uF1D3', '#f14c28'),
    '.env': entry('\uF013', '#faf743'),
  },
  extensions: {
    'ts': entry('\uE628', '#3178c6'),
    'd.ts': entry('\uE628', '#4b6e8f'),
    'tsx': entry('\uE7BA', '#3178c6'),
    'js': entry('\uE781', '#f1e05a'),
    'mjs': entry('\uE781', '#f1e05a'),
    'cjs': entry('\uE781', '#f1e05a'),
    'jsx': entry('\uE7BA', '#f1e05a'),
    'py': entry('\uE73C', '#3572a5'),
    'rs': entry('\uE7A8', '#dea584'),
    'go': entry('\uE627', '#00add8'),
    'rb': entry('\uE739', '#cc342d'),
    'php': entry('\uE73D', '#777bb4'),
    'java': entry('\uE738', '#b07219'),
    'c': entry('\uE61E', '#599eff'),
    'h': entry('\uE61E', '#a074c4'),
    'cpp': entry('\uE61D', '#519aba'),
    'zig': entry('\uF15B', '#f7a41d'),
    'lua': entry('\uE620', '#51a0cf'),
    'swift': entry('\uE755', '#e37933'),
    'sh': entry('\uF489', '#89e051'),
    'bash': entry('\uF489', '#89e051'),
    'zsh': entry('\uF489', '#89e051'),
    'md': entry('\uF48A', '#519aba'),
    'txt': entry('\uF15C'),
    'json': entry('\uE60B', '#cbcb41'),
    'jsonc': entry('\uE60B', '#cbcb41'),
    'yaml': entry('\uF481', '#cb171e'),
    'yml': entry('\uF481', '#cb171e'),
    'toml': entry('\uF013', '#9c4221'),
    'html': entry('\uE736', '#e34c26'),
    'css': entry('\uE749', '#563d7c'),
    'scss': entry('\uE749', '#c6538c'),
    'vue': entry('\uE7BA', '#41b883'),
    'png': entry('\uF1C5', '#a074c4'),
    'jpg': entry('\uF1C5', '#a074c4'),
    'jpeg': entry('\uF1C5', '#a074c4'),
    'gif': entry('\uF1C5', '#a074c4'),
    'svg': entry('\uF1C5', '#ffb13b'),
    'pdf': entry('\uF1C1', '#b30b00'),
    'zip': entry('\uF1C6', '#afb42b'),
    'tar': entry('\uF1C6', '#afb42b'),
    'gz': entry('\uF1C6', '#afb42b'),
    'lock': entry('\uF023', '#bbbbbb'),
  },
  folders: {
    'node_modules': entry('\uF07B', '#cb3837'),
    '.git': entry('\uF1D3', '#f14c28'),
    'src': entry('\uF07B', '#7aa2f7'),
    'test': entry('\uF07B', '#a6e22e'),
    'tests': entry('\uF07B', '#a6e22e'),
    'dist': entry('\uF07B', '#6d8086'),
    'build': entry('\uF07B', '#6d8086'),
  },
}

export const BUILTIN_ICON_THEMES: IconTheme[] = [unicode, nerd]

/** Every theme by id, built-ins and whatever plugins registered. */
const registry: Record<string, IconTheme> = Object.fromEntries(
  BUILTIN_ICON_THEMES.map(theme => [theme.id, theme]),
)

/** Registered by a plugin, and dropped again when plugins reload. */
const fromPlugins = new Set<string>()

// A signal for the same reason the theme registry has one: the settings page's
// list is built in a reactive scope, and a mutated object repaints nothing.
const [names, setNames] = createSignal<string[]>(Object.keys(registry))

export function registerIconTheme(theme: IconTheme): void {
  registry[theme.id] = theme
  fromPlugins.add(theme.id)
  setNames(Object.keys(registry))
}

export function clearPluginIconThemes(): void {
  for (const id of fromPlugins) {
    // A plugin may have registered over a shipped id; dropping it has to put the
    // shipped theme back rather than leave the setting naming nothing.
    const shipped = BUILTIN_ICON_THEMES.find(theme => theme.id === id)
    if (shipped) registry[id] = shipped
    else delete registry[id]
  }
  fromPlugins.clear()
  setNames(Object.keys(registry))
}

/** `none` first: it is a value of the setting, not a theme anyone registered. */
export const iconThemeNames = (): string[] => [NO_ICONS, ...names()]

export const iconThemeLabel = (id: string): string =>
  id === NO_ICONS ? 'none' : (registry[id]?.name ?? id)

export const isIconThemeName = (value: unknown): value is string =>
  typeof value === 'string' && (value === NO_ICONS || value in registry)

/**
 * The glyph for one tree row, or null when icons are off or the theme is gone —
 * a plugin can be uninstalled while its id is still in the config.
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
    return theme.folders[name] ?? (node.expanded ? theme.folderOpen : theme.folder)
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
