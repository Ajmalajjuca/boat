import { type FieldErrors, ValidationError } from '@boat/domain/validation'

// Errors the API answers with (PRD "Error shape"). A 422 becomes the domain's ValidationError, so
// forms read it with fieldErrors as they did before the API.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
// 409: a stale version (with the server's current record) or a rule about other records.
export class ConflictError extends ApiError {
  constructor(
    message: string,
    readonly current?: unknown,
  ) {
    super(409, message)
    this.name = 'ConflictError'
  }
}
export class UnauthenticatedError extends ApiError {
  constructor(message = 'Your session ended. Sign in again.') {
    super(401, message)
    this.name = 'UnauthenticatedError'
  }
}
export class NotFoundError extends ApiError {
  constructor() {
    super(404, 'This record no longer exists.')
    this.name = 'NotFoundError'
  }
}
export const forbiddenMessage = "You don't have permission to do that."
export const unreachableMessage = "Couldn't reach the server — try again."

export type CallOptions = {
  // Renames the server's field names to the form's before the ValidationError is thrown.
  fields?: (name: string) => string
  // A 401 here is an answer (a wrong password, no session yet), not a session that ended.
  public?: boolean
}

let csrfToken = ''
let sessionEnded: () => void = () => {}
export const setCsrfToken = (token: string) => {
  csrfToken = token
}
// The auth provider registers this, so any request that finds the session gone signs out.
export const whenSessionEnds = (handler: () => void) => {
  sessionEnded = handler
}

const base = '/api/v1'

async function send(method: string, path: string, body: unknown) {
  try {
    return await fetch(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(method !== 'GET' && csrfToken && { 'x-csrf-token': csrfToken }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, unreachableMessage)
  }
}

type ErrorBody = { message?: unknown; current?: unknown; fields?: Record<string, unknown> }

function toError(status: number, data: ErrorBody | undefined, options: CallOptions): Error {
  const message = typeof data?.message === 'string' ? data.message : undefined
  switch (status) {
    case 401:
      if (!options.public) sessionEnded()
      return new UnauthenticatedError(message)
    case 403:
      return new ApiError(403, forbiddenMessage)
    case 404:
      return new NotFoundError()
    case 409:
      return new ConflictError(message ?? 'Someone else changed this record.', data?.current)
    case 422: {
      const fields: FieldErrors = {}
      for (const [name, text] of Object.entries(data?.fields ?? {}))
        fields[options.fields ? options.fields(name) : name] ??= String(text)
      return new ValidationError(fields)
    }
    case 429:
      return new ApiError(429, message ?? 'Too many attempts. Wait a few minutes and try again.')
    default:
      return new ApiError(status, status >= 500 || !message ? unreachableMessage : message)
  }
}

async function call<T>(method: string, path: string, body: unknown, options: CallOptions = {}) {
  const res = await send(method, path, body)
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => undefined)
  if (!res.ok) throw toError(res.status, data, options)
  return data as T
}

export const api = {
  get: <T>(path: string, options?: CallOptions) => call<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: CallOptions) =>
    call<T>('POST', path, body ?? {}, options),
  patch: <T>(path: string, body: unknown, options?: CallOptions) =>
    call<T>('PATCH', path, body, options),
  delete: (path: string, options?: CallOptions) => call<void>('DELETE', path, undefined, options),
}

export function queryString(
  params: Record<string, string | number | boolean | string[] | undefined>,
) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

// Saves a file the server builds (CSV, JSON backup) under the name it gives.
export async function download(path: string) {
  const res = await send('GET', path, undefined)
  if (!res.ok) throw toError(res.status, await res.json().catch(() => undefined), {})
  const name =
    /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download'
  const url = URL.createObjectURL(await res.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
