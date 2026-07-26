import { TextAttributes } from '@opentui/core'
import type { KeyEvent, MouseEvent, TextareaRenderable } from '@opentui/core'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid'
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'

import { copyToClipboard, readClipboard } from '../core/clipboard'
import type { LineChange } from '../core/git'
import { History } from '../editor/history'
import { deleteRanges, nextMatch, replaceRanges, wordRangeAt } from '../editor/multicursor'
import type { Range } from '../editor/multicursor'
import { handleTyping } from '../editor/typing'
import { handleVimKey, initialVimState } from '../editor/vim'
import type { VimMode } from '../editor/vim'
import {
  computeSegments,
  CURSOR_MARK,
  getSyntaxStyle,
  styleIdForGroup,
} from '../languages/highlight'
import type { Segment } from '../languages/highlight'
import { ui } from '../themes'
import type { ThemeName } from '../themes'

export interface EditorPaneProps {
  path: string | null
  content: string
  filetype?: string
  focused: boolean
  theme: ThemeName
  reloadKey: number
  /** Cursor target requested from outside (search results); bumped `key` re-applies. */
  goto: { line: number; col: number; key: number } | null
  /** Undo/redo requested from the palette; bumped `key` re-applies. */
  history: { kind: 'undo' | 'redo'; key: number } | null
  vim: boolean
  tabSize: number
  wordWrap: boolean
  /** True while a modal owns the keyboard; the editor must ignore all keys. */
  blocked: boolean
  /** Set when the file is not text; shows a notice over the (empty) editor. */
  notice: string | null
  /** Lines changed against git HEAD, for the gutter marks. */
  gitLines: Map<number, LineChange>
  onChange: (text: string) => void
  onCursor: (pos: { line: number; col: number }) => void
  onFocus: () => void
  onVimMode: (mode: VimMode | null) => void
  /** Extra caret count, so Esc can clear them instead of leaving the editor. */
  onMultiCursor: (count: number) => void
}

const DEBOUNCE_MS = 80
/** Lines kept highlighted above and below the viewport, so small scrolls are free. */
const OVERSCAN = 60

const SIGN_GLYPH: Record<LineChange, string> = { added: '▎', modified: '▎', deleted: '▁' }

/** Per renderer, the one renderable a mouse selection may start in. */
const selectionHosts = new WeakMap<object, unknown>()

/**
 * Any text renderable is selectable by default, so dragging across a tree row or
 * a tab selects that chrome text. Selecting is only ever meaningful in the
 * editor, where Ctrl+C copies it, so each renderer is gated once and then tracks
 * whichever textarea is currently mounted.
 */
function allowSelectionOnlyInEditor(el: TextareaRenderable) {
  const renderer = useRenderer() as unknown as {
    startSelection: (renderable: unknown, x: number, y: number) => void
  }
  const gated = selectionHosts.has(renderer)
  selectionHosts.set(renderer, el)
  if (gated) return

  const start = renderer.startSelection.bind(renderer)
  renderer.startSelection = (renderable: unknown, x: number, y: number) => {
    if (renderable === selectionHosts.get(renderer)) start(renderable, x, y)
  }
}

/**
 * When the renderer's hit test finds nothing under the wheel it hands the event
 * to whatever is focused, so scrolling the file tree also scrolled the editor.
 * The internal handler ignores preventDefault and runs after every listener, so
 * the only place to drop the event is the renderable's own hook.
 */
export function ignoreScrollOutsideBounds(el: TextareaRenderable) {
  // `onMouseEvent` is protected; overriding it is the documented extension point
  // for subclasses, and this is the same override without subclassing.
  const host = el as unknown as { onMouseEvent: (event: MouseEvent) => void }
  const handle = host.onMouseEvent.bind(host)
  host.onMouseEvent = (event: MouseEvent) => {
    if (event.type === 'scroll') {
      const { x, y, width, height } = el
      const inside = event.x >= x && event.x < x + width && event.y >= y && event.y < y + height
      if (!inside) return
    }
    handle(event)
  }
}

