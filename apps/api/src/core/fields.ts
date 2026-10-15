import { z } from 'zod'

// Whole-number and sign rules come from the domain validators; this keeps values inside
// Postgres's integer range, so a huge number is a 422 rather than a 500.
export const quantity = (label: string) =>
  z
    .number({ error: `Enter the ${label} as a number.` })
    .max(1_000_000_000, { error: 'Enter 1,000,000,000 or less.' })

export const text = (max: number) =>
  z.string({ error: 'Enter text.' }).max(max, { error: `Keep this to ${max} characters or fewer.` })
