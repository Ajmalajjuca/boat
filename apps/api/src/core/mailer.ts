import type { Logger } from 'pino'
import type { Config } from '../config'

export type Email = { to: string; subject: string; text: string }
export type Mailer = { send(email: Email): Promise<void> }

// Resend's send-email endpoint: https://resend.com/docs/api-reference/emails/send-email
export function resendMailer({
  apiKey,
  from,
  fetch = globalThis.fetch,
}: {
  apiKey: string
  from: string
  fetch?: typeof globalThis.fetch
}): Mailer {
  return {
    async send({ to, subject, text }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${await res.text()}`)
    },
  }
}

// Development without RESEND_API_KEY: the email, link included, is written to the log.
export const logMailer = (logger: Logger): Mailer => ({
  async send(email) {
    logger.info({ email }, 'email not sent: RESEND_API_KEY is not set')
  },
})

// Tests read what would have been sent.
export function memoryMailer() {
  const sent: Email[] = []
  return {
    sent,
    async send(email: Email) {
      sent.push(email)
    },
  }
}
export const failingMailer = (): Mailer => ({
  async send() {
    throw new Error('mail server down')
  },
})

// loadConfig requires a key in production, and a sender whenever a key is set.
export const createMailer = (config: Config, logger: Logger): Mailer =>
  config.RESEND_API_KEY
    ? resendMailer({ apiKey: config.RESEND_API_KEY, from: config.MAIL_FROM! })
    : logMailer(logger)

// A failed email must not undo the change that triggered it (the user still exists, and an admin
// can resend), so it is logged and reported to the caller instead of thrown.
export async function sendOrLog(mailer: Mailer, log: Logger, email: Email) {
  try {
    await mailer.send(email)
    return true
  } catch (err) {
    log.error({ err, to: email.to, subject: email.subject }, 'email failed')
    return false
  }
}
