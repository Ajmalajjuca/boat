import type { MePayload, NewUser } from '@boat/domain/api'
import type { Role } from '@boat/domain/models'
import { type APIRequestContext, request } from '@playwright/test'
import { appUrl, authFile, password, type RoleName } from './env'
import { nextEmail, tokenIn } from './mail'

// Test setup and checks go through the API, as a real signed-in user with the CSRF token.
export type Api = {
  me: MePayload
  // Responses default to any to keep setup code short; tests check the fields they rely on.
  get<T = any>(path: string): Promise<T>
  post<T = any>(path: string, data?: unknown): Promise<T>
  patch<T = any>(path: string, data: unknown): Promise<T>
  delete(path: string): Promise<void>
  dispose(): Promise<void>
}

function wrap(ctx: APIRequestContext, me: MePayload): Api {
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await ctx.fetch(`/api/v1${path}`, {
      method,
      data,
      headers: { 'x-csrf-token': me.csrfToken },
    })
    if (!res.ok())
      throw new Error(`${method} ${path} answered ${res.status()}: ${await res.text()}`)
    return res.status() === 204 ? undefined : res.json()
  }
  return {
    me,
    get: (path) => call('GET', path),
    post: (path, data) => call('POST', path, data ?? {}),
    patch: (path, data) => call('PATCH', path, data),
    delete: async (path) => {
      await call('DELETE', path)
    },
    dispose: () => ctx.dispose(),
  }
}

// A seeded user's API session, from the sign-in state global setup saved.
export async function apiAs(role: RoleName) {
  const ctx = await request.newContext({ baseURL: appUrl, storageState: authFile(role) })
  const res = await ctx.get('/api/v1/auth/me')
  if (!res.ok()) throw new Error(`The seeded ${role} is no longer signed in (${res.status()}).`)
  return wrap(ctx, await res.json())
}

export async function signInApi(email: string, pw: string) {
  const ctx = await request.newContext({ baseURL: appUrl })
  const res = await ctx.post('/api/v1/auth/login', { data: { email, password: pw } })
  if (!res.ok()) throw new Error(`Sign-in as ${email} answered ${res.status()}`)
  return wrap(ctx, await res.json())
}

// Accepting an invite starts a session; the returned context holds its cookie.
export async function acceptInvite(token: string, pw = password) {
  const ctx = await request.newContext({ baseURL: appUrl })
  const res = await ctx.post('/api/v1/auth/invites/accept', { data: { token, password: pw } })
  if (!res.ok())
    throw new Error(`Accepting the invite answered ${res.status()}: ${await res.text()}`)
  return { ctx, me: (await res.json()) as MePayload }
}

let counter = 0
// A user of its own, for tests that sign out, change a password or disable an account: doing
// that to a seeded user would end the saved session the other tests rely on.
export async function newUser(role: Role, pocId: string | null = null) {
  const admin = await apiAs('admin')
  counter += 1
  const email = `user-${Date.now().toString(36)}-${counter}@e2e.test`
  const name = `Test ${role} ${counter}`
  await admin.post('/users', { email, name, role, pocId } satisfies NewUser)
  await admin.dispose()
  const { ctx } = await acceptInvite(tokenIn((await nextEmail(email, 0)).text))
  await ctx.dispose()
  return { email, name, password }
}

export const resetPhrase = 'RESET ALL DATA'
// Soft-deletes every business record. Users, dropdown values and settings stay.
export async function resetData() {
  const admin = await apiAs('admin')
  await admin.post('/data/reset', { confirm: resetPhrase })
  await admin.dispose()
}
