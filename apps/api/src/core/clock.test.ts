import { describe, expect, it } from 'vitest'
import type { SettingsService } from '../modules/settings/settings.service'
import { createClock } from './clock'

const settingsIn = (timeZone: string) =>
  ({
    get: async () => ({ timeZone, idleTimeoutMinutes: 15 }),
    update: async () => ({ timeZone, idleTimeoutMinutes: 15 }),
    forget: () => {},
  }) as SettingsService

describe('createClock', () => {
  // 20:00 UTC on 14 Oct is already 15 Oct in India.
  const now = () => new Date('2026-10-14T20:00:00Z')
  it('gives the date in the company time zone', async () => {
    expect(await createClock(settingsIn('Asia/Kolkata'), now).today()).toBe('2026-10-15')
    expect(await createClock(settingsIn('UTC'), now).today()).toBe('2026-10-14')
  })
  it('reads the real time by default', async () => {
    expect(await createClock(settingsIn('UTC')).today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
