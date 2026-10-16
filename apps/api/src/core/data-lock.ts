import type { Db } from './prisma'

// Imports and resets rewrite many tables at once. They hold this lock exclusively for their whole
// transaction; every other change to business records holds it shared, before any row lock. A
// change then waits for a running import or reset (and the other way round) instead of
// interleaving with it, which could leave entries under deleted lots, or deadlock.
export const dataLock = 4_201_015

export const holdDataLockShared = (db: Db) =>
  db.$executeRaw`SELECT pg_advisory_xact_lock_shared(${dataLock})`

export const holdDataLockExclusive = (db: Db) =>
  db.$executeRaw`SELECT pg_advisory_xact_lock(${dataLock})`
