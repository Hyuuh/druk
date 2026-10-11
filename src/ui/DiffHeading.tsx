import { TextAttributes } from '@opentui/core'
import { For, Show } from 'solid-js'
import type { Accessor } from 'solid-js'

import { ui } from '../themes'
import { cut } from './text'

export type HeadingTone = 'added' | 'deleted' | 'accent' | 'dim'

export interface DiffHeading {
  title: string
  // Drawn dim ahead of the title: a pull request's number, a commit's short hash.
  ref?: string
  state?: { text: string; tone: HeadingTone }
  byline?: string
  aside?: string
}

export interface DiffStats {
  total: number
  adds: number
  dels: number
}

export interface DiffKey {
  key: string
  label: string
  value?: string
  // Lower survives longer on a narrow page; Esc is never dropped.
  rank: number
}

const toneColor = (tone: HeadingTone) =>
  tone === 'added'
    ? ui.gitAdded
    : tone === 'deleted'
      ? ui.gitDeleted
      : tone === 'accent'
        ? ui.accent
        : ui.dim

export const headingRows = (heading: DiffHeading) =>
  heading.byline || heading.aside ? 3 : 2

const KEY_GAP = '   '

const keyWidth = (item: DiffKey) =>
  item.key.length +
  (item.label ? item.label.length + 1 : 0) +
  (item.value ? item.value.length + 1 : 0)

const rowWidth = (items: DiffKey[]) => {
  let width = -KEY_GAP.length
  for (const item of items) {
    width += keyWidth(item) + KEY_GAP.length
  }
  return width
}

// A key that carries its state loses its label first, then the highest-ranked keys go.
export function fitKeys(items: DiffKey[], room: number): DiffKey[] {
  if (rowWidth(items) <= room) {
    return items
  }
  const compact = items.map((item) =>
    item.value ? { ...item, label: '' } : item
  )
  let width = rowWidth(compact)
  const dropped = new Set<DiffKey>()
  for (const item of compact.toSorted((x, y) => y.rank - x.rank)) {
    if (width <= room || dropped.size === compact.length - 1) {
      break
    }
    dropped.add(item)
    width -= keyWidth(item) + KEY_GAP.length
  }
  return compact.filter((item) => !dropped.has(item))
}

export function DiffHeadingView(props: {
  heading: DiffHeading
  stats: DiffStats
  keys: DiffKey[]
  width: number
}) {
  const bg = () => ui.solidBg
  const room = () => Math.max(1, props.width - 2)

  const files = () =>
    `${props.stats.total} ${props.stats.total === 1 ? 'file' : 'files'}`
  const statsWidth = () =>
    files().length + `  +${props.stats.adds}  −${props.stats.dels}`.length + 2
  const stateText = () =>
    props.heading.state ? `● ${props.heading.state.text}  ` : ''
  const refText = () => (props.heading.ref ? `${props.heading.ref} ` : '')
  const title = () =>
    cut(
      props.heading.title,
      Math.max(4, room() - stateText().length - refText().length - statsWidth())
    )

  const aside = () => (props.heading.aside ? `  ${props.heading.aside}` : '')
  const byline = () =>
    cut(props.heading.byline ?? '', Math.max(4, room() - aside().length))

  const keys = () => fitKeys(props.keys, room())

  return (
    <box
      flexShrink={0}
      flexDirection="column"
      backgroundColor={bg()}
      paddingLeft={1}
      paddingRight={1}
    >
      <box height={1} flexDirection="row" backgroundColor={bg()}>
        <Show when={props.heading.state}>
          {(state: Accessor<NonNullable<DiffHeading['state']>>) => (
            <text
              wrapMode="none"
              fg={toneColor(state().tone)}
              bg={bg()}
              flexShrink={0}
              content={stateText()}
            />
          )}
        </Show>
        <Show when={refText()}>
          <text
            wrapMode="none"
            fg={ui.dim}
            bg={bg()}
            flexShrink={0}
            content={refText()}
          />
        </Show>
        <text
          wrapMode="none"
          fg={ui.text}
          bg={bg()}
          flexShrink={1}
          attributes={TextAttributes.BOLD}
          content={title()}
        />
        <box flexGrow={1} backgroundColor={bg()} />
        <text
          wrapMode="none"
          fg={ui.dim}
          bg={bg()}
          flexShrink={0}
          content={`  ${files()}`}
        />
        <text
          wrapMode="none"
          fg={ui.gitAdded}
          bg={bg()}
          flexShrink={0}
          content={`  +${props.stats.adds}`}
        />
        <text
          wrapMode="none"
          fg={ui.gitDeleted}
          bg={bg()}
          flexShrink={0}
          content={`  −${props.stats.dels}`}
        />
      </box>
      <Show when={headingRows(props.heading) === 3}>
        <box height={1} flexDirection="row" backgroundColor={bg()}>
          <text
            wrapMode="none"
            fg={ui.dim}
            bg={bg()}
            flexShrink={1}
            content={byline()}
          />
          <box flexGrow={1} backgroundColor={bg()} />
          <text
            wrapMode="none"
            fg={ui.dim}
            bg={bg()}
            flexShrink={0}
            content={aside()}
          />
        </box>
      </Show>
      <box height={1} flexDirection="row" backgroundColor={bg()}>
        <For each={keys()}>
          {(item, index) => (
            <>
              <Show when={index() > 0}>
                <text
                  wrapMode="none"
                  bg={bg()}
                  flexShrink={0}
                  content={KEY_GAP}
                />
              </Show>
              <text
                wrapMode="none"
                fg={ui.accent}
                bg={bg()}
                flexShrink={0}
                content={item.key}
              />
              <Show when={item.label}>
                <text
                  wrapMode="none"
                  fg={ui.faint}
                  bg={bg()}
                  flexShrink={0}
                  content={` ${item.label}`}
                />
              </Show>
              <Show when={item.value}>
                {(value: Accessor<string>) => (
                  <text
                    wrapMode="none"
                    fg={ui.dim}
                    bg={bg()}
                    flexShrink={0}
                    content={` ${value()}`}
                  />
                )}
              </Show>
            </>
          )}
        </For>
      </box>
    </box>
  )
}
