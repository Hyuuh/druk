/**
 * `with { type: 'file' }` imports resolve to a path string at runtime. TypeScript has
 * no notion of the attribute, so without these the grammar imports in
 * `languages/grammars.ts` fail to resolve under `tsc`.
 */
declare module '*.wasm' {
  const path: string
  export default path
}

declare module '*.scm' {
  const path: string
  export default path
}
