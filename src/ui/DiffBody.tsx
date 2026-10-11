import type { DiffRenderable, TreeSitterClient } from '@opentui/core'
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'

import {
  computeHighlights,
  filetypeForPath,
  getSyntaxStyle,
  highlightClient,
  STALE,
} from '../languages/highlight'
import type { Highlighted } from '../languages/highlight'
import { ui } from '../themes'
import { blend, HATCH, paneHighlights, paneLines } from './diffRows'
import type { DiffMode, PaneHighlight, PaneView } from './diffRows'
import { allowSelectionIn } from './selection'

type OnHighlight = (
  given: PaneHighlight[],
  context: { content: string }
) => Promise<PaneHighlight[] | undefined>

// A reused pane keeps its filetype: a pass under it must land as "no spans", not raw captures.
const NO_HIGHLIGHTS: OnHighlight = () => Promise.resolve([])

// Private upstream: the two code panes inside the `<diff>` renderable, read only through `panesOf`.
interface CodePane {
  y: number
  scrollY: number
  isDestroyed: boolean
  content: string
  filetype: string | undefined
  onHighlight?: OnHighlight
}

interface DiffPanes {
  leftCodeRenderable?: CodePane | null
  rightCodeRenderable?: CodePane | null
}

function panesOf(el: DiffRenderable): DiffPanes {
  return el as unknown as DiffPanes
}

const onlyHatch = new RegExp(`^${HATCH}+$`, 'u')

export interface DiffBodyProps {
  path: string
  oldText: string
  newText: string
  patch: string
  lines: number
  mode: DiffMode
  plain: boolean
  width: number
  onFocus: () => void
  onPickLine: (line: number | null) => void
}

