import { expect, test } from 'bun:test'

import { fitKeys } from '../src/ui/DiffHeading'
import type { DiffKey } from '../src/ui/DiffHeading'

const keys: DiffKey[] = [
  { key: 'Tab', label: 'next file', rank: 1 },
  { key: '←→', label: 'fold', rank: 9 },
  { key: 's', label: 'layout', rank: 3, value: 'inline' },
  { key: 'Esc', label: 'close', rank: 0 },
]

const shown = (items: DiffKey[]) =>
  items.map((item) =>
    [item.key, item.label, item.value].filter(Boolean).join(' ')
  )

test('a row with room keeps every key as given', () => {
  expect(fitKeys(keys, 80)).toEqual(keys)
})

test('a narrow row drops the stateful key’s label before dropping keys', () => {
  expect(shown(fitKeys(keys, 46))).toEqual([
    'Tab next file',
    '←→ fold',
    's inline',
    'Esc close',
  ])
})

test('past that the highest rank goes first, in the order given, and Esc stays', () => {
  expect(shown(fitKeys(keys, 36))).toEqual([
    'Tab next file',
    's inline',
    'Esc close',
  ])
  expect(shown(fitKeys(keys, 30))).toEqual(['Tab next file', 'Esc close'])
  expect(shown(fitKeys(keys, 1))).toEqual(['Esc close'])
})
