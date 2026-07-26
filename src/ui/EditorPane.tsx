import { TextAttributes } from '@opentui/core'
import type { KeyEvent, MouseEvent, TextareaRenderable } from '@opentui/core'
import { useKeyboard, useRenderer } from '@opentui/solid'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'

import { copyToClipboard, readClipboard } from '../core/clipboard'
import type { LineChange } from '../core/git'
import { History } from '../editor/history'
import { editAtCursors, nextOccurrence, wordAtCursor } from '../editor/multicursor'
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
  /** Extra carets (character offsets) added with Ctrl+D. */
  const [extraCursors, setExtraCursors] = createSignal<number[]>([])
  const gutterWidth = () => String(props.content.split('\n').length).length + 2

  createEffect(() => {
    const width = gutterWidth()
    if (gutter?.gutter) gutter.gutter._minWidth = width
  })

  // Line signs are a method, not a settable prop, so Solid cannot bind them.
  createEffect(() => {
    const changes = props.gitLines
    gutter?.setLineSigns?.(
      new Map(
        [...changes].map(([line, change]) => [
          line,
          {
            before: change === 'deleted' ? '▁' : '▎',
            beforeColor:
              change === 'added'
                ? ui.gitAdded
                : change === 'modified'
                  ? ui.gitModified
                  : ui.gitDeleted,
          },
        ]),
      ),
    )
  })

  /** Extra carets are highlights: the buffer only renders one real cursor. */
  const drawExtraCursors = () => {
    const cursors = extraCursors()
    if (!editor || cursors.length === 0) return
    const styleId = styleIdForGroup(CURSOR_MARK)
    if (styleId == null) return
    for (const offset of cursors) {
      const at = editor.editBuffer.offsetToPosition(offset)
      if (at) editor.addHighlight(at.row, { start: at.col, end: at.col + 1, styleId })
    }
  }

  /**
   * Vertical caret moves emit no cursor-change event at all, and the position is
   * only settled once the key has been handled — so the readout is refreshed a
   * tick after every key rather than from the event payload.
   */
  const syncCursor = () => {
    const at = editor?.visualCursor
    if (!at) return
    if (at.logicalRow === cursor.line && at.logicalCol === cursor.col) return
    cursor.line = at.logicalRow
    cursor.col = at.logicalCol
    setCursorLine(at.visualRow)
    props.onCursor({ ...cursor })
  }

  let cursorSync: ReturnType<typeof setTimeout> | null = null
  const scheduleCursorSync = () => {
    if (cursorSync) return
    cursorSync = setTimeout(() => {
      cursorSync = null
      syncCursor()
    }, 0)
  }

  const applyLine = (line: number) => {
    if (appliedLines.has(line)) return
    appliedLines.add(line)
    for (const segment of byLine.get(line) ?? []) editor!.addHighlight(line, segment)
  }

  /** Keep the viewport (plus overscan) highlighted, touching only what changed. */
  const applyWindow = (force = false) => {
    if (!editor) return
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
    for (let line = from; line <= to; line++) applyLine(line)
    drawExtraCursors()
  }

  createEffect(
    on(
      () => extraCursors(),
      cursors => {
        props.onMultiCursor(cursors.length)
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

  const stepHistory = (kind: 'undo' | 'redo') => {
    if (!editor) return
    const at = kind === 'undo' ? history.undo() : history.redo()
    if (!at) return
    setExtraCursors([])
    // setText resets the buffer's own history, which is fine — `history` is the
    // one being stepped, and its entries are whole edit bursts.
    editor.setText(at.content)
    editor.cursorOffset = Math.min(at.cursor, at.content.length)
    props.onChange(at.content)
    byLine = new Map()
    void highlight(at.content, props.path)
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

  onCleanup(() => {
    if (highlightTimer) clearTimeout(highlightTimer)
    if (cursorSync) clearTimeout(cursorSync)
  })

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
      const word = wordAtCursor(editor)
      if (!word) return
      const cursors = extraCursors()
      const searchFrom = (cursors.at(-1) ?? editor.cursorOffset) + word.length
      const found = nextOccurrence(editor.plainText, word, searchFrom)
      if (found !== null && !cursors.includes(found)) setExtraCursors([...cursors, found])
      return
    }
    if (key.name === 'escape' && extraCursors().length > 0) {
      key.preventDefault()
      setExtraCursors([])
      return
    }

    // With extra carets every edit is replayed at each of them.
    if (extraCursors().length > 0) {
      const primary = editor.cursorOffset
      const all = [primary, ...extraCursors()]
      const typed = key.sequence
      if (key.name === 'backspace') {
        key.preventDefault()
        const moved = editAtCursors(editor, all, e => e.deleteCharBackward(), -1)
        setExtraCursors(moved.filter(o => o !== moved[all.indexOf(primary)]).map(o => o - 1))
        editor.cursorOffset = primary - 1
        return
      }
      if (typed && typed.length === 1 && !key.ctrl && !key.meta) {
        key.preventDefault()
        const moved = editAtCursors(editor, all, e => e.insertText(typed), 1)
        const primaryIndex = [...new Set(all)].toSorted((a, b) => a - b).indexOf(primary)
        setExtraCursors(moved.filter((_, i) => i !== primaryIndex))
        editor.cursorOffset = moved[primaryIndex]! + 1
        return
      }
    }

    if (key.ctrl && (key.name === 'c' || key.name === 'x')) {
      const selected = editor.getSelectedText()
      if (!selected) return
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
      // Block cursor while commanding, bar while inserting — like vim.
      editor.cursorStyle = { style: vimState.mode === 'insert' ? 'line' : 'block', blinking: true }
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
        setExtraCursors([])
        if (editor.plainText !== props.content) editor.setText(props.content)
        editor.setCursor(0, 0)
        history.reset({ content: props.content, cursor: 0 })
        editor.syntaxStyle = getSyntaxStyle()
        byLine = new Map()
        void highlight(props.content, path)
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
          byLine = new Map()
          void highlight(props.content, props.path)
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
