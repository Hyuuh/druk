import { RGBA, StyledText } from '@opentui/core'
import type {
  LineNumberRenderable,
  LineSign,
  TextChunk,
  TextRenderable,
} from '@opentui/core'
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'

import { layoutDiff, parseHunks, splitLines } from '../core/diffModel'
import type { LineRow, PaneRow, Range } from '../core/diffModel'
import {
  computeHighlights,
  filetypeForPath,
  STALE,
} from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { paintedTheme, ui } from '../themes'
import { paintLine } from './codeSpans'
import type { Span } from './codeSpans'
import { blend, HATCH } from './diffRows'
import type { DiffMode } from './diffRows'
import { allowSelectionIn } from './selection'
import { cut } from './text'

export type GapState = 'all' | ReadonlySet<number>

export interface DiffQuery {
  text: string
  caseSensitive: boolean
}

export interface DiffHit {
  pane: 'left' | 'right'
  row: number
  start: number
  end: number
}

// Offsets are visual rows from the body's first row.
export interface DiffLocator {
  hunkOffsets: () => number[]
  hits: () => { hit: DiffHit; offset: number }[]
  gapCount: () => number
}

export interface DiffBodyProps {
  path: string
  oldText: string
  newText: string
  patch: string
  truncated: boolean
  mode: DiffMode
  plain: boolean
  wrap: boolean
  width: number
  gaps: GapState
  query: DiffQuery | null
  current: DiffHit | null
  onFocus: () => void
  onPickLine: (line: number | null) => void
  onToggleGap: (gap: number) => void
  onLocator: (locator: DiffLocator | null) => void
}

type ContentRow = PaneRow | { kind: 'wrap' }

interface PaneData {
  text: StyledText
  numbers: Map<number, number>
  hidden: Set<number>
  signs: Map<number, LineSign>
  colors: Map<number, { gutter: string; content: string }>
}

const rgbaCache = new Map<string, RGBA>()
const rgba = (hex: string) => {
  let hit = rgbaCache.get(hex)
  if (!hit) {
    hit = RGBA.fromHex(hex)
    rgbaCache.set(hex, hit)
  }
  return hit
}

const chunk = (
  text: string,
  fg: string,
  bg?: string,
  attributes?: number
): TextChunk => ({
  __isChunk: true,
  attributes,
  bg: bg ? rgba(bg) : undefined,
  fg: rgba(fg),
  text,
})

interface Paint {
  from: number
  to: number
  bg: string
}

// Later paints win where they overlap: words first, then search marks over them.
function overlay(
  spans: readonly Span[],
  paints: readonly Paint[]
): TextChunk[] {
  const cuts = new Set<number>()
  for (const paint of paints) {
    cuts.add(paint.from)
    cuts.add(paint.to)
  }
  const bgAt = (col: number) =>
    paints.findLast((paint) => col >= paint.from && col < paint.to)?.bg
  const out: TextChunk[] = []
  let col = 0
  for (const span of spans) {
    const fg = span.fg ?? ui.text
    let start = 0
    for (let i = 1; i <= span.text.length; i += 1) {
      if (i === span.text.length || cuts.has(col + i)) {
        out.push(
          chunk(
            span.text.slice(start, i),
            fg,
            bgAt(col + start),
            span.attributes
          )
        )
        start = i
      }
    }
    col += span.text.length
  }
  return out
}

export function findHits(text: string, query: DiffQuery): Range[] {
  if (query.text === '') {
    return []
  }
  const hay = query.caseSensitive ? text : text.toLowerCase()
  const needle = query.caseSensitive ? query.text : query.text.toLowerCase()
  const out: Range[] = []
  let at = hay.indexOf(needle)
  while (at !== -1) {
    out.push([at, at + needle.length])
    at = hay.indexOf(needle, at + needle.length)
  }
  return out
}

