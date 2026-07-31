import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { createMemo, For, Match, Switch } from 'solid-js'

import { ui } from '../themes'
import { keySectionsFor } from './keys'
import type { HelpSection, KeyScope } from './keys'
import { PAD } from './modal'

/** Columns between one column of the panel and the next. */
const GAP = 3
/** Columns between a key and its label. */
const KEY_GAP = 1
/** Keys sit one column in from their heading, as they do in the help overlay. */
const INDENT = 1
/** Narrowest a column may be squeezed to before a taller panel is the better trade. */
const MIN_COL = 24
/** Label columns a squeezed column keeps whatever that costs its key column. */
const MIN_LABEL = 8
/**
 * How much wider than the panel a column count may want before it is refused. A
 * split that overruns by a few columns clips the one longest label; refusing it
 * costs a column of the panel and several rows of height, which is far worse.
 */
const SQUEEZE = 1.08

const SCOPE_LABELS: Record<KeyScope, string> = {
  tree: 'file tree',
  editor: 'editor',
  git: 'source control',
}

type Line =
  | { kind: 'header'; text: string }
  | { kind: 'key'; key: string; label: string }
  | { kind: 'gap' }
  /** Stands where a column ran out of terminal, so nothing is dropped in silence. */
  | { kind: 'more' }

/** What a cut column ends on. The full table is the palette's "Keyboard shortcuts". */
const MORE = '… more (F1)'

const clip = (label: string, width: number) =>
  label.length > width ? `${label.slice(0, width - 1)}…` : label

/** Rows plus the heading above them. */
const blockHeight = (section: HelpSection) => section.rows.length + 1

/** How tall a column of sections stands, one blank line between neighbours. */
const columnHeight = (column: HelpSection[]) =>
  column.reduce((sum, section) => sum + blockHeight(section) + 1, -1)

/** Sections poured into columns in order, breaking whenever one would pass `limit`. */
function fill(sections: HelpSection[], limit: number): HelpSection[][] {
  const columns: HelpSection[][] = [[]]
  let used = 0
  for (const section of sections) {
    const current = columns.at(-1)!
    const cost = current.length > 0 ? blockHeight(section) + 1 : blockHeight(section)
    if (current.length > 0 && used + cost > limit) {
      columns.push([section])
      used = blockHeight(section)
      continue
    }
    current.push(section)
    used += cost
  }
  return columns
}

/**
 * Sections dealt into at most `cols` columns, in order, each as near the same
 * height as the rest — the shortest limit that still fits, found by bisection.
 * Pouring into a fixed target instead leaves the last column with everything the
 * earlier ones rounded away. A section is never split: a heading whose keys are
 * in the next column reads as a heading with nothing under it.
 */
function pack(sections: HelpSection[], cols: number): HelpSection[][] {
  let low = Math.max(...sections.map(blockHeight))
  let high = columnHeight(sections)
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (fill(sections, middle).length <= cols) high = middle
    else low = middle + 1
  }
  return fill(sections, low)
}

/** The width a column would like: its widest row, plus the gap to its neighbour. */
const naturalWidth = (column: HelpSection[]) =>
  Math.max(
    ...column.map(section => section.title.length),
    ...column.flatMap(section =>
      section.rows.map(([key, label]) => INDENT + key.length + KEY_GAP + label.length),
    ),
  ) + GAP

/**
 * Each column's share of the panel: its natural width, with what is left over split
 * evenly — or scaled down together when the columns want more than there is. Equal
 * shares instead would leave a column of short keys half empty beside one that clips.
 */
function shares(columns: HelpSection[][], inner: number): number[] {
  const naturals = columns.map(naturalWidth)
  const wanted = naturals.reduce((sum, width) => sum + width, 0)
  if (wanted > inner) return naturals.map(width => Math.floor((width * inner) / wanted))
  const extra = Math.floor((inner - wanted) / columns.length)
  return naturals.map(width => width + extra)
}

