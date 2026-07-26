import type { StyleDefinitionInput } from '@opentui/core'

/** Colors for chrome: panels, tabs, tree, status bar, cursor. */
export interface ThemeUi {
  bg: string
  panelBg: string
  barBg: string
  statusBg: string
  statusFg: string
  text: string
  dim: string
  faint: string
  accent: string
  activeTabBg: string
  activeTabFg: string
  inactiveTabBg: string
  inactiveTabFg: string
  treeSelectedBg: string
  treeFocusBg: string
  dirty: string
  error: string
  folder: string
  cursor: string
  scrollbar: string
  /** Panel/pane separators and modal borders. */
  border: string
  /** Line-number gutter foreground. */
  gutter: string
  /** Background fill behind the line the cursor is on. Keep it near `bg`. */
  currentLine: string
  /** Indent guide column. Barely off `bg` — it should read as a hint, not a rule. */
  indentGuide: string
  /** Accent used on the active tab's underline. */
  tabAccent: string
  /** Git gutter marks. */
  gitAdded: string
  gitModified: string
  gitDeleted: string
}

/**
 * `syntax` maps tree-sitter capture groups to styles. Sub-scopes fall back to
 * their parent ("type.builtin" → "type"), so listing base scopes is enough.
 */
export interface Theme {
  name: string
  ui: ThemeUi
  syntax: Record<string, StyleDefinitionInput>
}
