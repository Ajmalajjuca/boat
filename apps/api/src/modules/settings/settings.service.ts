import type { PrismaClient } from '../../generated/prisma/client'

export type Settings = { timeZone: string; idleTimeoutMinutes: number }
export const defaultSettings: Settings = { timeZone: 'Asia/Kolkata', idleTimeoutMinutes: 15 }
const keys = Object.keys(defaultSettings)

// IANA names only ("Asia/Kolkata", "America/Argentina/Buenos_Aires", "UTC"). Intl also accepts
// offsets ("+05:30"), abbreviations ("IST") and any letter case, which other systems read
// differently, so those are refused even though today() would cope.
const ianaName = /^[A-Z][A-Za-z_-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/
export const knownTimeZone = (tz: string) => {
  if (tz !== 'UTC' && !ianaName.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export type SettingsService = ReturnType<typeof createSettingsService>

// Every signed-in request needs the idle timeout, so settings are cached in the process: reloaded
// after a change here, and at most a minute after a change made by another instance.
export function createSettingsService(db: PrismaClient, ttlMs = 60_000) {
  let cached: { value: Settings; at: number } | undefined

  async function get(): Promise<Settings> {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value
    const rows = await db.appSetting.findMany({ where: { key: { in: keys } } })
    const value = { ...defaultSettings }
    for (const { key, value: stored } of rows) {
      if (key === 'timeZone' && typeof stored === 'string') value.timeZone = stored
      if (key === 'idleTimeoutMinutes' && typeof stored === 'number')
        value.idleTimeoutMinutes = stored
    }
    cached = { value, at: Date.now() }
    return value
  }

  async function update(patch: Partial<Settings>, actorId: string) {
    const changed = Object.entries(patch).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    await db.$transaction(
      changed.map(([key, value]) =>
        db.appSetting.upsert({
          where: { key },
          create: { key, value, updatedBy: actorId },
          update: { value, updatedBy: actorId },
        }),
      ),
    )
    cached = undefined
    return get()
  }

  // For writes that bypass update() (an import), so the next read reloads.
  function forget() {
    cached = undefined
  }

  return { get, update, forget }
}
