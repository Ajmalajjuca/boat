import type { ApiDeps } from './api'
import { memoryMailer } from './core/mailer'
import type { PrismaClient } from './generated/prisma/client'

// Dependencies for unit tests that never reach the database. Integration tests pass a real
// Prisma client (test/support/fixtures.ts).
export const testDeps = (overrides: Partial<ApiDeps> = {}): ApiDeps => ({
  db: {} as PrismaClient,
  checkDatabase: async () => {},
  sessionSecret: 'test-session-secret-0123456789abcdef',
  appUrl: 'http://localhost:5173',
  secureCookies: false,
  mailer: memoryMailer(),
  ...overrides,
})
