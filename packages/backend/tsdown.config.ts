import { defineConfig } from 'tsdown'

// One bundle in dist/index.js. Workspace packages ship TypeScript source,
// so they are bundled in; npm dependencies stay in node_modules.
export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  deps: { alwaysBundle: [/^@saystreet\//] },
})
