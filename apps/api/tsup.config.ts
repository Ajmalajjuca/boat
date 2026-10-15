import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { server: 'src/server.ts', 'create-admin': 'src/cli/create-admin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The domain package ships TypeScript source, so it must be bundled, not imported at runtime.
  noExternal: ['@boat/domain'],
})
