import { PermissionError } from '@boat/domain/permissions'
import { ValidationError } from '@boat/domain/validation'
import type { ErrorRequestHandler } from 'express'

// 401: no session, an expired one, or a failed sign-in (which carries a message).
export class UnauthenticatedError extends Error {}
// 404: missing, soft-deleted, or an id that cannot exist.
export class NotFoundError extends Error {}
// 409: refused because of other records (last admin, version conflict, value in use).
export class ConflictError extends Error {
  current?: unknown
  constructor(message: string, current?: unknown) {
    super(message)
    this.current = current
  }
}

const clientErrors: Record<number, string> = {
  400: 'bad_request',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
}

// Our own errors map to the PRD's error shapes. Errors from Express and body-parser carry a 4xx
// status: the client's fault, answered as such. Everything else is an unexpected failure.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err instanceof ValidationError) {
    res.status(422).json({ error: 'validation', fields: err.fields })
    return
  }
  if (err instanceof PermissionError) {
    res.status(403).json({ error: 'forbidden', message: err.message })
    return
  }
  if (err instanceof UnauthenticatedError) {
    res
      .status(401)
      .json(
        err.message
          ? { error: 'unauthenticated', message: err.message }
          : { error: 'unauthenticated' },
      )
    return
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  if (err instanceof ConflictError) {
    res.status(409).json({
      error: 'conflict',
      message: err.message,
      ...(err.current === undefined ? {} : { current: err.current }),
    })
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
