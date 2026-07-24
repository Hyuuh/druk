import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'druk',
  entry: ['./src/index.tsx'],
  platform: 'node',
  format: 'esm',
  dts: false,
  // package.json dependencies (native FFI + wasm) are externalized automatically
  // and resolved from node_modules at runtime.
  // The JSON grammar query is read from disk at runtime; ship it beside the bundle.
  copy: [{ from: './src/grammars', to: './dist' }],
})
