import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger } from './logger'

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString())
      done()
    },
  })
  return { lines, stream }
}

describe('createLogger', () => {
  // The same shape pino-http logs for every request.
  it('redacts session cookies and CSRF tokens', () => {
    const { lines, stream } = capture()
    createLogger('info', stream).info(
      {
        req: {
          headers: {
            cookie: 'boat_session=secret-token',
            'x-csrf-token': 'csrf-secret',
            'user-agent': 'test-agent',
          },
        },
        res: { headers: { 'set-cookie': 'boat_session=new-secret' } },
      },
      'request completed',
    )
    const out = lines.join('')
    expect(out).not.toMatch(/secret/)
    expect(out).toContain('test-agent')
  })
})
