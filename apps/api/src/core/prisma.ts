import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import type { ReadinessCheck } from '../modules/health/health.router'

export function createPrisma(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

export const databaseCheck =
  (db: PrismaClient): ReadinessCheck =>
  async () => {
    await db.$queryRaw`SELECT 1`
  }
