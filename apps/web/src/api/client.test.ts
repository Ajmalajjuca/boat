import { ValidationError } from '@boat/domain/validation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  api,
  ApiError,
  ConflictError,
  forbiddenMessage,
  NotFoundError,
  queryString,
  setCsrfToken,
  UnauthenticatedError,
  unreachableMessage,
  whenSessionEnds,
} from './client'

const fetchMock = vi.fn<typeof fetch>()
const reply = (status: number, body?: unknown) =>
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
// A call that should fail: its error, typed for the assertions below.
const fail = (): never => {
  throw new Error('Expected the call to fail.')
}
const caught = (e: unknown) => e as Error & { fields?: Record<string, string>; current?: unknown }
const sent = () => fetchMock.mock.calls.at(-1)!
const headers = () => new Headers(sent()[1]!.headers)

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  whenSessionEnds(() => {})
})

describe('requests', () => {
  it('sends the CSRF token on writes only, under /api/v1', async () => {
    reply(200, { items: [] })
    expect(await api.get('/lots')).toEqual({ items: [] })
    expect(sent()[0]).toBe('/api/v1/lots')
    expect(headers().get('x-csrf-token')).toBeNull()
    reply(201, { id: 'x' })
    await api.post('/lots', { label: 'L1' })
    expect(headers().get('x-csrf-token')).toBe('csrf-1')
    expect(headers().get('content-type')).toBe('application/json')
    expect(sent()[1]!.body).toBe('{"label":"L1"}')
  })
  it('answers 204 with undefined', async () => {
    reply(204)
    expect(await api.delete('/lots/1')).toBeUndefined()
  })
  it('builds query strings with repeated flags and no empty values', () => {
    expect(queryString({})).toBe('')
    expect(queryString({ q: 'a b', view: 'active', flag: ['rm', 'npi'], stageId: undefined })).toBe(
      '?q=a+b&view=active&flag=rm&flag=npi',
    )
    expect(queryString({ q: '', page: 2 })).toBe('?page=2')
  })
})

describe('errors', () => {
  it('turns a 422 into the domain ValidationError, renaming fields for the form', async () => {
    reply(422, { error: 'validation', fields: { categoryId: 'Choose a category.', label: 'Bad.' } })
    const err = await api
      .post('/lots', {}, { fields: (n) => (n === 'categoryId' ? 'category' : n) })
      .then(fail, caught)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.fields).toEqual({ category: 'Choose a category.', label: 'Bad.' })
  })
  it('keeps the server record on a 409', async () => {
    reply(409, { error: 'conflict', message: 'Someone else changed this lot.', current: { id: 1 } })
    const err = await api.patch('/lots/1', { version: 1 }).then(fail, caught)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toBe('Someone else changed this lot.')
    expect(err.current).toEqual({ id: 1 })
  })
  it('reports an ended session on a 401, except on public calls', async () => {
    const ended = vi.fn()
    whenSessionEnds(ended)
    reply(401, { error: 'unauthenticated' })
    expect(await api.get('/lots').then(fail, caught)).toBeInstanceOf(UnauthenticatedError)
    expect(ended).toHaveBeenCalledTimes(1)
    reply(401, { error: 'unauthenticated', message: 'Email or password is incorrect.' })
    const err = await api.post('/auth/login', {}, { public: true }).then(fail, caught)
    expect(err.message).toBe('Email or password is incorrect.')
    expect(ended).toHaveBeenCalledTimes(1)
  })
  it('uses fixed copy for 403, 404, 5xx and network failures', async () => {
    reply(403, { error: 'forbidden', message: "Viewer profiles can't create lots." })
    expect((await api.post('/lots').then(fail, caught)).message).toBe(forbiddenMessage)
    reply(404, { error: 'not_found' })
    expect(await api.get('/lots/1').then(fail, caught)).toBeInstanceOf(NotFoundError)
    reply(500, { error: 'internal' })
    const failed = await api.get('/lots').then(fail, caught)
    expect(failed).toBeInstanceOf(ApiError)
    expect(failed.message).toBe(unreachableMessage)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await api.get('/lots').then(fail, caught)).message).toBe(unreachableMessage)
  })
  it("passes the server's message on a 429", async () => {
    reply(429, { error: 'rate_limited', message: 'Too many failed attempts.' })
    expect((await api.post('/auth/login', {}, { public: true }).then(fail, caught)).message).toBe(
      'Too many failed attempts.',
    )
  })
})
