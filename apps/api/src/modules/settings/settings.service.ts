import type { PrismaClient } from '../../generated/prisma/client'

export type Settings = { timeZone: string; idleTimeoutMinutes: number }
export const defaultSettings: Settings = { timeZone: 'Asia/Kolkata', idleTimeoutMinutes: 15 }
const keys = Object.keys(defaultSettings)

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

  return { get }
}
