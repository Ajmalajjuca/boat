import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The domain package ships TypeScript source, so it must be bundled, not imported at runtime.
  noExternal: ['@boat/domain'],
})
