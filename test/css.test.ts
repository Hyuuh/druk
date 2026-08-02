import { describe, expect, test } from 'bun:test'

import { getSyntaxStyle } from '../src/languages/highlight'
import { allSegments } from './syntax'

/** What each group got painted on, so a query change shows up as text, not ids. */
async function painted(source: string, filetype: string) {
  const segments = await allSegments(source, filetype)
  const lines = source.split('\n')
  const style = getSyntaxStyle()
  const byGroup = new Map<number, string[]>()
  for (const segment of segments) {
    const text = lines[segment.line]?.slice(segment.start, segment.end) ?? ''
    if (!text.trim()) continue
    byGroup.set(segment.styleId, [...(byGroup.get(segment.styleId) ?? []), text])
  }
  return (group: string) => byGroup.get(style.getStyleId(group)!) ?? []
}

const TAILWIND = `@import 'tailwindcss';
@extension 'tailwind-scrollbar';
@custom-variant dark (&:is(.dark *));
@theme inline {
  --text-2xs: 0.6875rem;
  --color-ring: var(--ring);
}
`

const PLAIN = `/* a note */
@media screen and (min-width: 640px) {
  .card:hover > a[href^="#"]::before {
    color: #ff8800;
    margin: 0 auto !important;
  }
}
`

describe('css highlighting', () => {
  test('paints values, properties and selectors, not just brackets', async () => {
    const group = await painted(PLAIN, 'css')

    expect(group('comment')).toContain('/* a note */')
    expect(group('property')).toContain('color')
    expect(group('property')).toContain('margin')
    expect(group('constant')).toContain('#ff8800')
    expect(group('number')).toContain('640')
    expect(group('type')).toContain('px')
    expect(group('constructor')).toContain('card')
    expect(group('attribute')).toContain('hover')
    expect(group('attribute')).toContain('before')
    expect(group('keyword')).toContain('!important')
    // Bare values must not fall back to the plain text colour.
    expect(group('variable')).toContain('auto')
  })

  test('at-rules read as directives, including the ones Tailwind invents', async () => {
    const group = await painted(TAILWIND, 'css')
    const directives = group('keyword.directive')

    // `@media` and `@import` are anonymous tokens; the rest are (at_keyword).
    expect(directives).toContain('@import')
    expect(directives).toContain('@extension')
    expect(directives).toContain('@theme')
    expect(directives).toContain('@custom-variant')
  })

  test('custom properties and var() are not left plain', async () => {
    const group = await painted(TAILWIND, 'css')

    expect(group('property')).toContain('--text-2xs')
    expect(group('property')).toContain('--color-ring')
    expect(group('function')).toContain('var')
    expect(group('string')).toContain("'tailwindcss'")
  })

  test('the query compiles — a single bad pattern would paint nothing at all', async () => {
    // `["from" "to"]` used to be in here. They are keyframe selectors in this
    // grammar rather than anonymous tokens, and naming them silently killed
    // every other rule in the file.
    const segments = await allSegments(PLAIN, 'css')
    expect(segments.length).toBeGreaterThan(20)
  })
})

describe('scss and sass', () => {
  test('scss keeps nesting, mixins and variables lit', async () => {
    const group = await painted(
      '$brand: #f00;\n@mixin flex { display: flex; }\n.card {\n  color: $brand;\n  &:hover { top: 1px; }\n}\n',
      'scss',
    )

    expect(group('constant')).toContain('#f00')
    expect(group('keyword.directive')).toContain('@mixin')
    expect(group('constructor')).toContain('card')
    expect(group('attribute')).toContain('hover')
    expect(group('type')).toContain('px')
  })

  test('indented sass still colours what it can', async () => {
    // The CSS grammar cannot parse the indented syntax, so this asserts the
    // graceful part: values stay lit even where the structure is not understood.
    const group = await painted('$brand: #f00\n.card\n  top: 1px\n', 'sass')

    expect(group('constant')).toContain('#f00')
    expect(group('number')).toContain('1')
    expect(group('type')).toContain('px')
  })
})
