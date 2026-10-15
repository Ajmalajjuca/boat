import { describe, expect, it } from 'vitest'
import { memoryMailer, resendMailer } from './mailer'

const email = { to: 'asha@example.com', subject: 'Hi', text: 'Hello' }

describe('resendMailer', () => {
  it("posts the email to Resend's API with the key", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! })
      return new Response('{"id":"1"}', { status: 200 })
    }
    await resendMailer({ apiKey: 're_123', from: 'BOAT <noreply@example.com>', fetch }).send(email)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    expect(calls[0].init.method).toBe('POST')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer re_123')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: 'BOAT <noreply@example.com>',
      to: ['asha@example.com'],
      subject: 'Hi',
      text: 'Hello',
    })
  })
  it('fails loudly when Resend refuses', async () => {
    const fetch = async () => new Response('{"message":"invalid from"}', { status: 422 })
    await expect(resendMailer({ apiKey: 're_123', from: 'x', fetch }).send(email)).rejects.toThrow(
      /422/,
    )
  })
})

describe('memoryMailer', () => {
  it('keeps what it was asked to send', async () => {
    const mailer = memoryMailer()
    await mailer.send(email)
    expect(mailer.sent).toEqual([email])
  })
})
