/**
 * Review notes: the remarks made while reading code, and the Markdown block
 * they leave the editor as.
 *
 * A note is a line, a kind and a sentence — nothing else, because the whole
 * point is that writing one costs a keystroke and a line of typing. They are
 * kept beside the config rather than in the project, keyed by project path, as
 * `sessions.json` is: a draft remark is personal scratch, and a `.druk/` file
 * would land in somebody's commit the first time they staged everything.
 *
 * The export is the reason the notes exist. It is a clipboard block and only a
 * clipboard block — druk posts nothing to a forge, so what leaves the editor is
 * whatever the user pastes, which is the arrangement an agent-assisted review
 * actually wants.
 */
import fs from 'node:fs'
import { dirname, join } from 'node:path'

import { CONFIG_FILE } from './config'

const NOTES_FILE = join(dirname(CONFIG_FILE), 'review.json')

/** Projects remembered before the least recently touched are dropped. */
const MAX_PROJECTS = 20

/**
 * What a remark is. The four are the ones a reviewer actually separates: a
 * defect, a change worth considering, a question, and a plain observation —
 * and an agent reading the export treats each differently.
 */
export const NOTE_KINDS = ['issue', 'suggestion', 'question', 'note'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const NOTE_LABELS: Record<NoteKind, string> = {
  issue: 'ISSUE',
  suggestion: 'SUGGESTION',
  question: 'QUESTION',
  note: 'NOTE',
}

export interface ReviewNote {
  /** Stable across a rewrite of the list — what a delete addresses. */
  id: string
  /** Absolute path, so a note survives the tree being reopened elsewhere. */
  path: string
  /** 0-based, as every line number in druk is. */
  line: number
  /** Last line of the span; equal to `line` for a note on one line. */
  endLine: number
  kind: NoteKind
  body: string
  /** Epoch ms — the order notes were written in, which is the order they read in. */
  at: number
}

const isKind = (raw: unknown): raw is NoteKind => NOTE_KINDS.includes(raw as NoteKind)

function parseNote(raw: unknown): ReviewNote | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const note = raw as Record<string, unknown>
  if (typeof note.id !== 'string' || typeof note.path !== 'string') return null
  if (typeof note.line !== 'number' || typeof note.body !== 'string') return null
  if (!isKind(note.kind)) return null
  const line = Math.max(0, Math.floor(note.line))
  const endLine = typeof note.endLine === 'number' ? Math.max(line, Math.floor(note.endLine)) : line
  return {
    id: note.id,
    path: note.path,
    line,
    endLine,
    kind: note.kind,
    body: note.body,
    at: typeof note.at === 'number' ? note.at : 0,
  }
}

type NotesFile = Record<string, { notes: unknown; touchedAt?: number }>

function readAll(file = NOTES_FILE): NotesFile {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof raw === 'object' && raw !== null ? (raw as NotesFile) : {}
  } catch {
    return {}
  }
}

/** This project's notes. Anything unreadable means "no notes", never an error. */
export function loadNotes(rootDir: string, file = NOTES_FILE): ReviewNote[] {
  const entry = readAll(file)[rootDir]
  if (!entry || !Array.isArray(entry.notes)) return []
  return entry.notes.map(parseNote).filter((note): note is ReviewNote => note !== null)
}

export function saveNotes(
  rootDir: string,
  notes: ReviewNote[],
  now = Date.now(),
  file = NOTES_FILE,
): void {
  try {
    const all = readAll(file)
    if (notes.length === 0) delete all[rootDir]
    else all[rootDir] = { notes, touchedAt: now }

    const trimmed = Object.entries(all)
      .toSorted((a, b) => (b[1].touchedAt ?? 0) - (a[1].touchedAt ?? 0))
      .slice(0, MAX_PROJECTS)

    fs.mkdirSync(dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(trimmed), null, 2)}\n`)
  } catch {
    // best-effort — losing a draft note is never worth interrupting the editor
  }
}

/** One line of the export, whether it started as a draft note or a forge comment. */
export interface ReviewEntry {
  /** `ISSUE`, `SUGGESTION`, `QUESTION`, `NOTE` — what the item is. */
  label: string
  /** Path as the reader knows it: relative to the project root. */
  rel: string
  /** 1-based, as an editor and a forge both quote line numbers. */
  line: number | null
  /** The code the remark is about, already cut to a sensible length. */
  snippet: string[]
  /** Fence tag for `snippet`; empty for a file whose language is unknown. */
  language: string
  body: string
  /** Set when the item came from the forge rather than from this editor. */
  author?: string
}

/** The opening line, and the one thing in the block that is not the user's own words. */
export const REVIEW_INTRO = 'I reviewed the diff and need you to address the following items:'

/**
 * The block that goes on the clipboard.
 *
 * Shaped for an agent to act on rather than for a person to skim: one numbered
 * item per remark, the location as `path:line` so a tool can open it, the code
 * quoted so the model does not have to guess what was meant, and the remark
 * itself under **Instruction:** — the imperative an agent reads as the task.
 */
export function reviewMarkdown(entries: ReviewEntry[], intro = REVIEW_INTRO): string {
  if (entries.length === 0) return ''
  const out: string[] = [intro, '']
  entries.forEach((entry, at) => {
    const where = entry.line === null ? entry.rel : `${entry.rel}:${entry.line}`
    out.push(`${at + 1}. **[${entry.label}]** \`${where}\``)
    if (entry.snippet.length > 0) {
      // Quoted *and* fenced: the block sits inside a numbered item, and a bare
      // fence there ends the list in most renderers.
      out.push(`> \`\`\`${entry.language}`)
      for (const line of entry.snippet) out.push(`> ${line}`)
      out.push('> ```')
    }
    const body = entry.body.trim()
    if (entry.author) out.push(`**Comment from @${entry.author}:** ${body}`)
    else out.push(`**Instruction:** ${body}`)
    out.push('')
  })
  return `${out.join('\n').trimEnd()}\n`
}

/** How many lines of code an item quotes before it is cut short. */
export const MAX_SNIPPET_LINES = 12

/**
 * The lines `from`..`to` of `content`, capped. A note on a fifty-line selection
 * is a note about the shape of the thing, and pasting all fifty lines into a
 * prompt buys nothing that the path and the first few do not.
 */
export function snippetOf(content: string, from: number, to: number): string[] {
  const lines = content.split('\n')
  const start = Math.max(0, Math.min(from, lines.length - 1))
  const end = Math.max(start, Math.min(to, lines.length - 1))
  const taken = lines.slice(start, Math.min(end + 1, start + MAX_SNIPPET_LINES))
  if (end - start + 1 > MAX_SNIPPET_LINES)
    taken.push(`… ${end - start + 1 - MAX_SNIPPET_LINES} more lines`)
  return taken
}
