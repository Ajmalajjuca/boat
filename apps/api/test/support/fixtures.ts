import type { Role } from '@boat/domain/models'
import type { PrismaClient } from '../../src/generated/prisma/client'
import { hashPassword } from '../../src/modules/auth/password'

export const password = 'correct horse battery staple'

let counter = 0
export const unique = (prefix: string) => `${prefix} ${++counter}-${Date.now().toString(36)}`

export const makePoc = (db: PrismaClient, value = unique('POC')) =>
  db.lookupValue.create({ data: { kind: 'poc', value } })

type UserFields = {
  role?: Role
  status?: 'invited' | 'active' | 'disabled'
  pocId?: string | null
  email?: string
  name?: string
  // null: no password yet, like a user who hasn't accepted their invite.
  password?: string | null
}
export async function makeUser(db: PrismaClient, fields: UserFields = {}) {
  const pw = fields.password === undefined ? password : fields.password
  return db.user.create({
    data: {
      email: fields.email ?? `${unique('user').replace(/\W/g, '')}@example.com`,
      name: fields.name ?? 'Test User',
      role: fields.role ?? 'planner',
      status: fields.status ?? 'active',
      pocId: fields.pocId ?? null,
      passwordHash: pw ? await hashPassword(pw) : null,
    },
  })
}
