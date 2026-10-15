import { type DestinationStream, pino } from 'pino'

// Anyone reading the logs could act as the user with a session cookie or CSRF token.
const redact = {
  paths: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
  censor: '[redacted]',
}

export function createLogger(level: string, destination?: DestinationStream) {
  return destination ? pino({ level, redact }, destination) : pino({ level, redact })
}
