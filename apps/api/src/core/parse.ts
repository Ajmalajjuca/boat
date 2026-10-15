import { type FieldErrors, ValidationError } from '@boat/domain/validation'
import { z } from 'zod'
import { NotFoundError } from './errors'

// Postgres text can't hold \u0000, so a pasted NUL would fail the query with a 500. Any string,
// at any depth of a body or query, is checked before the schema runs.
function nulPath(value: unknown, path: string[] = []): string[] | undefined {
  if (typeof value === 'string') return value.includes('\u0000') ? path : undefined
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = nulPath(item, [...path, String(i)])
      if (found) return found
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const found = nulPath(item, [...path, key])
      if (found) return found
    }
  }
  return undefined
}

// Checks a request's shape. Zod messages become the field map the forms already show; business
// rules run afterwards in the service, through the domain validators.
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const nul = nulPath(value)
  if (nul)
    throw new ValidationError({
      [nul.join('.') || 'form']: 'Remove the hidden NUL character from this text.',
    })
  const result = schema.safeParse(value ?? {})
  if (result.success) return result.data
  const fields: FieldErrors = {}
  for (const issue of result.error.issues) fields[issue.path.join('.') || 'form'] ??= issue.message
  throw new ValidationError(fields)
}

// Route ids are UUIDs. Anything else cannot exist, and Postgres would reject it with a 500.
// z.guid() accepts every 8-4-4-4-12 hex id, as Postgres does; z.uuid() would also check the
// version bits and refuse some ids in old browser backups.
export function parseId(value: unknown): string {
  const result = z.guid().safeParse(value)
  if (!result.success) throw new NotFoundError()
  return result.data
}
