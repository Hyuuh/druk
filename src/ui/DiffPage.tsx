import type { KeyEvent, ScrollBoxRenderable } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js'
import type { Accessor } from 'solid-js'

import { ui } from '../themes'
import { DiffBody } from './DiffBody'
import { DiffHeadingView } from './DiffHeading'
import type { DiffHeading, DiffKey, DiffStats } from './DiffHeading'
import {
  DIFF_MAX_LINES,
  diffMark,
  diffStatusColor,
  diffStatusLabel,
} from './diffRows'
import type { DiffFileStatus, DiffMode } from './diffRows'
import { useHoverKey } from './hover'
import {
  followScroll,
  keepScroll,
  keptScroll,
  LAYOUT_FRAME,
  retryFrames,
  scrollbarOptions,
} from './list'
import { PageFrame } from './PanelHeader'
import { cut } from './text'
import { useKeys } from './useKeys'

export type ViewedMark = 'viewed' | 'unviewed' | 'dismissed'

export interface DiffSectionBody {
  path: string
  oldText: string
  newText: string
  patch: string
  lines: number
  adds: number
  dels: number
  truncated: boolean
  plain: boolean
}

export interface DiffSection {
  key: string
  rel: string
  oldRel: string | null
  status: DiffFileStatus
  badge: string | null
  stage: 'stage' | 'unstage' | null
  viewed: ViewedMark | null
  folded: boolean
  // undefined while there is no text yet; null when there is none to diff (binary, unreadable).
  body: DiffSectionBody | null | undefined
  note: string | null
  adds: number | null
  dels: number | null
}

export type DiffMeta = DiffStats

export interface DiffPageProps {
  heading: DiffHeading
  sections: DiffSection[]
  meta: DiffMeta
  focusKey: string | null
  // Where the page keeps its offset while another tab is up; one per page kind.
  scrollKey: string
  mode: DiffMode
  width: number
  focused: boolean
  blocked: boolean
  empty: string
  escLabel?: string
  // Page-specific keys for the header, between the shared ones.
  keys?: { key: string; label: string }[]
  onFocus: () => void
  onToggleMode: () => void
  onClose: () => void
  onFold: (key: string, folded: boolean) => void
  onOpen?: (key: string, line: number | null) => void
  onAction?: (key: string) => void
  onKey?: (k: string, key: KeyEvent) => boolean
}

export interface StickyHeader {
  index: number
  // Rows of the header pushed off the top; 0 = fully stuck.
  clipped: number
}

const HEADER_ROWS = 2

const HEADER_MARK = 1

const REVEAL_TRIES = 30

// Frames a re-anchor keeps re-applying: the scrollbox clamps against the height it still has.
const HOLD_FRAMES = 6

// The file each page's reveal last served: the page is a tab and unmounts behind every other one.
const served = new Map<string, string>()

// `ys`: content-space y of each header's first row, in section order. Null when nothing pins.
export function stickyHeader(
  scrollTop: number,
  ys: number[]
): StickyHeader | null {
  if (ys.length === 0 || ys.some((y) => !Number.isFinite(y))) {
    return null
  }
  let index = -1
  for (let i = 0; i < ys.length && ys[i]! <= scrollTop; i += 1) {
    index = i
  }
  if (index < 0 || ys[index]! >= scrollTop) {
    return null
  }
  const next = ys[index + 1]
  if (next === undefined) {
    return { clipped: 0, index }
  }
  const room = next - scrollTop
  if (room <= 0) {
    return null
  }
  return { clipped: Math.max(0, HEADER_ROWS - room), index }
}

const viewedLabel = (viewed: ViewedMark) =>
  viewed === 'viewed' ? '[✓] viewed' : '[ ] viewed'

function cutPath(rel: string, room: number): string {
  if (room <= 0) {
    return ''
  }
  return rel.length <= room ? rel : `…${rel.slice(rel.length - room + 1)}`
}

