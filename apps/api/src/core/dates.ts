import { z } from 'zod'

// Business dates are YYYY-MM-DD with no time zone. Prisma returns Postgres `date` columns as
// Dates at UTC midnight, so every conversion goes through UTC.
const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export const isoDate = z
  .string({ error: 'Enter a date.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Use the format YYYY-MM-DD.' })
  .refine(realDate, { error: 'This date does not exist.' })

// Optional date fields take '' or null for "not set". A bad date reports isoDate's own message.
export const optionalDate = z.preprocess((v) => (v === '' ? null : v), isoDate.nullable())

export const toDbDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null)
export const fromDbDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
