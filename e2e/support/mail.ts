import { readFileSync } from 'node:fs'
import { logFile } from './env'

export type Email = { to: string; subject: string; text: string }

// Without RESEND_API_KEY or SMTP_HOST the API writes each email to its log instead of sending it (mailer.ts).
export function emailsTo(address: string): Email[] {
  let log = ''
  try {
    log = readFileSync(logFile, 'utf8')
  } catch {
    return []
  }
  return log.split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line) as { email?: Email }
      return entry.email?.to === address ? [entry.email] : []
    } catch {
      return []
    }
  })
}

// Waits for an email beyond the `seen` earlier ones and returns the newest.
export async function nextEmail(address: string, seen: number, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const all = emailsTo(address)
    if (all.length > seen) return all[all.length - 1]
    if (Date.now() > until) throw new Error(`No new email to ${address}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function linkIn(text: string) {
  const match = /(https?:\/\/\S+#token=[\w-]+)/.exec(text)
  if (!match) throw new Error(`No link in: ${text}`)
  return match[1]
}
export const tokenIn = (text: string) => new URL(linkIn(text)).hash.slice('#token='.length)