function displayRel(section: DiffSection): string {
  return section.oldRel && section.oldRel !== section.rel
    ? `${section.oldRel} → ${section.rel}`
    : section.rel
}

export function sectionMeta(section: DiffSection): string {
  const bits: string[] = []
  if (section.adds !== null && section.dels !== null) {
    bits.push(`+${section.adds} −${section.dels}`)
  }
  if (section.badge) {
    bits.push(section.badge)
  }
  if (section.viewed === 'dismissed') {
    bits.push('changed since viewed')
  }
  if (section.body?.truncated) {
    bits.push(`first ${DIFF_MAX_LINES} lines`)
  } else if (section.body?.plain) {
    bits.push('plain (large file)')
  }
  if (section.note) {
    bits.push(section.note)
  }
  return `  ${bits.join(' · ')}`
}

interface FileHeaderProps {
  section: DiffSection
  width: number
  part: 'full' | 'meta'
  hovered: boolean
  selected: boolean
  onToggle: () => void
  onAction?: () => void
  onEnter: () => void
  onLeave: () => void
}

function FileHeader(props: FileHeaderProps) {
  const button = useHoverKey<string>()
  const bg = () =>
    props.selected
      ? ui.treeSelectedBg
      : props.hovered
        ? ui.hoverBg
        : ui.solidBarBg
  const mark = () => (props.selected ? ui.accent : bg())
  const label = () => diffStatusLabel(props.section.status)
  const color = () => diffStatusColor(props.section.status)
  const chevron = () => (props.section.folded ? '▸' : '▾')
  const textWidth = () => Math.max(8, props.width - HEADER_MARK)

  // Viewed is state and always drawn; staging is an action, drawn where the reader is.
  const actionText = () => {
    const { section } = props
    if (section.viewed) {
      return ` ${viewedLabel(section.viewed)} `
    }
    if (section.stage && (props.selected || props.hovered)) {
      return `${section.stage === 'unstage' ? '−' : '+'} `
    }
    return null
  }
  // Held whether or not the button is drawn, or the path jumps as the selection walks past.
  const actionRoom = () => {
    const { section } = props
    if (section.viewed) {
      return viewedLabel(section.viewed).length + 2
    }
    return section.stage ? 2 : 0
  }
  const actionColor = () =>
    props.section.viewed === 'viewed' ? ui.gitAdded : ui.accent

  const path = () => {
    const word = label()
    const right = word ? ` ${word} ` : ''
    const prefix = ` ${chevron()} ${diffMark(props.section.status)} `
    const room = Math.max(
      8,
      textWidth() - prefix.length - right.length - actionRoom()
    )
    return cutPath(displayRel(props.section), room)
  }
  const meta = () => cut(sectionMeta(props.section), textWidth())

  return (
    <box flexShrink={0} flexDirection="column" backgroundColor={bg()}>
      <Show when={props.part === 'full'}>
        <box
          height={1}
          flexDirection="row"
          flexShrink={0}
          backgroundColor={bg()}
          onMouseDown={() => props.onToggle()}
          onMouseOver={() => props.onEnter()}
          onMouseOut={() => props.onLeave()}
        >
          <text
            wrapMode="none"
            fg={mark()}
            bg={mark()}
            flexShrink={0}
            content=" "
          />
          <text
            wrapMode="none"
            fg={ui.dim}
            bg={bg()}
            flexShrink={0}
            content={` ${chevron()} `}
          />
          <text
            wrapMode="none"
            fg={color()}
            bg={bg()}
            flexShrink={0}
            content={`${diffMark(props.section.status)} `}
          />
          <text
            wrapMode="none"
            fg={ui.text}
            bg={bg()}
            flexShrink={0}
            content={path()}
          />
          <box flexGrow={1} backgroundColor={bg()} />
          <Show when={label()}>
            {(word: Accessor<string>) => (
              <text
                wrapMode="none"
                fg={color()}
                bg={bg()}
                flexShrink={0}
                content={` ${word()} `}
              />
            )}
          </Show>
          {/* stopPropagation: a press on the button must not reach the row, which folds the file. */}
          <Show when={actionText()}>
            {(text: Accessor<string>) => (
              <box
                flexShrink={0}
                backgroundColor={button.hovered('action') ? ui.hoverBg : bg()}
                onMouseDown={(event) => {
                  event.stopPropagation()
                  props.onAction?.()
                }}
                onMouseOver={() => button.enter('action')}
                onMouseOut={() => button.leave('action')}
              >
                <text
                  wrapMode="none"
                  fg={actionColor()}
                  bg={button.hovered('action') ? ui.hoverBg : bg()}
                  content={text()}
                />
              </box>
            )}
          </Show>
        </box>
      </Show>
      <box
        height={1}
        flexDirection="row"
        flexShrink={0}
        backgroundColor={bg()}
        onMouseDown={() => props.onToggle()}
        onMouseOver={() => props.onEnter()}
        onMouseOut={() => props.onLeave()}
      >
        <text
          wrapMode="none"
          fg={mark()}
          bg={mark()}
          flexShrink={0}
          content=" "
        />
        <text
          wrapMode="none"
          fg={ui.dim}
          bg={bg()}
          flexShrink={0}
          content={meta()}
        />
        <box flexGrow={1} backgroundColor={bg()} />
      </box>
    </box>
  )
}

