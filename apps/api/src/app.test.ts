import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pino } from 'pino'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'

const logger = pino({ level: 'silent' })
const ready = async () => {}
const app = (webDist?: string, checkDatabase = ready) =>
  createApp({ logger, webDist, checkDatabase })

function fakeWebBuild() {
  const dir = mkdtempSync(path.join(tmpdir(), 'boat-web-'))
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Boat</title>')
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)')
  return dir
}

describe('health', () => {
  it('reports live', async () => {
    const res = await request(app()).get('/api/v1/health/live')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
  it('reports ready when the database answers', async () => {
    const res = await request(app()).get('/api/v1/health/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
  it('returns 503 when the database check fails', async () => {
    const down = async () => {
      throw new Error('connection refused')
    }
    const res = await request(app(undefined, down)).get('/api/v1/health/ready')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'unavailable' })
  })
})

describe('request ids', () => {
  it('echoes an incoming x-request-id', async () => {
    const res = await request(app()).get('/api/v1/health/live').set('x-request-id', 'abc-123')
    expect(res.headers['x-request-id']).toBe('abc-123')
  })
  it('creates one when the request has none', async () => {
    const res = await request(app()).get('/api/v1/health/live')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('errors', () => {
  it('answers malformed JSON with 400', async () => {
    const res = await request(app())
      .post('/api/v1/health/live')
      .set('content-type', 'application/json')
      .send('{bad')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: 'bad_request',
      message: 'The request body is not valid JSON.',
    })
  })
  it('answers bodies over 1 MB with 413', async () => {
    const res = await request(app())
      .post('/api/v1/health/live')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1_100_000) }))
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'payload_too_large' })
  })
  it('answers unknown API paths with JSON 404 even when the web app is served', async () => {
    const server = app(fakeWebBuild())
    for (const url of ['/api/v1/lotz', '/api/other']) {
      const res = await request(server).get(url)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'not_found' })
    }
  })
})

describe('web app', () => {
  it('serves index.html for client-side routes', async () => {
    const res = await request(app(fakeWebBuild())).get('/shipments')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>Boat</title>')
  })
  it('serves static assets', async () => {
    const res = await request(app(fakeWebBuild())).get('/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.text).toBe('console.log(1)')
  })
  it('serves only the API when there is no web build', async () => {
    const res = await request(app(path.join(tmpdir(), 'no-such-build'))).get('/')
    expect(res.status).toBe(404)
  })
})
