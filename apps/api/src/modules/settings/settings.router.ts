import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission, requireSignedIn } from '../../core/access'
import { parseInput } from '../../core/parse'
import type { SettingsService } from './settings.service'

// IANA names only ("Asia/Kolkata", "America/Argentina/Buenos_Aires", "UTC"). Intl also accepts
// offsets ("+05:30"), abbreviations ("IST") and any letter case, which other systems read
// differently, so those are refused even though today() would cope.
const ianaName = /^[A-Z][A-Za-z_-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/
const knownTimeZone = (tz: string) => {
  if (tz !== 'UTC' && !ianaName.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Sessions also end 12 hours after sign-in, so a longer idle timeout would have no effect.
const patchBody = z.strictObject({
  timeZone: z
    .string({ error: 'Choose a time zone from the list.' })
    .refine(knownTimeZone, { error: 'Choose a time zone from the list.' })
    .optional(),
  idleTimeoutMinutes: z
    .number({ error: 'Enter a number of minutes.' })
    .int({ error: 'Enter whole minutes.' })
    .min(5, { error: 'Use 5 minutes or more.' })
    .max(720, { error: 'Use 720 minutes (12 hours) or fewer.' })
    .optional(),
})

export function settingsRouter(settings: SettingsService) {
  const router = Router()

  router.get('/', requireSignedIn(), async (_req, res) => {
    res.json(await settings.get())
  })

  router.patch('/', requirePermission('manageSettings'), async (req, res) => {
    res.json(await settings.update(parseInput(patchBody, req.body), authOf(req).user.id))
  })

  return router
}
