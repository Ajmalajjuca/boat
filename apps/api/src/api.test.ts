import { describe, expect, it } from 'vitest'
import { buildApiRouter, mountPathOf } from './api'
import { accessOf } from './core/access'
import { testDeps } from './test-deps'

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] }
  handle: { stack?: Layer[] }
}

// Walks Express 5's router stack (router@2 internals) and lists "METHOD /path access" for each
// route, where access is the tag on the route's first handler. The permission table test below
// also fails if a future Express changes this shape and the walk finds nothing.
function routesOf(router: { stack?: Layer[] }, prefix = ''): string[] {
  const found: string[] = []
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const access = accessOf(layer.route.stack[0]?.handle) ?? 'NONE'
      // A router's "/" route is the mount path itself: /users, not /users/.
      const path = prefix && layer.route.path === '/' ? prefix : prefix + layer.route.path
      for (const method of Object.keys(layer.route.methods))
        found.push(`${method.toUpperCase()} ${path} ${access}`)
    } else if (layer.handle.stack) {
      const mountPath = mountPathOf(layer.handle) ?? '/(mounted without mount())'
      found.push(...routesOf(layer.handle, prefix + mountPath))
    }
  }
  return found
}

const routes = routesOf(buildApiRouter(testDeps()) as unknown as { stack: Layer[] })

describe('API routes', () => {
  it('each start with an access check', () => {
    expect(routes.filter((r) => r.endsWith(' NONE'))).toEqual([])
  })
  // Every route and who may call it. Add a row with each new route, so a reviewer sees the
  // permission next to the path.
  it('match the permission table', () => {
    expect([...routes].sort()).toEqual(
      [
        'GET /health/live public',
        'GET /health/ready public',
        'POST /auth/login public',
        'POST /auth/logout signedIn',
        'GET /auth/me signedIn',
        'POST /auth/invites/accept public',
        'POST /auth/password/forgot public',
        'POST /auth/password/reset public',
        'PATCH /auth/me/password signedIn',
        'GET /users manageSettings',
        'POST /users manageSettings',
        'POST /users/:id/invite manageSettings',
        'PATCH /users/:id manageSettings',
        'DELETE /users/:id manageSettings',
      ].sort(),
    )
  })
})
