import type { CursorChangeEvent, KeyEvent, TextareaRenderable } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useEffect, useRef, useState } from 'react'

import { completionsFor, prefixAt } from '../completion'
import { computeSegments, getSyntaxStyle } from '../highlight'
import { ui } from '../theme'
import type { ThemeName } from '../theme'
import { CompletionPopup } from './CompletionPopup'

export interface EditorPaneProps {
  path: string | null
  content: string
  filetype?: string
  focused: boolean
  theme: ThemeName
  onChange: (text: string) => void
  onCursor: (pos: { line: number; col: number }) => void
  onFocus: () => void
  onCompletingChange: (open: boolean) => void
}

const DEBOUNCE_MS = 80
const MIN_PREFIX = 2

interface Completion {
  items: string[]
  index: number
  prefix: string
  top: number
  left: number
}

export function EditorPane({
  path,
  content,
  filetype,
  focused,
  theme,
  onChange,
  onCursor,
  onFocus,
  onCompletingChange,
}: EditorPaneProps) {
  const ref = useRef<TextareaRenderable | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applied = useRef<string>('') // last segment set applied, to skip no-op redraws
  const cursor = useRef({ line: 0, col: 0 })
  const suppress = useRef(false) // skip the auto-popup caused by accepting a completion

  const [completion, setCompletion] = useState<Completion | null>(null)
  const completionRef = useRef<Completion | null>(null)
  completionRef.current = completion

  // ---- syntax highlight ----------------------------------------------------
  const highlight = async (snapshot: string, forPath: string | null) => {
    const segs = await computeSegments(snapshot, filetype)
    const el = ref.current
    // Stale guard: only apply if this is still the same file AND the buffer text
    // is byte-for-byte what we highlighted — otherwise offsets would drift.
    if (!el || forPath !== path || el.plainText !== snapshot) return
    const key = segs ? JSON.stringify(segs) : ''
    if (key === applied.current) return
    applied.current = key
    el.clearAllHighlights()
    if (segs) for (const s of segs) el.addHighlightByCharRange(s)
  }

  const scheduleHighlight = () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => {
      const el = ref.current
      if (el) void highlight(el.plainText, path)
    }, DEBOUNCE_MS)
  }

  // ---- completion ----------------------------------------------------------
  const closeCompletion = () => {
    setCompletion(null)
    onCompletingChange(false)
  }

  const updateCompletion = () => {
    const el = ref.current
    if (!el || !focused) return closeCompletion()
    if (suppress.current) {
      suppress.current = false
      return closeCompletion()
    }
    const text = el.plainText
    const { line, col } = cursor.current
    const prefix = prefixAt(text.split('\n')[line] ?? '', col)
    if (prefix.length < MIN_PREFIX) return closeCompletion()
    const items = completionsFor(text, prefix, filetype)
    if (items.length === 0) return closeCompletion()
    setCompletion({
      items,
      index: 0,
      prefix,
      top: line - el.scrollY + 1,
      left: Math.max(0, col - prefix.length),
    })
    onCompletingChange(true)
  }

  const accept = (item: string) => {
    const el = ref.current
    const comp = completionRef.current
    if (!el || !comp) return
    suppress.current = true
    el.insertText(item.slice(comp.prefix.length))
    closeCompletion()
  }

  // Nav keys are handled here and hidden from the textarea via preventDefault.
  useKeyboard((key: KeyEvent) => {
    const comp = completionRef.current
    if (!comp) return
    const k = key.name
    if (k === 'up' || (key.ctrl && k === 'p')) {
      key.preventDefault()
      setCompletion(c => c && { ...c, index: (c.index - 1 + c.items.length) % c.items.length })
    } else if (k === 'down' || (key.ctrl && k === 'n')) {
      key.preventDefault()
      setCompletion(c => c && { ...c, index: (c.index + 1) % c.items.length })
    } else if (k === 'tab' || k === 'return' || k === 'enter') {
      key.preventDefault()
      accept(comp.items[comp.index]!)
    } else if (k === 'escape') {
      key.preventDefault()
      closeCompletion()
    }
  })

  // ---- lifecycle -----------------------------------------------------------
  useEffect(() => {
    const el = ref.current
    if (el) {
      el.syntaxStyle = getSyntaxStyle()
      applied.current = ''
      void highlight(el.plainText, path)
    }
    closeCompletion()
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    if (focused) ref.current?.focus()
    else closeCompletion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused])

  // Theme switch: swap the buffer's style table. Existing highlights keep their
  // style ids and repaint in the new colors — no need to re-run tree-sitter.
  useEffect(() => {
    if (ref.current) ref.current.syntaxStyle = getSyntaxStyle()
  }, [theme])

  if (path == null) {
    return (
      <box flexGrow={1} backgroundColor={ui.bg} alignItems="center" justifyContent="center">
        <text fg={ui.faint} bg={ui.bg} content="Open a file to start editing" />
      </box>
    )
  }

  return (
    <box flexGrow={1} backgroundColor={ui.bg} onMouseDown={onFocus}>
      <textarea
        key={path}
        ref={ref}
        initialValue={content}
        focused={focused}
        syntaxStyle={getSyntaxStyle()}
        backgroundColor={ui.bg}
        textColor={ui.text}
        focusedBackgroundColor={ui.bg}
        focusedTextColor={ui.text}
        flexGrow={1}
        onContentChange={() => {
          const el = ref.current
          if (!el) return
          onChange(el.plainText)
          scheduleHighlight()
          setTimeout(updateCompletion, 0) // after the matching cursor-change settles
        }}
        onCursorChange={(e: CursorChangeEvent) => {
          cursor.current = { line: e.line, col: e.visualColumn }
          onCursor(cursor.current)
        }}
      />
      {completion && (
        <CompletionPopup
          items={completion.items}
          index={completion.index}
          top={completion.top}
          left={completion.left}
        />
      )}
    </box>
  )
}