/** One column's sections flattened to display lines, with the widths to draw them at. */
function measure(column: HelpSection[], width: number, rows: number) {
  const all = column.flatMap<Line>((section, index) => [
    ...(index > 0 ? [{ kind: 'gap' } as const] : []),
    { kind: 'header', text: section.title },
    ...section.rows.map(([key, label]) => ({ kind: 'key', key, label }) as const),
  ])
  const kept = all.slice(0, rows - 1)
  // A column cut right after a heading's last key would end on the blank line that
  // separates sections, with the marker floating under it.
  while (kept.at(-1)?.kind === 'gap') kept.pop()
  const lines: Line[] = all.length > rows ? [...kept, { kind: 'more' }] : all
  const room = width - GAP - INDENT - KEY_GAP
  const keyWidth = Math.min(
    Math.max(0, ...column.flatMap(section => section.rows.map(([key]) => key.length))),
    Math.max(1, room - MIN_LABEL),
  )
  return { lines, keyWidth, labelWidth: Math.max(MIN_LABEL, room - keyWidth) }
}

/**
 * The Ctrl+K peek: every key alive in the current pane, grouped under the same
 * headings the help overlay uses, as a panel sitting on the status bar. Opened by
 * a key and closed by the next one, so it reads as "hold to see" without needing
 * key-release events no classic terminal sends.
 */
export function KeyPeek(props: { pane: KeyScope }) {
  const dimensions = useTerminalDimensions()

  const layout = createMemo(() => {
    const sections = keySectionsFor(props.pane)
    const inner = dimensions().width - 2 - PAD * 2
    const maxCols = Math.max(1, Math.min(sections.length, Math.floor(inner / MIN_COL)))

    // The widest split the panel can hold — measured on the columns the split
    // actually produces, since a column of one-word keys needs far less room than
    // the widest row in the table would suggest.
    let columns = pack(sections, 1)
    for (let cols = maxCols; cols > 1; cols--) {
      const candidate = pack(sections, cols)
      const wanted = candidate.map(naturalWidth).reduce((sum, width) => sum + width, 0)
      if (wanted <= inner * SQUEEZE) {
        columns = candidate
        break
      }
    }
    // The panel must leave the editor visible; past the cap, columns squeeze instead.
    const maxRows = Math.max(1, dimensions().height - 6)
    for (
      let cols = columns.length + 1;
      cols <= maxCols && Math.max(...columns.map(columnHeight)) > maxRows;
      cols++
    ) {
      columns = pack(sections, cols)
    }

    const widths = shares(columns, inner)
    // A terminal too short for even the widest split gets what fits: the panel has
    // no scroll, and one that overran would push its own title off the screen.
    const rows = Math.min(Math.max(...columns.map(columnHeight)), maxRows)
    return columns.map((column, at) => ({
      width: widths[at]!,
      ...measure(column, widths[at]!, rows),
    }))
  })

  const rows = () => Math.max(...layout().map(column => column.lines.length))

  return (
    <box
      position="absolute"
      left={0}
      top={dimensions().height - 3 - rows()}
      width="100%"
      flexDirection="row"
      backgroundColor={ui.panelBg}
      border
      borderStyle="rounded"
      borderColor={ui.accent}
      title={` Keys · ${SCOPE_LABELS[props.pane]} · any key closes `}
      titleColor={ui.text}
      paddingLeft={PAD}
      paddingRight={PAD}
      zIndex={90}
    >
      <For each={layout()}>
        {column => (
          <box width={column.width} flexShrink={0} flexDirection="column">
            <For each={column.lines}>
              {line => (
                <box height={1} flexDirection="row" backgroundColor={ui.panelBg}>
                  <Switch>
                    <Match when={line.kind === 'header' && line}>
                      {(header: () => { text: string }) => (
                        <text
                          fg={ui.accent}
                          bg={ui.panelBg}
                          content={header().text}
                          attributes={TextAttributes.BOLD}
                        />
                      )}
                    </Match>
                    <Match when={line.kind === 'key' && line}>
                      {(row: () => { key: string; label: string }) => (
                        <>
                          <text
                            fg={ui.text}
                            bg={ui.panelBg}
                            content={
                              ' '.repeat(INDENT) +
                              clip(row().key, column.keyWidth).padEnd(column.keyWidth)
                            }
                          />
                          <text
                            fg={ui.dim}
                            bg={ui.panelBg}
                            content={' '.repeat(KEY_GAP) + clip(row().label, column.labelWidth)}
                          />
                        </>
                      )}
                    </Match>
                    <Match when={line.kind === 'more'}>
                      <text
                        fg={ui.dim}
                        bg={ui.panelBg}
                        content={` ${clip(MORE, column.width - GAP)}`}
                      />
                    </Match>
                  </Switch>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
