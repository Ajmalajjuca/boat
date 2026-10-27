import { normalizeEmail } from '@boat/domain/validation'
import type { Request, RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'

const windowMs = 15 * 60_000
const message = 'Too many failed attempts. Wait 15 minutes and try again.'

// The counts live in this process, which is enough for one Render instance; a restart clears
// them. The per-IP key relies on `trust proxy` (createApp's trustProxy) behind Render's proxy.
function limiter({
  countSuccess,
  key,
}: {
  countSuccess: boolean
  key?: (req: Request) => string
}): RequestHandler {
  return rateLimit({
    windowMs,
    limit: 5,
    skipSuccessfulRequests: !countSuccess,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(key && { keyGenerator: key }),
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited', message })
    },
  })
}
const byEmail = (req: Request) => `email:${normalizeEmail(String(req.body?.email ?? ''))}`

// PRD: 5 failed sign-ins per 15 minutes per IP address and per account.
export const failedAttemptLimiters = () => [
  limiter({ countSuccess: false }),
  limiter({ countSuccess: false, key: byEmail }),
]

// Changing a password needs a session, but a stolen session must not be able to guess the
// current password at full speed.
export const ipFailureLimiter = () => limiter({ countSuccess: false })
