import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const apiDir = path.join(repo, 'apps/api')
export const runDir = path.join(repo, 'e2e/.run')
export const logFile = path.join(runDir, 'api.log')
export const port = Number(process.env.E2E_PORT ?? 3100)
export const appUrl = `http://localhost:${port}`
export const sessionSecret = 'e2e-only-session-secret-0123456789abcdef'
export const password = 'correct horse battery staple'

export type RoleName = 'admin' | 'planner' | 'poc' | 'viewer'
export const roleNames: RoleName[] = ['admin', 'planner', 'poc', 'viewer']
export const users: Record<RoleName, { email: string; name: string }> = {
  admin: { email: 'admin@e2e.test', name: 'Ada Admin' },
  planner: { email: 'planner@e2e.test', name: 'Pat Planner' },
  poc: { email: 'poc@e2e.test', name: 'Maya Shah' },
  viewer: { email: 'viewer@e2e.test', name: 'Vic Viewer' },
}
// Google sign-in runs against @boat/oidc-stub with this client; every e2e user is on the
// company domain.
export const googleClient = { id: 'e2e-client', secret: 'e2e-client-secret' }
export const companyDomain = 'e2e.test'
// The point-of-contact value the seeded POC user owns.
export const pocValue = 'Maya Shah'
// Each seeded user's signed-in browser state, written by global setup.
export const authFile = (role: RoleName) => path.join(runDir, `${role}.json`)
