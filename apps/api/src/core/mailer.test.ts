import { describe, expect, it } from 'vitest'
import { memoryMailer, resendMailer, smtpMailer } from './mailer'

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

describe('smtpMailer', () => {
  it('hands the email to the SMTP transport from the configured sender', async () => {
    const sent: unknown[] = []
    const transporter = { sendMail: async (message: unknown) => sent.push(message) }
    await smtpMailer({ from: 'BOAT <a@gmail.com>', transporter }).send(email)
    expect(sent).toEqual([{ from: 'BOAT <a@gmail.com>', ...email }])
  })
  it('fails loudly when the server refuses', async () => {
    const transporter = {
      sendMail: async () => {
        throw new Error('535 Username and Password not accepted')
      },
    }
    await expect(smtpMailer({ from: 'x', transporter }).send(email)).rejects.toThrow(/535/)
  })
})

describe('memoryMailer', () => {
  it('keeps what it was asked to send', async () => {
    const mailer = memoryMailer()
    await mailer.send(email)
    expect(mailer.sent).toEqual([email])
  })
})