export function EditorPane(props: EditorPaneProps) {
  const dimensions = useTerminalDimensions()
  /** LineNumberRenderable takes `minWidth` in its constructor only, and Solid's
   * reconciler builds elements bare, so the width has to be poked in by hand. */
  interface GutterHost {
    gutter?: { _minWidth?: number }
    setLineSigns?: (signs: Map<number, { before?: string; beforeColor?: string }>) => void
  }
  let gutter: GutterHost | undefined
  let editor: TextareaRenderable | undefined
  let highlightTimer: ReturnType<typeof setTimeout> | null = null
  /** Segments grouped by line, plus the lines currently pushed to the buffer.
   * Every highlight is an FFI call, so the window is maintained incrementally:
   * scrolling adds the lines that appeared and drops the ones that left. */
  let byLine = new Map<number, Segment[]>()
  const appliedLines = new Set<number>()
  const cursor = { line: 0, col: 0 }
  const history = new History({ content: props.content, cursor: 0 })
  /** Cursor offset before the edit in progress — where undo should land. */
  let cursorBeforeEdit = 0
  const vimState = initialVimState()

  const [editorEl, setEditorEl] = createSignal<TextareaRenderable | null>(null)
  const [cursorLine, setCursorLine] = createSignal(0)
  /** Scroll position of the textarea, mirrored so the scrollbar can react to it. */
  const [viewport, setViewport] = createSignal({ top: 0, height: 0, total: 0 })
  /**
   * Every occurrence Ctrl+D has picked up, in the order they were added. The
   * last one owns the buffer's real selection; the rest are painted.
   */
  const [matches, setMatches] = createSignal<Range[]>([])
  /**
   * One entry per visible row: true where the thumb sits. Empty when the file
   * fits, so a short file shows no track at all.
   */
  const scrollbar = createMemo(() => {
    const measured = viewport()
    // The textarea reports height 0 until the first layout, so until then fall
    // back to the terminal minus the tab bar and status bar.
    const height = measured.height || dimensions().height - 2
    const total = measured.total || props.content.split('\n').length
    const top = measured.top
    if (height <= 0 || total <= height) return []
    const size = Math.max(1, Math.round((height * height) / total))
    const span = height - size
    const at = Math.min(span, Math.round((top / (total - height)) * span))
    return Array.from({ length: height }, (_, row) => row >= at && row < at + size)
  })

  const gutterWidth = () => String(props.content.split('\n').length).length + 2

  createEffect(() => {
    const width = gutterWidth()
    if (gutter?.gutter) gutter.gutter._minWidth = width
  })

  // Line signs are a method, not a settable prop, so Solid cannot bind them.
  createEffect(() => {
    // The colors are read inside the effect because `ui` is a store: a table built
    // at module scope would hold the first theme's palette forever.
    const signColor: Record<LineChange, string> = {
      added: ui.gitAdded,
      modified: ui.gitModified,
      deleted: ui.gitDeleted,
    }
    gutter?.setLineSigns?.(
      new Map(
        [...props.gitLines].map(([line, change]) => [
          line,
          { before: SIGN_GLYPH[change], beforeColor: signColor[change] },
        ]),
      ),
    )
  })

  const syncViewport = () => {
    if (!editor) return
    setViewport({ top: editor.scrollY, height: editor.height, total: editor.lineCount })
  }

  /**
   * The buffer paints one selection, so the other matches are drawn as
   * highlights. A zero-width caret still needs a cell to be visible.
   */
  const drawMatches = () => {
    const all = matches()
    if (!editor || all.length === 0) return
    const styleId = styleIdForGroup(CURSOR_MARK)
    if (styleId == null) return
    for (const range of all.slice(0, -1)) {
      const from = editor.editBuffer.offsetToPosition(range.start)
      const to = editor.editBuffer.offsetToPosition(Math.max(range.end, range.start + 1))
      if (!from || !to || to.row !== from.row) continue
      editor.addHighlight(from.row, { start: from.col, end: to.col, styleId })
    }
  }

  /**
   * Vertical caret moves emit no cursor-change event at all, and the position is
   * only settled once the key has been handled — so the readout is refreshed a
   * tick after every key rather than from the event payload.
   */
  const syncCursor = () => {
    if (!editor) return
    // Height is still zero while the first frame lays out, so the scrollbar has
    // to be measured again once the editor is on screen.
    syncViewport()
    const at = editor.visualCursor
    if (!at) return
    if (at.logicalRow === cursor.line && at.logicalCol === cursor.col) return
    cursor.line = at.logicalRow
    cursor.col = at.logicalCol
    setCursorLine(at.visualRow)
    props.onCursor({ ...cursor })
  }

  /** Keep the viewport (plus overscan) highlighted, touching only what changed. */
  const applyWindow = (force = false) => {
    if (!editor) return
    syncViewport()
    if (force) {
      editor.clearAllHighlights()
      appliedLines.clear()
    }
    const from = Math.max(0, editor.scrollY - OVERSCAN)
    const to = editor.scrollY + editor.height + OVERSCAN

    for (const line of appliedLines) {
      if (line < from || line > to) {
        editor.clearLineHighlights(line)
        appliedLines.delete(line)
      }
    }
    for (let line = from; line <= to; line++) {
      if (appliedLines.has(line)) continue
      appliedLines.add(line)
      for (const segment of byLine.get(line) ?? []) editor.addHighlight(line, segment)
    }
    drawMatches()
  }

  let cursorSync: ReturnType<typeof setTimeout> | null = null
  const scheduleCursorSync = () => {
    if (cursorSync) return
    cursorSync = setTimeout(() => {
      cursorSync = null
      // ↑/↓ emit no cursor-change event, so this tick is also the only chance to
      // move the highlight window with a scroll they caused. Without it the
      // window stays wherever the file opened and deep lines render unstyled.
      applyWindow()
      syncCursor()
    }, 0)
  }

  createEffect(
    on(
      () => matches(),
      cursors => {
        props.onMultiCursor(Math.max(0, cursors.length - 1))
        applyWindow(true)
      },
      { defer: true },
    ),
  )

  const highlight = async (snapshot: string, forPath: string | null) => {
    if (props.notice) return
    const segs = await computeSegments(snapshot, props.filetype, props.tabSize)
    // Stale guard: only apply if this is still the same file AND the buffer text
    // is byte-for-byte what we highlighted — otherwise offsets would drift.
    if (!editor || forPath !== props.path || editor.plainText !== snapshot) return
    byLine = new Map()
    for (const segment of segs ?? []) {
      const list = byLine.get(segment.line)
      if (list) list.push(segment)
      else byLine.set(segment.line, [segment])
    }
    applyWindow(true)
  }

  /** The text changed: drop the stale segments before re-highlighting the new text. */
  const rehighlight = (text: string) => {
    byLine = new Map()
    void highlight(text, props.path)
  }

  const stepHistory = (kind: 'undo' | 'redo') => {
    if (!editor) return
    const at = kind === 'undo' ? history.undo() : history.redo()
    if (!at) return
    setMatches([])
    // setText resets the buffer's own history, which is fine — `history` is the
    // one being stepped, and its entries are whole edit bursts.
    editor.setText(at.content)
    editor.cursorOffset = Math.min(at.cursor, at.content.length)
    props.onChange(at.content)
    rehighlight(at.content)
    scheduleCursorSync()
  }

  createEffect(
    on(
      () => props.history?.key,
      () => {
        const request = props.history
        if (request) stepHistory(request.kind)
      },
      { defer: true },
    ),
  )

  const scheduleHighlight = () => {
    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      if (editor) void highlight(editor.plainText, props.path)
    }, DEBOUNCE_MS)
  }

  /**
   * Closing the last tab swaps the textarea for the fallback and destroys the
   * native buffer while `editor` still points at it. Both pending timers touch
   * it, so they have to die with the renderable, not with the whole pane.
   */
  const releaseEditor = () => {
    editor = undefined
    setEditorEl(null)
    if (highlightTimer) clearTimeout(highlightTimer)
    if (cursorSync) clearTimeout(cursorSync)
    highlightTimer = null
    cursorSync = null
  }

  onCleanup(releaseEditor)

  // Clipboard and typing helpers, ahead of the textarea's own handling.
  useKeyboard((key: KeyEvent) => {
    // preventDefault only stops the textarea, not sibling global handlers, so a
    // key already claimed elsewhere (the tree's Enter) must be ignored here too.
    if (key.defaultPrevented) return
    if (props.blocked || !editor || !props.focused || props.notice) return
    scheduleCursorSync()
    cursorBeforeEdit = editor.cursorOffset

    // Ctrl+Shift+Z is not encodable in every terminal, so Ctrl+Y redoes too.
    if (key.ctrl && key.name === 'z') {
      key.preventDefault()
      stepHistory(key.shift ? 'redo' : 'undo')
      return
    }
    if (key.ctrl && key.name === 'y') {
      key.preventDefault()
      stepHistory('redo')
      return
    }

    if (key.ctrl && key.name === 'd') {
      key.preventDefault()
      const text = editor.plainText
      const all = matches()

      // First press selects the word under the cursor; each next one adds the
      // following occurrence, so typing replaces every selection at once.
      if (all.length === 0) {
        const word = wordRangeAt(text, editor.cursorOffset)
        if (!word) return
        setMatches([word])
        editor.setSelection(word.start, word.end)
        applyWindow(true)
        return
      }

      const last = all.at(-1)!
      const word = text.slice(last.start, last.end)
      if (!word) return
      const found = nextMatch(text, word, last.end)
      if (!found || all.some(range => range.start === found.start)) return
      setMatches([...all, found])
      editor.setSelection(found.start, found.end)
      applyWindow(true)
      return
    }
    if (key.name === 'escape' && matches().length > 0) {
      key.preventDefault()
      // Collapse to the end of the last match: clearSelection alone drops the
      // caret back to the top of the buffer.
      const last = matches().at(-1)
      setMatches([])
      editor.clearSelection()
      if (last) editor.cursorOffset = last.end
      applyWindow(true)
      return
    }

    // With several matches live, an edit is applied to all of them.
    if (matches().length > 0) {
      const typed = key.sequence
      const buffer = editor
      const edit = (next: Range[]) => {
        setMatches(next)
        const last = next.at(-1)
        if (last) buffer.cursorOffset = last.start
        props.onChange(buffer.plainText)
        scheduleHighlight()
        applyWindow(true)
      }
      if (key.name === 'backspace') {
        key.preventDefault()
        edit(deleteRanges(editor, matches()))
        return
      }
      if (typed && typed.length === 1 && !key.ctrl && !key.meta) {
        key.preventDefault()
        edit(replaceRanges(editor, matches(), typed))
        return
      }
      // Anything else (arrows, Enter, a shortcut) ends multi-cursor editing.
      setMatches([])
      editor.clearSelection()
    }

    if (key.ctrl && (key.name === 'c' || key.name === 'x')) {
      // Nothing selected: swallow it anyway. The renderer no longer exits on
      // Ctrl+C, and letting it through would type a control character.
      const selected = editor.getSelectedText()
      if (!selected) {
        key.preventDefault()
        return
      }
      key.preventDefault()
      copyToClipboard(selected)
      if (key.name === 'x') editor.deleteSelection()
      return
    }
    if (key.ctrl && key.name === 'v') {
      const text = readClipboard()
      if (text === null) return
      key.preventDefault()
      editor.deleteSelection()
      editor.insertText(text)
      return
    }

    // Vim normal mode does its own thing with these keys.
    if (props.vim && vimState.mode !== 'insert') return
    if (handleTyping(editor, key, props.tabSize)) key.preventDefault()
  })

  useKeyboard((key: KeyEvent) => {
    if (key.defaultPrevented) return
    if (props.blocked || !props.vim || !editor || !props.focused) return
    const before = vimState.mode
    if (handleVimKey(editor, key, vimState)) key.preventDefault()
    if (vimState.mode !== before) {
      editor.cursorStyle = {
        style: vimState.mode === 'insert' ? 'line' : 'block',
        blinking: true,
      }
      props.onVimMode(vimState.mode)
    }
  })

  // Switching files reuses the same textarea — remounting it would delete the
  // gutter's target and OpenTUI throws (`Cannot remove target directly`).
  createEffect(
    on(
      () => props.path,
      path => {
        if (!editor) return
        setMatches([])
        scheduleCursorSync()
        if (editor.plainText !== props.content) editor.setText(props.content)
        editor.setCursor(0, 0)
        history.reset({ content: props.content, cursor: 0 })
        editor.syntaxStyle = getSyntaxStyle()
        rehighlight(props.content)
      },
    ),
  )

  createEffect(
    on(
      () => props.focused,
      focused => {
        if (focused) editor?.focus()
      },
    ),
  )

  // Every overlay mounts its own focused input, which takes renderer focus away.
  // Nothing hands it back when the overlay closes — `focused` never changed — so
  // without this the editor silently drops every key until focus is cycled.
  createEffect(
    on(
      () => props.blocked,
      blocked => {
        if (!blocked && props.focused) editor?.focus()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [props.vim, props.path],
      () => {
        Object.assign(vimState, initialVimState())
        props.onVimMode(props.vim ? 'normal' : null)
      },
    ),
  )

  createEffect(
    on(
      () => [props.theme, props.tabSize],
      () => {
        if (!editor) return
        editor.syntaxStyle = getSyntaxStyle()
        void highlight(editor.plainText, props.path)
      },
      { defer: true },
    ),
  )

  // External change: the file was reloaded from disk. Keyed on reloadKey, never
  // on content, so typing is never interrupted.
  createEffect(
    on(
      () => props.reloadKey,
      () => {
        if (editor && props.content !== editor.plainText) {
          editor.setText(props.content)
          history.reset({ content: props.content, cursor: editor.cursorOffset })
          rehighlight(props.content)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.goto?.key,
      () => {
        const target = props.goto
        if (!target || !editor) return
        editor.setCursor(target.line, target.col)
        editor.focus()
      },
      { defer: true },
    ),
  )

  return (
    <Show
      when={props.path != null}
      fallback={
        <box
          flexGrow={1}
          flexDirection="column"
          backgroundColor={ui.bg}
          alignItems="center"
          justifyContent="center"
        >
          <text fg={ui.dim} bg={ui.bg} content="druk" attributes={TextAttributes.BOLD} />
          <text fg={ui.faint} bg={ui.bg} content="" />
          <text fg={ui.faint} bg={ui.bg} content="Enter   open file from the tree" />
          <text fg={ui.faint} bg={ui.bg} content="Ctrl+P  commands" />
          <text fg={ui.faint} bg={ui.bg} content="Ctrl+F  find" />
        </box>
      }
    >
      <box
        flexGrow={1}
        flexDirection="row"
        backgroundColor={ui.bg}
        onMouseDown={() => props.onFocus()}
      >
        <line_number
          ref={(el: unknown) => {
            gutter = el as GutterHost
          }}
          target={editorEl() ?? undefined}
          fg={ui.gutter}
          bg={ui.bg}
          minWidth={gutterWidth()}
          paddingRight={1}
          flexGrow={1}
          lineColors={
            // Both entries are backgrounds, not text colors — a bright value here
            // paints a solid block behind the line number.
            new Map([[cursorLine(), { gutter: ui.currentLine, content: ui.currentLine }]])
          }
        >
          <textarea
            ref={el => {
              editor = el
              setEditorEl(el)
              ignoreScrollOutsideBounds(el)
              allowSelectionOnlyInEditor(el)
              onCleanup(releaseEditor)
            }}
            initialValue={props.content}
            focused={props.focused}
            syntaxStyle={getSyntaxStyle()}
            backgroundColor={ui.bg}
            textColor={ui.text}
            focusedBackgroundColor={ui.bg}
            focusedTextColor={ui.text}
            cursorColor={ui.cursor}
            wrapMode={props.wordWrap ? 'word' : 'none'}
            tabIndicator={props.tabSize}
            tabIndicatorColor={ui.indentGuide}
            flexGrow={1}
            paddingLeft={1}
            onContentChange={() => {
              if (!editor) return
              history.record({ content: editor.plainText, cursor: cursorBeforeEdit }, Date.now())
              props.onChange(editor.plainText)
              scheduleHighlight()
            }}
            onMouse={() => applyWindow()}
            onCursorChange={() => {
              applyWindow()
              syncCursor()
            }}
          />
        </line_number>
        <Show when={scrollbar().length > 0}>
          <box width={1} flexShrink={0} backgroundColor={ui.bg}>
            <For each={scrollbar()}>
              {filled => (
                <text fg={filled ? ui.scrollbar : ui.bg} bg={ui.bg} content={filled ? '█' : '│'} />
              )}
            </For>
          </box>
        </Show>
        <Show when={props.notice}>
          {(notice: () => string) => (
            <box
              position="absolute"
              top={0}
              left={0}
              width="100%"
              height="100%"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              backgroundColor={ui.bg}
            >
              <text
                fg={ui.text}
                bg={ui.bg}
                content="This file cannot be shown"
                attributes={TextAttributes.BOLD}
              />
              <text fg={ui.faint} bg={ui.bg} content="" />
              <text fg={ui.dim} bg={ui.bg} content={notice()} />
              <text fg={ui.faint} bg={ui.bg} content="" />
              <text
                fg={ui.faint}
                bg={ui.bg}
                content="It is binary, or uses an encoding druk cannot read."
              />
            </box>
          )}
        </Show>
      </box>
    </Show>
  )
}
