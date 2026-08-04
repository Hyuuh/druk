import { basename } from 'node:path'

import type { ScrollBoxRenderable, TreeSitterClient } from '@opentui/core'
import { createEffect, createMemo, createSignal, on, onMount, Show } from 'solid-js'

import { BinaryFileError, readFile, sizeOf } from '../core/fs'
import { isImagePath } from '../core/image'
import { isPdfPath } from '../core/pdf'
import { filetypeForPath, getSyntaxStyle, highlightClient } from '../languages/highlight'
import { paintedTheme, ui } from '../themes'
import { ImageView } from './ImageView'
import { cut } from './text'

export interface PreviewPaneProps {
  path: string
  isDir: boolean
  /**
   * The open buffer's text where the file has one: an unsaved edit is part of the
   * file being looked at, and the copy on disk would show it without them.
   */
  buffer?: string
  /** Columns the pane owns — the editor slot, not the terminal. */
  width: number
  /** Rows the pane owns. */
  height: number
  /** Page keys from the tree, which keeps the keyboard while this pane is up. */
  scroll: { pages: number; at: number } | null
  onFocus: () => void
}

/**
 * Past this the file is named rather than shown. Nothing is being edited here, so
 * the cost is all loss: the read allocates the whole file and the highlight pass
 * runs on it, and both happen again on every step through the tree.
 */
const MAX_PREVIEW_BYTES = 512 * 1024

/** What the pane has to draw for the row the cursor is on. */
type Shown =
  | { kind: 'text'; text: string }
  | { kind: 'image' }
  /** Nothing to render: a folder, a viewer format, or a file that would not read. */
  | { kind: 'note'; note: string }

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`

/**
 * Quick look at the row under the tree's cursor: the file drawn over the editor
 * slot without a tab, a buffer, or anything written back. It takes no keys of its
 * own — the tree keeps them, so ↑↓ walks files while this follows along.
 */
export function PreviewPane(props: PreviewPaneProps) {
  /**
   * Fenced highlighting goes through the client druk vendored its grammars into,
   * as the diff and markdown panes do — letting `<code>` default would spin up a
   * second, empty one.
   */
  const [client, setClient] = createSignal<TreeSitterClient | null | undefined>(undefined)
  onMount(() => void highlightClient().then(c => setClient(c)))

  // Keyed on the painted theme, including a live preview: the style table is
  // rebuilt when the palette changes and `<code>` has to be handed the new one.
  const style = createMemo(
    on(
      () => paintedTheme(),
      () => getSyntaxStyle(),
    ),
  )

  let box: ScrollBoxRenderable | undefined

  /** Rows a page spans — the pane is the editor slot: tabs, header and status off. */
  const page = () => Math.max(1, props.height - 2)

  createEffect(
    on(
      () => props.scroll,
      request => {
        if (box && request) box.scrollTop = Math.max(0, box.scrollTop + request.pages * page())
      },
      { defer: true },
    ),
  )

  // The cursor moved to another file: this is a different document, not a scrolled
  // one. Deliberately not keyed on the content, which changes under an open buffer
  // on every keystroke in the editor.
  createEffect(
    on(
      () => props.path,
      () => {
        if (box) box.scrollTop = 0
      },
      { defer: true },
    ),
  )

  const shown = createMemo<Shown>(() => {
    if (props.isDir) return { kind: 'note', note: 'Folder — → opens it' }
    if (isImagePath(props.path)) return { kind: 'image' }
    if (isPdfPath(props.path)) return { kind: 'note', note: 'PDF — Enter opens the viewer' }
    if (props.buffer !== undefined) return { kind: 'text', text: props.buffer }
    const bytes = sizeOf(props.path)
    if (bytes > MAX_PREVIEW_BYTES) {
      return { kind: 'note', note: `${sizeLabel(bytes)} — too big to preview; Enter opens it` }
    }
    try {
      return { kind: 'text', text: readFile(props.path) }
    } catch (e) {
      return {
        kind: 'note',
        note:
          e instanceof BinaryFileError
            ? `Binary — ${sizeLabel(bytes)}, nothing to show`
            : (e as Error).message,
      }
    }
  })

  const note = createMemo(() => {
    const what = shown()
    return what.kind === 'note' ? what.note : null
  })
  const text = createMemo(() => {
    const what = shown()
    return what.kind === 'text' ? what.text : null
  })

  /** The hints, or the short spelling once the header cannot hold both. */
  const hints = () => {
    const full = ' preview · Enter opens · Space closes '
    return full.length + 12 <= props.width ? full : ' preview · Esc '
  }

  const name = () => cut(basename(props.path), Math.max(0, props.width - hints().length - 2))

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={ui.solidBg}
      onMouseDown={() => props.onFocus()}
    >
      <box flexDirection="row" backgroundColor={ui.solidBarBg}>
        <text
          fg={ui.text}
          bg={ui.solidBarBg}
          flexShrink={0}
          wrapMode="none"
          content={` ${name()}`}
        />
        <box flexGrow={1} backgroundColor={ui.solidBarBg} />
        <text fg={ui.dim} bg={ui.solidBarBg} flexShrink={0} wrapMode="none" content={hints()} />
      </box>

      <Show when={shown().kind === 'image'}>
        <ImageView
          path={props.path}
          width={props.width}
          height={props.height - 1}
          onFocus={props.onFocus}
        />
      </Show>
      <Show when={note()}>
        {(what: () => string) => <text fg={ui.dim} bg={ui.solidBg} content={`  ${what()}`} />}
      </Show>
      <Show when={text() !== null}>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (box = el)}
          flexGrow={1}
          backgroundColor={ui.solidBg}
          paddingLeft={1}
          scrollbarOptions={{
            trackOptions: { foregroundColor: ui.scrollbar, backgroundColor: ui.solidBg },
          }}
        >
          {/* Wrapped whatever the editor's own `wrap` says: nothing here scrolls
              sideways, so an unwrapped long line would simply be unreadable. */}
          <code
            content={text() ?? ''}
            filetype={filetypeForPath(props.path)}
            syntaxStyle={style()}
            treeSitterClient={client() ?? undefined}
            wrapMode="word"
            fg={ui.text}
            bg={ui.solidBg}
          />
        </scrollbox>
      </Show>
    </box>
  )
}