export function DiffBody(props: DiffBodyProps) {
  const oldLines = createMemo(() => splitLines(props.oldText))
  const newLines = createMemo(() => splitLines(props.newText))
  const hunks = createMemo(() => parseHunks(props.patch))
  const view = () => (props.mode === 'split' ? 'split' : 'unified')

  const gapTotal = createMemo(() => hunks().length + 1)
  const expanded = createMemo(() => {
    const { gaps } = props
    return gaps === 'all'
      ? new Set(Array.from({ length: gapTotal() }, (_, i) => i))
      : gaps
  })

  const layout = createMemo(() =>
    layoutDiff({
      complete: !props.truncated,
      expanded: expanded(),
      hunks: hunks(),
      newLines: newLines(),
      oldLines: oldLines(),
      view: view(),
    })
  )

  const [docs, setDocs] = createSignal<{
    old: Highlighted | null
    new: Highlighted | null
  }>({ new: null, old: null })
  createEffect(
    on(
      () => [props.path, props.oldText, props.newText, props.plain] as const,
      ([path, oldText, newText, plain]) => {
        setDocs({ new: null, old: null })
        const filetype = filetypeForPath(path)
        if (plain || !filetype) {
          return
        }
        let dropped = false
        onCleanup(() => {
          dropped = true
        })
        const parse = async (text: string) => {
          const result = await computeHighlights(
            text,
            filetype,
            2,
            () => dropped
          )
          return result === STALE ? null : result
        }
        void (async () => {
          const [old, now] = await Promise.all([parse(oldText), parse(newText)])
          if (!dropped) {
            setDocs({ new: now, old })
          }
        })()
      }
    )
  )

  let leftText: TextRenderable | undefined
  let rightText: TextRenderable | undefined
  const [measured, setMeasured] = createSignal(0)
  const remeasure = () => setMeasured((n) => n + 1)
  const [textWidth, setTextWidth] = createSignal(0)

  // Split + wrap: a row that wraps further on one side pads the other, or the sides drift apart.
  const [wrapPads, setWrapPads] = createSignal<Map<number, number>>(new Map())

  const contentRows = (side: 'left' | 'right'): ContentRow[] => {
    const rows = side === 'left' ? layout().left : layout().right
    if (!rows) {
      return []
    }
    const pads = props.wrap && view() === 'split' ? wrapPads() : null
    if (!pads || pads.size === 0) {
      return rows
    }
    const out: ContentRow[] = []
    for (const [i, row] of rows.entries()) {
      out.push(row)
      const pad = pads.get(i) ?? 0
      const mine = side === 'left' ? pad : -pad
      for (let k = 0; k < mine; k += 1) {
        out.push({ kind: 'wrap' })
      }
    }
    return out
  }
  const leftRows = createMemo(() => contentRows('left'))
  const rightRows = createMemo(() => contentRows('right'))

  const textOf = (row: LineRow) =>
    (row.side === 'old' ? oldLines() : newLines())[row.line] ?? ''

  const hitsBy = createMemo(() => {
    const { query } = props
    const out: DiffHit[] = []
    if (!query || query.text === '') {
      return out
    }
    const split = view() === 'split'
    const scan = (rows: ContentRow[], pane: 'left' | 'right') => {
      for (const [row, item] of rows.entries()) {
        // Split shows a context line twice; it is one hit, read on the new side.
        if (
          item.kind !== 'line' ||
          (split && pane === 'left' && item.type === 'same')
        ) {
          continue
        }
        for (const [start, end] of findHits(textOf(item), query)) {
          out.push({ end, pane, row, start })
        }
      }
    }
    scan(leftRows(), 'left')
    if (split) {
      scan(rightRows(), 'right')
    }
    return out.toSorted(
      (a, b) =>
        a.row - b.row ||
        (a.pane === b.pane ? 0 : a.pane === 'left' ? -1 : 1) ||
        a.start - b.start
    )
  })

  const gapCount = (count: number) =>
    `⋯ ${count} unchanged line${count === 1 ? '' : 's'}`

  const paneData = (rows: ContentRow[], pane: 'left' | 'right'): PaneData => {
    paintedTheme()
    const numbers = new Map<number, number>()
    const hidden = new Set<number>()
    const signs = new Map<number, LineSign>()
    const colors = new Map<number, { gutter: string; content: string }>()
    const chunks: TextChunk[] = []
    const { old, new: now } = docs()
    const room = props.wrap ? textWidth() : props.width
    const hatch = HATCH.repeat(Math.max(1, room))
    const tint = (color: string, amount: number) =>
      blend(color, ui.solidBg, amount)
    const gapBg = tint(ui.accent, 0.07)
    const hits = hitsBy()
    const { current } = props

    let padding = false
    for (const [i, row] of rows.entries()) {
      if (i > 0) {
        chunks.push(chunk('\n', ui.text))
      }
      if (row.kind === 'wrap' || row.kind === 'pad') {
        hidden.add(i)
        // A wrap row continues whatever it follows, so one under a pad is hatched too.
        padding = row.kind === 'pad' || padding
        if (padding) {
          chunks.push(chunk(hatch, blend(ui.dim, ui.solidBg, 0.35)))
        }
        continue
      }
      padding = false
      if (row.kind === 'gap') {
        hidden.add(i)
        colors.set(i, { content: gapBg, gutter: gapBg })
        // Split has a pane per half: the count on the left, the scope on the right.
        const split = view() === 'split'
        const count = pane === 'left' ? gapCount(row.count) : ''
        const scope = (split && pane === 'left') || !row.scope ? '' : row.scope
        const budget = Math.max(4, (split ? Math.floor(room / 2) : room) - 8)
        if (count) {
          chunks.push(chunk(cut(count, budget), ui.dim))
        }
        if (scope) {
          const lead = count ? '  ' : ''
          chunks.push(
            chunk(
              cut(`${lead}${scope}`, Math.max(0, budget - count.length)),
              ui.text
            )
          )
        }
        continue
      }
      numbers.set(i, row.line + 1)
      const text = textOf(row)
      const doc = row.side === 'old' ? old : now
      const spans: Span[] = doc
        ? paintLine(doc, text, row.line, ui.text)
        : [{ fg: ui.text, text }]
      const paints: Paint[] = []
      if (row.type !== 'same') {
        const base = row.moved
          ? ui.accent
          : row.type === 'add'
            ? ui.gitAdded
            : ui.gitDeleted
        colors.set(i, { content: tint(base, 0.14), gutter: tint(base, 0.28) })
        signs.set(i, {
          after: row.type === 'add' ? ' +' : ' -',
          afterColor: row.moved ? ui.accent : base,
        })
        for (const [from, to] of row.words) {
          paints.push({ bg: tint(base, 0.36), from, to })
        }
      }
      for (const hit of hits) {
        if (hit.row === i && hit.pane === pane) {
          const isCurrent =
            current?.row === i &&
            current.pane === pane &&
            current.start === hit.start
          paints.push({
            bg: tint(ui.dirty, isCurrent ? 0.6 : 0.3),
            from: hit.start,
            to: hit.end,
          })
        }
      }
      chunks.push(...overlay(spans, paints))
    }
    return { colors, hidden, numbers, signs, text: new StyledText(chunks) }
  }

  const leftData = createMemo(() => paneData(leftRows(), 'left'))
  const rightData = createMemo(() =>
    view() === 'split' ? paneData(rightRows(), 'right') : null
  )

  const applyGutter = (
    gutter: LineNumberRenderable | undefined,
    data: PaneData | null
  ) => {
    if (!gutter || gutter.isDestroyed || !data) {
      return
    }
    gutter.setLineNumbers(data.numbers)
    gutter.setHideLineNumbers(data.hidden)
    gutter.setLineSigns(data.signs)
    gutter.setLineColors(data.colors)
  }
  let leftGutter: LineNumberRenderable | undefined
  let rightGutter: LineNumberRenderable | undefined
  createEffect(() => applyGutter(leftGutter, leftData()))
  createEffect(() => applyGutter(rightGutter, rightData()))

  // The reconciler stringifies a StyledText handed to `content`: it is set on the renderable.
  const [leftEl, setLeftEl] = createSignal<TextRenderable>()
  const [rightEl, setRightEl] = createSignal<TextRenderable>()
  const applyText = (el: TextRenderable | undefined, data: PaneData | null) => {
    if (el && !el.isDestroyed && data) {
      el.content = data.text
    }
  }
  createEffect(() => applyText(leftEl(), leftData()))
  createEffect(() => applyText(rightEl(), rightData()))

  const visualCounts = (el: TextRenderable | undefined, rows: ContentRow[]) => {
    const counts = new Map<number, number>()
    if (!el || el.isDestroyed) {
      return counts
    }
    let logical = -1
    const toLogical: number[] = []
    for (const row of rows) {
      if (row.kind !== 'wrap') {
        logical += 1
      }
      toLogical.push(row.kind === 'wrap' ? -1 : logical)
    }
    for (const source of el.lineInfo.lineSources) {
      const at = toLogical[source] ?? -1
      if (at >= 0) {
        counts.set(at, (counts.get(at) ?? 0) + 1)
      }
    }
    return counts
  }

  createEffect(
    on([measured, () => props.wrap, view, layout], () => {
      if (!props.wrap || view() !== 'split') {
        if (wrapPads().size > 0) {
          setWrapPads(new Map())
        }
        return
      }
      const left = visualCounts(leftText, leftRows())
      const right = visualCounts(rightText, rightRows())
      if (left.size === 0 || right.size === 0) {
        return
      }
      const pads = new Map<number, number>()
      for (const [row, count] of left) {
        const diff = (right.get(row) ?? 1) - count
        if (diff !== 0) {
          pads.set(row, diff)
        }
      }
      const same =
        pads.size === wrapPads().size &&
        [...pads].every(([row, n]) => wrapPads().get(row) === n)
      if (!same) {
        setWrapPads(pads)
      }
    })
  )

  const visualOf = (row: number): number => {
    if (!props.wrap || !leftText || leftText.isDestroyed) {
      return row
    }
    const at = leftText.lineInfo.lineSources.indexOf(row)
    return at === -1 ? row : at
  }

  const rowAt = (pane: 'left' | 'right', visual: number): number => {
    const el = pane === 'left' ? leftText : rightText
    if (!props.wrap || !el || el.isDestroyed) {
      return visual
    }
    return el.lineInfo.lineSources[visual] ?? -1
  }

  onMount(() => {
    props.onLocator({
      gapCount: () => layout().gaps.filter(Boolean).length,
      hits: () => hitsBy().map((hit) => ({ hit, offset: visualOf(hit.row) })),
      hunkOffsets: () => {
        // Content rows, not layout rows: split + wrap pads sit between them.
        const rows = leftRows()
        const marks = new Map<PaneRow, number>()
        for (const [i, row] of rows.entries()) {
          if (row.kind !== 'wrap') {
            marks.set(row, i)
          }
        }
        return layout().hunkRows.map((at) =>
          visualOf(marks.get(layout().left[at]!) ?? at)
        )
      },
    })
  })
  onCleanup(() => props.onLocator(null))

  const newSideRows = () => (view() === 'split' ? rightRows() : leftRows())

  // Split's panes are row-aligned by construction, so the new side answers a click on either.
  const lineAt = (row: number): number | null => {
    const list = newSideRows()
    const isNew = (item: ContentRow | undefined) =>
      item?.kind === 'line' && item.side === 'new'
    for (let at = Math.max(0, row); at < list.length; at += 1) {
      if (isNew(list[at])) {
        return (list[at] as LineRow).line
      }
    }
    // A deletion at the end of the file has no new line after it.
    for (let at = Math.min(row, list.length) - 1; at >= 0; at -= 1) {
      if (isNew(list[at])) {
        return (list[at] as LineRow).line
      }
    }
    return null
  }

  const press = (event: { x: number; y: number }) => {
    props.onFocus()
    const el = leftText
    if (!el || el.isDestroyed) {
      return
    }
    const pane =
      rightText && !rightText.isDestroyed && event.x >= rightText.x
        ? 'right'
        : 'left'
    const row = rowAt(pane, event.y - el.y)
    const item = (pane === 'left' ? leftRows() : rightRows())[row]
    if (item?.kind === 'gap') {
      props.onToggleGap(item.gap)
      return
    }
    props.onPickLine(lineAt(row))
  }

  const wrapMode = () => (props.wrap ? 'word' : 'none')

  const pane = (side: 'left' | 'right') => {
    const data = () => (side === 'left' ? leftData() : rightData())
    return (
      <line_number
        ref={(el: LineNumberRenderable) => {
          if (side === 'left') {
            leftGutter = el
          } else {
            rightGutter = el
          }
          applyGutter(el, data())
        }}
        target={(side === 'left' ? leftEl() : rightEl()) ?? undefined}
        fg={ui.gutter}
        bg={ui.solidBg}
        width={view() === 'split' ? '50%' : '100%'}
        flexShrink={0}
      >
        <text
          ref={(el: TextRenderable) => {
            if (side === 'left') {
              leftText = el
              setLeftEl(el)
            } else {
              rightText = el
              setRightEl(el)
            }
            allowSelectionIn(el)
            el.on('line-info-change', () => {
              if (side === 'left') {
                setTextWidth(el.width)
              }
              remeasure()
            })
          }}
          wrapMode={wrapMode()}
          fg={ui.text}
          selectionBg={ui.treeSelectedBg}
          flexGrow={1}
        />
      </line_number>
    )
  }
  return (
    <Show
      when={props.patch !== ''}
      fallback={
        <box height={1} flexShrink={0} backgroundColor={ui.solidBg}>
          <text
            fg={ui.dim}
            bg={ui.solidBg}
            content="  No changes in this file"
          />
        </box>
      }
    >
      <box
        width="100%"
        flexShrink={0}
        flexDirection="row"
        backgroundColor={ui.solidBg}
        onMouseDown={press}
      >
        {pane('left')}
        <Show when={view() === 'split'}>{pane('right')}</Show>
      </box>
    </Show>
  )
}