interface LaidOut {
  y: number
  height: number
}

const sameKeys = (a: string[], b: string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i])

export function DiffPage(props: DiffPageProps) {
  const dimensions = useTerminalDimensions()
  const hover = useHoverKey<string>()
  const [scrollTop, setScrollTop] = createSignal(keptScroll(props.scrollKey))
  const [pickedKey, setPickedKey] = createSignal<string | null>(null)
  const [pickedLine, setPickedLine] = createSignal<number | null>(null)
  // Bumped when the stack's geometry moved for a reason `scrollTop` cannot report.
  const [layout, bumpLayout] = createSignal(0, { equals: false })

  // Keyed by file, not by section object: a refresh rebuilds every section and must not
  // tear down a diff whose text did not change.
  const keys = createMemo(() => props.sections.map((s) => s.key), [], {
    equals: sameKeys,
  })
  const byKey = createMemo(
    () => new Map(props.sections.map((section) => [section.key, section]))
  )

  let box: ScrollBoxRenderable | undefined
  const anchors = new Map<string, LaidOut>()
  // Not a signal: never read while rendering.
  let drifted = false
  let cancelReveal: (() => void) | null = null
  let cancelHold: (() => void) | null = null
  let layoutTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    cancelReveal?.()
    cancelHold?.()
    clearTimeout(layoutTimer)
    keepScroll(props.scrollKey, scrollTop())
  })

  const syncScroll = () => {
    if (box) {
      setScrollTop(box.scrollTop)
    }
  }

  // Read off renderables, not signals: the reconciler flushes on a macrotask, so wait one out.
  const remeasure = () => {
    clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => {
      syncScroll()
      bumpLayout(0)
    }, LAYOUT_FRAME)
  }

  createEffect(
    on(
      () => props.sections.map((s) => (s.folded ? '1' : '0')).join(''),
      remeasure,
      { defer: true }
    )
  )

  const inner = () => Math.max(1, props.width - 1)

  const fold = (key: string, folded: boolean) => {
    if (byKey().get(key)?.folded !== folded) {
      props.onFold(key, folded)
    }
  }

  // Set while druk moves the page itself, so the scroll listener can tell a reveal from the reader.
  let steering = false
  const steer = (host: ScrollBoxRenderable, top: number) => {
    steering = true
    try {
      host.scrollTop = top
    } finally {
      steering = false
    }
  }

  // The reader moving the page hands the selection back to whatever file it now shows.
  const release = () => {
    cancelHold?.()
    drifted = true
    setPickedKey(null)
    setPickedLine(null)
  }

  // A key that moved nothing keeps the pick: on a page that fits, ↓ after Tab is not a walk.
  const scrollTo = (row: number) => {
    if (!box) {
      return
    }
    const before = box.scrollTop
    steer(box, Math.max(0, row))
    if (box.scrollTop !== before) {
      release()
    }
    syncScroll()
    remeasure()
  }
  const scroll = (delta: number) => scrollTo((box?.scrollTop ?? 0) + delta)

  const reveal = (key: string, into = 0) => {
    const host = box
    const el = anchors.get(key)
    if (!host || !el) {
      return
    }
    steer(host, el.y - host.y + host.scrollTop + Math.round(into * el.height))
    drifted = into > 0
    syncScroll()
  }

  // A share of the section's height, not rows: split pads every block, so rows do not survive a flip.
  const offsetIn = (key: string) => {
    const host = box
    const el = anchors.get(key)
    if (!host || !el || el.height <= 0) {
      return 0
    }
    const y = el.y - host.y + host.scrollTop
    return Math.min(1, Math.max(0, (scrollTop() - y) / el.height))
  }

  const headerYs = (): number[] => {
    layout()
    const host = box
    if (!host) {
      return []
    }
    // The section, not the header inside it: the scrollbox culls what is off screen, and a
    // culled section's children are never laid out — only the sections themselves are.
    return keys().map((key) => {
      const el = anchors.get(key)
      if (!el || el.height <= 0) {
        return Number.NaN
      }
      return el.y - host.y + host.scrollTop
    })
  }

  const sticky = createMemo(() => {
    const pin = stickyHeader(scrollTop(), headerYs())
    const key = pin ? keys()[pin.index] : undefined
    const section = key ? byKey().get(key) : undefined
    return pin && section ? { clipped: pin.clipped, section } : null
  })

  let lastPin: NonNullable<ReturnType<typeof sticky>> | undefined
  const pinned = () => {
    lastPin = sticky() ?? lastPin
    return lastPin!
  }

  const currentIndex = () => {
    const ys = headerYs()
    const pin = stickyHeader(scrollTop(), ys)
    if (pin) {
      return pin.index
    }
    const at = ys.findIndex((y) => Number.isFinite(y) && y >= scrollTop())
    if (at !== -1) {
      return at
    }
    return Math.max(0, keys().indexOf(props.focusKey ?? ''))
  }

  const selectedKey = createMemo(() => {
    if (!props.focused) {
      return null
    }
    const picked = pickedKey()
    if (picked && byKey().has(picked)) {
      return picked
    }
    return keys()[currentIndex()] ?? null
  })

  // Not `currentIndex()`: measured off renderables, a layout pass behind the offset it set.
  const anchorKey = () => {
    if (!drifted) {
      const picked = pickedKey()
      if (picked && byKey().has(picked)) {
        return picked
      }
      if (props.focusKey && byKey().has(props.focusKey)) {
        return props.focusKey
      }
    }
    return keys()[currentIndex()] ?? null
  }

  // Re-applied over the next frames: the first attempt is clamped to the old heights.
  const holdAt = (key: string, into = 0) => {
    cancelHold?.()
    cancelHold = retryFrames(
      () => {
        reveal(key, into)
        remeasure()
        return false
      },
      { delay: LAYOUT_FRAME / 2, tries: HOLD_FRAMES }
    )
  }

  createEffect(
    on(
      () => props.mode,
      () => {
        const key = anchorKey()
        // Read before the flip lays out — the heights the reader's offset was measured against.
        if (key) {
          holdAt(key, offsetIn(key))
        }
      },
      { defer: true }
    )
  )

  const moveSelection = (delta: number) => {
    const list = keys()
    if (list.length === 0) {
      return
    }
    const at = Math.max(0, list.indexOf(selectedKey() ?? list[0]!))
    const next = list[(at + delta + list.length) % list.length]!
    setPickedKey(next)
    setPickedLine(null)
    // A walk outranks the reveal hold below.
    cancelReveal?.()
    reveal(next)
  }

  // A memo: `on` re-runs whenever a dependency notifies, and a refresh rebuilding the same
  // keys would otherwise yank the scroll back to the cursor's file.
  const revealTarget = createMemo(
    () => `${props.focusKey ?? ''}\n${keys().join('\n')}`
  )

  createEffect(
    on(revealTarget, () => {
      const key = props.focusKey
      if (!key || !byKey().has(key)) {
        return
      }
      // Coming back to the tab on the same file: the reader's offset, not the file's top.
      if (served.get(props.scrollKey) === key && scrollTop() > 0) {
        return
      }
      served.set(props.scrollKey, key)
      cancelReveal?.()
      cancelReveal = retryFrames(
        () => {
          const el = anchors.get(key)
          const first = keys()[0] === key
          // y is 0 before layout and negative when scrolled off the top: neither is ready.
          if (!el || !box || el.height <= 0 || (!first && el.y === 0)) {
            return false
          }
          reveal(key)
          // Files above this one keep landing their rows, so anything but the first re-applies.
          return first
        },
        { tries: REVEAL_TRIES }
      )
    })
  )

  const page = () => Math.max(1, dimensions().height - 3)

  // Only a page that already scrolls gets room past its end; one that fits stays put.
  const tail = () => {
    layout()
    scrollTop()
    const host = box
    const last = anchors.get(keys().at(-1) ?? '')
    if (!host || !last) {
      return 0
    }
    const room = host.height
    const end = last.y - host.y + host.scrollTop + last.height
    return end > room ? Math.max(0, room - HEADER_ROWS) : 0
  }

  useKeys((key: KeyEvent, k: string) => {
    if (props.blocked || !props.focused || key.defaultPrevented) {
      return
    }
    if (props.onKey?.(k, key)) {
      key.preventDefault()
      return
    }
    const selected = selectedKey()
    if (k === 'up' || k === 'k') {
      scroll(-1)
    } else if (k === 'down' || k === 'j') {
      scroll(1)
    } else if (k === 'pageup' || (key.ctrl && k === 'u')) {
      scroll(-page())
    } else if (k === 'pagedown' || (key.ctrl && k === 'd')) {
      scroll(page())
    } else if (k === 'end' || (k === 'g' && key.shift)) {
      scrollTo(Number.MAX_SAFE_INTEGER)
    } else if (k === 'home' || k === 'g') {
      scrollTo(0)
    } else if ((k === 'left' || k === 'h') && selected) {
      fold(selected, true)
    } else if ((k === 'right' || k === 'l') && selected) {
      fold(selected, false)
    } else if (k === 'tab') {
      moveSelection(key.shift ? -1 : 1)
    } else if (k === 's' || k === 'd') {
      props.onToggleMode()
    } else if (k === 'space' && selected && props.onAction) {
      props.onAction(selected)
    } else if ((k === 'return' || k === 'enter') && selected && props.onOpen) {
      props.onOpen(selected, selected === pickedKey() ? pickedLine() : null)
    } else if (k === 'escape' || k === 'q') {
      props.onClose()
    } else {
      return
    }
    key.preventDefault()
  })

  const keyRow = (): DiffKey[] => [
    { key: 'Tab', label: 'next file', rank: 1 },
    ...(props.onOpen ? [{ key: 'Enter', label: 'open', rank: 2 }] : []),
    { key: '←→', label: 'fold', rank: 9 },
    ...(props.keys ?? []).map((item, i) => ({ ...item, rank: 5 + i })),
    {
      key: props.focused ? 's' : 'S',
      label: 'layout',
      rank: 3,
      value: props.mode === 'inline' ? 'inline' : 'side-by-side',
    },
    { key: 'Esc', label: props.escLabel ?? 'close', rank: 0 },
  ]

  const headerFor = (section: DiffSection, part: 'full' | 'meta') => (
    <FileHeader
      section={section}
      width={inner()}
      part={part}
      hovered={hover.hovered(section.key)}
      selected={selectedKey() === section.key}
      onToggle={() => {
        setPickedKey(section.key)
        setPickedLine(null)
        fold(section.key, !section.folded)
      }}
      onAction={
        props.onAction
          ? () => {
              setPickedKey(section.key)
              props.onAction?.(section.key)
            }
          : undefined
      }
      onEnter={() => hover.enter(section.key)}
      onLeave={() => hover.leave(section.key)}
    />
  )

  return (
    <PageFrame onFocus={props.onFocus} onWheel={remeasure}>
      <DiffHeadingView
        heading={props.heading}
        stats={props.meta}
        keys={keyRow()}
        width={props.width}
      />
      <Show
        when={keys().length > 0}
        fallback={
          <box flexGrow={1} paddingLeft={2} paddingTop={1}>
            <text fg={ui.dim} content={props.empty} />
          </box>
        }
      >
        <box flexGrow={1}>
          <scrollbox
            ref={(el: ScrollBoxRenderable) => {
              box = el
              followScroll(el, (top) => {
                if (top === scrollTop()) {
                  return
                }
                if (!steering) {
                  release()
                }
                drifted = true
                setScrollTop(top)
              })
              const top = scrollTop()
              if (top > 0) {
                drifted = true
                onCleanup(
                  retryFrames(() => {
                    steer(el, top)
                    if (el.scrollTop !== top) {
                      return false
                    }
                    // The sticky header is measured off renderables: nothing pins until it re-reads.
                    remeasure()
                    return true
                  })
                )
              }
            }}
            flexGrow={1}
            backgroundColor={ui.solidBg}
            stickyScroll={false}
            scrollbarOptions={scrollbarOptions(ui.solidBg)}
          >
            <For each={keys()}>
              {(key) => {
                onCleanup(() => anchors.delete(key))
                // Last known values, not Show's accessors: a fold or a removal lands before the
                // Show tears its children down, and Solid throws on a stale read in between.
                let lastSection: DiffSection | undefined
                const current = () => {
                  lastSection = byKey().get(key) ?? lastSection
                  return lastSection!
                }
                let lastBody: DiffSectionBody | undefined
                const body = () => {
                  lastBody = current().body ?? lastBody
                  return lastBody!
                }
                return (
                  <Show when={byKey().has(key)}>
                    <box
                      ref={(el: LaidOut) => {
                        if (el) {
                          anchors.set(key, el)
                        }
                      }}
                      // A diff landing its rows moves the page's end with no scroll to report it.
                      onSizeChange={remeasure}
                      width="100%"
                      flexShrink={0}
                      flexDirection="column"
                    >
                      <box flexShrink={0}>{headerFor(current(), 'full')}</box>
                      <Show when={!current().folded && Boolean(current().body)}>
                        <DiffBody
                          path={body().path}
                          oldText={body().oldText}
                          newText={body().newText}
                          patch={body().patch}
                          lines={body().lines}
                          plain={body().plain}
                          mode={
                            body().oldText === '' || body().newText === ''
                              ? 'inline'
                              : props.mode
                          }
                          width={props.width}
                          onFocus={props.onFocus}
                          onPickLine={(line) => {
                            setPickedKey(key)
                            setPickedLine(line)
                          }}
                        />
                      </Show>
                    </box>
                  </Show>
                )
              }}
            </For>
            {/* Room past the last file, or the files at the end could never reach the top,
                where the selection is read from. */}
            <box height={tail()} flexShrink={0} />
          </scrollbox>
          <Show when={sticky()}>
            <box
              position="absolute"
              top={0}
              left={0}
              width={inner()}
              height={HEADER_ROWS - pinned().clipped}
              zIndex={2}
              flexShrink={0}
            >
              {headerFor(
                pinned().section,
                pinned().clipped > 0 ? 'meta' : 'full'
              )}
            </box>
          </Show>
        </box>
      </Show>
    </PageFrame>
  )
}
