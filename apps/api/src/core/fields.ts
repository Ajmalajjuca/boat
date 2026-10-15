import { z } from 'zod'

// Whole units from 0 to 1,000,000,000, in the domain validators' wording. Checked here too
// because some domain checks are conditional (validateLot checks readyQty only in "all received"
// mode), and Postgres would otherwise reject or truncate the value.
export const quantity = (label: string) => {
  const whole = `${label[0].toUpperCase()}${label.slice(1)} must be a whole number, zero or more.`
  return z
    .number({ error: `Enter the ${label} as a number.` })
    .int({ error: whole })
    .min(0, { error: whole })
    .max(1_000_000_000, { error: 'Enter 1,000,000,000 or less.' })
}

export const text = (max: number) =>
  z.string({ error: 'Enter text.' }).max(max, { error: `Keep this to ${max} characters or fewer.` })
