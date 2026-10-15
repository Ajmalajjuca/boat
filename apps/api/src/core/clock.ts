import { today } from '@boat/domain/calculations'
import type { SettingsService } from '../modules/settings/settings.service'

// "Today" as YYYY-MM-DD in the company time zone, for the no-future-date rules and lot flags.
// Tests pass a fixed now, so date rules don't depend on when the tests run.
export type Clock = { today(): Promise<string> }

export const createClock = (
  settings: SettingsService,
  now: () => Date = () => new Date(),
): Clock => ({
  async today() {
    return today((await settings.get()).timeZone, now())
  },
})
