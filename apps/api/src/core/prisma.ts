import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import type { ReadinessCheck } from '../modules/health/health.router'

export function createPrisma(connectionString: string) {
  // pg waits forever for a connection by default, which would hang readiness checks and requests.
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }),
  })
}

export const databaseCheck =
  (db: PrismaClient): ReadinessCheck =>
  async () => {
    await db.$queryRaw`SELECT 1`
  }