export function DiffBody(props: DiffBodyProps) {
  // `<diff>` takes its client at construction only; a default would spin up a grammarless second one.
  const [client, setClient] = createSignal<
    TreeSitterClient | null | undefined
  >()
  onMount(async () => {
    setClient(await highlightClient())
  })

  let pane: DiffRenderable | undefined
  // The deferred attach must not fire after the section is gone (#70).
  let attachTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(attachTimer))

  // The ref is never called back on removal: every accessor on a destroyed pane throws.
  const livePanes = (): DiffPanes | null => {
    if (pane?.isDestroyed) {
      pane = undefined
    }
    return pane ? panesOf(pane) : null
  }

  const view = (): PaneView => (props.mode === 'split' ? 'split' : 'unified')
  const refs = createMemo(() => paneLines(props.patch, view()))

  const rows = () =>
    view() === 'split'
      ? Math.max(1, refs().left.length)
      : Math.max(1, props.lines)

  // Both documents once per text, whichever pane asks first.
  const docs = createMemo(() => {
    const filetype = filetypeForPath(props.path)
    const parse = async (text: string) => {
      const result = await computeHighlights(text, filetype)
      return result === STALE ? null : result
    }
    const pending = new Map<'old' | 'new', Promise<Highlighted | null>>()
    return (side: 'old' | 'new') => {
      let doc = pending.get(side)
      if (!doc) {
        doc = parse(side === 'old' ? props.oldText : props.newText)
        pending.set(side, doc)
      }
      return doc
    }
  })

  const highlighter = (which: 'left' | 'right'): OnHighlight => {
    const sideRefs = refs()[which]
    const doc = docs()
    return async (_given, context) => {
      const [old, now] = await Promise.all([doc('old'), doc('new')])
      return paneHighlights(sideRefs, context.content, { new: now, old })
    }
  }

  // `setLineColor` cannot put text in a padding row; exact only because `wrapMode` is `none`.
  const paintHatch = (panes: DiffPanes) => {
    if (view() !== 'split') {
      return
    }
    // Not the pane's width: it is a layout behind, and a bar cut short stays that length.
    const bar = HATCH.repeat(Math.max(1, props.width))
    for (const which of ['left', 'right'] as const) {
      const code =
        which === 'left' ? panes.leftCodeRenderable : panes.rightCodeRenderable
      if (!code || code.isDestroyed) {
        continue
      }
      const lines = code.content.split('\n')
      let hatched = false
      for (const [row, ref] of refs()[which].entries()) {
        const line = lines[row]
        if (ref || line === undefined || line === bar) {
          continue
        }
        if (line !== '' && !onlyHatch.test(line)) {
          continue
        }
        lines[row] = bar
        hatched = true
      }
      if (hatched) {
        code.content = lines.join('\n')
      }
    }
  }

  // A tick after the renderable's microtask rebuild; theme and width are read, both rebuild panes.
  createEffect(
    on(
      [
        refs,
        docs,
        client,
        () => props.plain,
        () => props.width,
        () => ui.dim,
        () => ui.solidBg,
      ],
      () => {
        clearTimeout(attachTimer)
        attachTimer = setTimeout(() => {
          attachTimer = undefined
          const panes = livePanes()
          if (!panes) {
            return
          }
          for (const which of ['left', 'right'] as const) {
            const code =
              which === 'left'
                ? panes.leftCodeRenderable
                : panes.rightCodeRenderable
            if (!code || code.isDestroyed) {
              continue
            }
            if (props.plain) {
              // A reused pane keeps the previous change's filetype; clearing it is what stops the parse.
              code.filetype = undefined
              code.onHighlight = NO_HIGHLIGHTS
            } else {
              code.onHighlight = highlighter(which)
            }
          }
          paintHatch(panes)
        }, 0)
      }
    )
  )

  // Split's panes are row-aligned by construction, so the new side answers a click on either.
  const lineAt = (y: number): number | null => {
    const code = livePanes()?.leftCodeRenderable
    if (!code || code.isDestroyed) {
      return null
    }
    const list = view() === 'split' ? refs().right : refs().left
    const row = y - code.y + code.scrollY
    for (let at = Math.max(0, row); at < list.length; at += 1) {
      if (list[at]?.side === 'new') {
        return list[at]!.line
      }
    }
    // A deletion at the end of the file has no new line after it.
    for (let at = Math.min(row, list.length) - 1; at >= 0; at -= 1) {
      if (list[at]?.side === 'new') {
        return list[at]!.line
      }
    }
    return null
  }

  return (
    <Show
      when={props.patch !== '' && client() !== undefined}
      fallback={
        <box height={1} flexShrink={0} backgroundColor={ui.solidBg}>
          <text
            fg={ui.dim}
            bg={ui.solidBg}
            content={props.patch === '' ? '  No changes in this file' : ''}
          />
        </box>
      }
    >
      <box
        width="100%"
        flexShrink={0}
        backgroundColor={ui.solidBg}
        onMouseDown={(event: { y: number }) => {
          props.onFocus()
          props.onPickLine(lineAt(event.y))
        }}
      >
        <diff
          ref={(el: DiffRenderable) => {
            pane = el
            allowSelectionIn(el)
          }}
          diff={props.patch}
          view={view()}
          filetype={props.plain ? undefined : filetypeForPath(props.path)}
          syntaxStyle={getSyntaxStyle()}
          treeSitterClient={client() ?? undefined}
          syncScroll
          wrapMode="none"
          flexShrink={0}
          height={rows()}
          width="100%"
          fg={ui.text}
          lineNumberFg={ui.gutter}
          lineNumberBg={ui.solidBg}
          contextBg={ui.solidBg}
          addedBg={blend(ui.gitAdded, ui.solidBg, 0.14)}
          removedBg={blend(ui.gitDeleted, ui.solidBg, 0.14)}
          addedLineNumberBg={blend(ui.gitAdded, ui.solidBg, 0.28)}
          removedLineNumberBg={blend(ui.gitDeleted, ui.solidBg, 0.28)}
          addedSignColor={ui.gitAdded}
          removedSignColor={ui.gitDeleted}
          selectionBg={ui.treeSelectedBg}
        />
      </box>
    </Show>
  )
}
