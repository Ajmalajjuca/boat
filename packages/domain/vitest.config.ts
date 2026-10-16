import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-factories.ts', 'src/api.ts'],
      thresholds: { lines: 95 },
    },
  },
})
