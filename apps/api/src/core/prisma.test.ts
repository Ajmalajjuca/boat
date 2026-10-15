import { describe, expect, it } from 'vitest'
import { createPrisma, databaseCheck } from './prisma'

describe('databaseCheck', () => {
  // 10.255.255.1 is a non-routable address: connections neither succeed nor get refused.
  it('fails within seconds when the database never answers', async () => {
    const db = createPrisma('postgresql://boat_app:x@10.255.255.1:5432/boat')
    try {
      await expect(databaseCheck(db)()).rejects.toThrow()
    } finally {
      await db.$disconnect()
    }
  }, 10_000)
})
