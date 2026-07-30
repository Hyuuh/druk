import { createMemo, For, Show } from 'solid-js'

import { kindInfo, matchRuns } from '../lsp/completion'
import type { KindGroup, Match } from '../lsp/completion'
import { ui } from '../themes'

/** Content rows the menu shows at most; more items scroll behind a counter row. */
export const MENU_ROWS = 8
/** Space the label column may take before it is cut. */
const LABEL_MAX = 40
const DETAIL_MAX = 28
const MIN_WIDTH = 22

export interface CompletionMenuProps {
  matches: Match[]
  selected: number
  /** Placement inside the pane box, already flipped/clamped by EditorPane. */
  top: number
  left: number
  width: number
}

/** Read at paint time: `ui` is a store, a module-scope table would freeze a theme. */
const GROUP_COLORS: Record<KindGroup, () => string> = {
  fn: () => ui.accent,
  var: () => ui.gitModified,
  type: () => ui.folder,
  module: () => ui.gitAdded,
  keyword: () => ui.dim,
  text: () => ui.dim,
}

/**
 * Width the menu wants for these matches: glyph, label, gap, detail — capped so
 * one verbose signature does not push the box across the pane. EditorPane clamps
 * the answer to the room the pane actually has.
 */
export function menuWidth(matches: Match[]): number {
  let label = 0
  let detail = 0
  for (const match of matches.slice(0, MENU_ROWS)) {
    label = Math.max(label, Math.min(match.item.label.length, LABEL_MAX))
    detail = Math.max(detail, Math.min(match.item.detail?.length ?? 0, DETAIL_MAX))
  }
  // bar + glyph+space + label + gap + detail + pad, plus the border pair.
  return Math.max(MIN_WIDTH, 1 + 2 + label + (detail > 0 ? 2 + detail : 0) + 1 + 2)
}

const cut = (text: string, room: number) =>
  text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text

/**
 * The completion popup. Purely presentational: EditorPane owns every decision —
 * what is in the list, what is selected, where the box sits — so this stays a
 * painter that a test can drive through the real keyboard flow.
 */
export function CompletionMenu(props: CompletionMenuProps) {
  const windowed = createMemo(() => {
    const start = Math.max(
      0,
      Math.min(props.selected - MENU_ROWS + 1, props.matches.length - MENU_ROWS),
    )
    return { start, rows: props.matches.slice(start, start + MENU_ROWS) }
  })
  /** Columns inside the border. */
  const inner = () => props.width - 2

  return (
    <box
      position="absolute"
      top={props.top}
      left={props.left}
      width={props.width}
      zIndex={30}
      flexDirection="column"
      backgroundColor={ui.panelBg}
      border
      borderStyle="rounded"
      borderColor={ui.scrollbar}
    >
      <Show
        when={props.matches.length > 0}
        fallback={<text fg={ui.dim} bg={ui.panelBg} content=" No suggestions" />}
      >
        <For each={windowed().rows}>
          {(match, i) => {
            const active = () => windowed().start + i() === props.selected
            const bg = () => (active() ? ui.treeSelectedBg : ui.panelBg)
            const kind = kindInfo(match.item.kind)
            // Detail gets what the label leaves over, never less than a stub.
            const labelRoom = Math.min(Math.max(match.item.label.length, 1), inner() - 4)
            const detailRoom = () => inner() - 4 - labelRoom - 2
            return (
              <box flexDirection="row" backgroundColor={bg()}>
                <text fg={ui.accent} bg={bg()} flexShrink={0} content={active() ? '▌' : ' '} />
                <text
                  fg={GROUP_COLORS[kind.group]()}
                  bg={bg()}
                  flexShrink={0}
                  content={`${kind.glyph} `}
                />
                <box flexDirection="row" flexGrow={1}>
                  <For each={matchRuns(cut(match.item.label, labelRoom), match.positions)}>
                    {run => (
                      <text
                        fg={run.hit ? ui.accent : active() ? ui.text : ui.dim}
                        bg={bg()}
                        content={run.text}
                      />
                    )}
                  </For>
                </box>
                <Show when={match.item.detail && detailRoom() >= 4}>
                  <text
                    fg={ui.faint}
                    bg={bg()}
                    flexShrink={0}
                    content={` ${cut(match.item.detail!.replaceAll(/\s+/g, ' '), detailRoom())} `}
                  />
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={props.matches.length > MENU_ROWS}>
          <box flexDirection="row" backgroundColor={ui.panelBg}>
            <box flexGrow={1} backgroundColor={ui.panelBg} />
            <text
              fg={ui.faint}
              bg={ui.panelBg}
              content={`${props.selected + 1}/${props.matches.length} `}
            />
          </box>
        </Show>
      </Show>
    </box>
  )
}
