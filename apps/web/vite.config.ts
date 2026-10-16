import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the API runs on its own port (apps/api/.env, PORT=3000); the proxy keeps requests
// same-origin, as on Render, so the session cookie and CSRF rules behave the same.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: { include: ['src/**/*.test.ts'] },
})
