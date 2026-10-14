import type { ErrorRequestHandler } from 'express'

// Body-parser errors carry a type; everything else is an unexpected failure.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', message: 'The request body is not valid JSON.' })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'payload_too_large' })
    return
  }
  req.log.error({ err }, 'unhandled error')
  res.status(500).json({ error: 'internal' })
}
