import { type FieldErrors, ValidationError } from '@boat/domain/validation'
import { z } from 'zod'
import { NotFoundError } from './errors'

// Checks a request's shape. Zod messages become the field map the forms already show; business
// rules run afterwards in the service, through the domain validators.
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
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
