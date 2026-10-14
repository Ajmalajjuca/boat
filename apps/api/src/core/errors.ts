import type { ErrorRequestHandler } from 'express'

const clientErrors: Record<number, string> = {
  400: 'bad_request',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
}

// Errors from Express and body-parser carry a 4xx status: the client's fault, answered as such.
// Everything else is an unexpected failure.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', message: 'The request body is not valid JSON.' })
    return
  }
  const status = err?.status ?? err?.statusCode
  if (typeof status === 'number' && status >= 400 && status < 500) {
    req.log.warn({ err }, 'client error')
    res.status(status).json({ error: clientErrors[status] ?? 'bad_request' })
    return
  }
  req.log.error({ err }, 'unhandled error')
  res.status(500).json({ error: 'internal' })
}
