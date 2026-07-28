import { createSignal } from 'solid-js'

import type { Tone } from '../ui/StatusBar'

/** Idle: the footer shows contextual key hints instead of a message. */
export const READY = ''

/** The status bar's message and the one progress slot long operations share. */
export function createStatus() {
  const [status, setStatus] = createSignal<{ msg: string; tone: Tone }>({
    msg: READY,
    tone: 'info',
  })
  /** A long file operation in flight, so the bar can count instead of freezing. */
  const [busy, setBusy] = createSignal<{ label: string; done: number; total: number } | null>(null)

  const say = (msg: string, tone: Tone = 'info') => setStatus({ msg, tone })

  /**
   * One at a time. The operations run in the background, so a second delete
   * started while the first is going would share the one progress slot and clear
   * it early — and both would be rewriting the same tree underneath each other.
   */
  const whileFree = (run: () => void) => {
    const running = busy()
    if (running) return say(`${running.label} already — let it finish`, 'warn')
    run()
  }

  return { status, say, busy, setBusy, whileFree }
}

export type Status = ReturnType<typeof createStatus>
