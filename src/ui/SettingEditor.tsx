import type { KeyEvent } from '@opentui/core'
import { createSignal, For, Show } from 'solid-js'

import { ui } from '../themes'
import { modalWidth, PAD } from './modal'
import { ModalPanel } from './Overlay'
import { cut } from './text'
import { TextInput } from './TextInput'
import { useKeys } from './useKeys'

/** One input inside an edit. A lone field needs no label; several do. */
export interface SettingField {
  label?: string
  /** What the field opens holding — the value in force, or '' when adding. */
  initial: string
  placeholder?: string
}

/** A free-text edit floating over a page — the values no list can hold. */
export interface SettingEdit {
  title: string
  /** Drawn top to bottom; Tab moves between them, and `apply` gets them in order. */
  fields: SettingField[]
  /**
   * Lines under the fields, explaining what the values have to be. Worth
   * spelling out here rather than in docs: this modal *is* the documentation for
   * anything a page cannot offer as a list of values.
   */
  hint?: string[]
  apply: (values: string[]) => void
}

/** A form over a page: Enter applies what the fields hold, Esc walks away. */
export function SettingEditor(props: {
  edit: SettingEdit
  /** The overlay is confined to the page's pane, so the modal sizes to it. */
  paneWidth: number
  /** The typed values, in field order, or null for Esc. */
  onDone: (values: string[] | null) => void
}) {
  const [values, setValues] = createSignal(props.edit.fields.map(field => field.initial))
  const [focus, setFocus] = createSignal(0)
  const width = () => modalWidth(props.paneWidth, 0.7, 30, 60)
  const count = () => props.edit.fields.length

  useKeys((key: KeyEvent) => {
    if (key.defaultPrevented) return
    const k = key.name
    if (k === 'return' || k === 'enter') {
      key.preventDefault()
      props.onDone(values())
    } else if (k === 'escape') {
      key.preventDefault()
      props.onDone(null)
    } else if (count() > 1 && (k === 'tab' || k === 'up' || k === 'down')) {
      key.preventDefault()
      const dir = k === 'up' || (k === 'tab' && key.shift) ? -1 : 1
      setFocus(at => (at + dir + count()) % count())
    }
  })

  const setField = (at: number, value: string) =>
    setValues(previous => previous.map((old, i) => (i === at ? value : old)))

  return (
    <ModalPanel zIndex={150} width={width()} title={` ${props.edit.title} `}>
      <For each={props.edit.fields}>
        {(field, at) => (
          <>
            <Show when={field.label}>
              <text
                fg={at() === focus() ? ui.text : ui.dim}
                bg={ui.panelBg}
                content={field.label!}
              />
            </Show>
            {/* Two focused inputs would split the typing between them, so the
                  field without the cursor is drawn as plain text. */}
            <Show
              when={at() === focus()}
              fallback={
                <text
                  wrapMode="none"
                  fg={values()[at()] ? ui.dim : ui.faint}
                  bg={ui.panelBg}
                  content={cut(values()[at()] || field.placeholder || '', width() - PAD * 2)}
                />
              }
            >
              <TextInput
                value={values()[at()]!}
                placeholder={field.placeholder}
                onInput={value => setField(at(), value)}
              />
            </Show>
          </>
        )}
      </For>
      <text fg={ui.panelBg} bg={ui.panelBg} content="" />
      <For each={props.edit.hint ?? []}>
        {line => <text fg={ui.faint} bg={ui.panelBg} content={line} />}
      </For>
      <text
        fg={ui.dim}
        bg={ui.panelBg}
        content={
          count() > 1 ? 'Tab next field · Enter apply · Esc cancel' : 'Enter apply · Esc cancel'
        }
      />
    </ModalPanel>
  )
}
