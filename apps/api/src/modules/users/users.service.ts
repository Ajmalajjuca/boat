import type { Role } from '@boat/domain/models'
import {
  assertValid,
  normalizeEmail,
  validateAccount,
  ValidationError,
} from '@boat/domain/validation'
import type { Logger } from 'pino'
import { ConflictError, NotFoundError } from '../../core/errors'
import { type Mailer, sendOrLog } from '../../core/mailer'
import { type Page, pageArgs, pageOf } from '../../core/pagination'
import type { Db } from '../../core/prisma'
import { Prisma, type PrismaClient } from '../../generated/prisma/client'
import { issueToken } from '../auth/auth-tokens'
import { inviteEmail, linkFor } from '../auth/emails'
import { revokeUserSessions } from '../auth/sessions'

export type UsersDeps = { db: PrismaClient; mailer: Mailer; appUrl: string }

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  poc: { select: { id: true, value: true } },
} satisfies Prisma.UserSelect
export type UserView = Prisma.UserGetPayload<{ select: typeof userSelect }>

export type NewUser = { email: string; name: string; role: Role; pocId: string | null }
export type UserPatch = {
  name?: string
  role?: Role
  pocId?: string | null
  status?: 'active' | 'disabled'
}

const pickPoc = 'Choose a point of contact from the list.'

export async function listUsers(db: PrismaClient, page: Page) {
  const where = { deletedAt: null }
  const [items, total] = await Promise.all([
    db.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      ...pageArgs(page),
    }),
    db.user.count({ where }),
  ])
  return pageOf(items, total, page)
}

async function assertPoc(db: Db, pocId: string | null) {
  if (!pocId) return
  const poc = await db.lookupValue.findFirst({
    where: { id: pocId, kind: 'poc', deletedAt: null },
    select: { id: true },
  })
  if (!poc) throw new ValidationError({ pocId: pickPoc })
}

// The partial unique index on email catches duplicates, including two admins adding one person
// at the same moment.
function rethrowDuplicateEmail(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    throw new ValidationError({ email: 'A user with this email already exists.' })
  throw err
}

// Locks every active admin row, then checks that someone other than userId stays an active
// admin. A second transaction doing the same waits for the first and then sees its result.
async function assertAnotherActiveAdmin(db: Db, userId: string, message: string) {
  const admins = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM users
    WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL
    FOR UPDATE`
  if (!admins.some((a) => a.id !== userId)) throw new ConflictError(message)
}

async function sendInvite(deps: UsersDeps, user: UserView, token: string, log: Logger) {
  const inviteEmailSent = await sendOrLog(deps.mailer, log, {
    to: user.email,
    ...inviteEmail(deps.appUrl, user.name, token),
  })
  return { user, inviteEmailSent, inviteUrl: linkFor(deps.appUrl, 'invite', token) }
}

export async function createUser(deps: UsersDeps, input: NewUser, log: Logger) {
  const account = {
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    role: input.role,
    pocId: input.role === 'poc' ? input.pocId : null,
  }
  assertValid(validateAccount(account))
  await assertPoc(deps.db, account.pocId)
  const { user, token } = await deps.db.$transaction(async (tx) => {
    const user = await tx.user
      .create({ data: { ...account, status: 'invited' }, select: userSelect })
      .catch(rethrowDuplicateEmail)
    return { user, token: await issueToken(tx, user.id, 'invite') }
  })
  return sendInvite(deps, user, token, log)
}

// For an invite that expired or went astray. Allowed until the user sets a password; it also
// brings a disabled, never-signed-in user back to "invited".
export async function resendInvite(deps: UsersDeps, id: string, log: Logger) {
  const { user, token } = await deps.db.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, passwordHash: true },
    })
    if (!current) throw new NotFoundError()
    if (current.passwordHash) throw new ConflictError(`${current.name} has already set a password.`)
    const user = await tx.user.update({
      where: { id },
      data: { status: 'invited' },
      select: userSelect,
    })
    return { user, token: await issueToken(tx, id, 'invite') }
  })
  return sendInvite(deps, user, token, log)
}

export async function updateUser(db: PrismaClient, id: string, patch: UserPatch) {
  return db.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        email: true,
        name: true,
        role: true,
        status: true,
        pocId: true,
        passwordHash: true,
      },
    })
    if (!current) throw new NotFoundError()
    const role = patch.role ?? current.role
    const next = {
      email: current.email,
      name: (patch.name ?? current.name).trim(),
      role,
      pocId: role === 'poc' ? (patch.pocId === undefined ? current.pocId : patch.pocId) : null,
    }
    assertValid(validateAccount(next))
    if (patch.status === 'active' && !current.passwordHash)
      throw new ValidationError({
        status: `${current.name} hasn't accepted their invite yet. Resend the invite instead.`,
      })
    const status = patch.status ?? current.status
    if (next.pocId !== current.pocId) await assertPoc(tx, next.pocId)
    if (
      current.role === 'admin' &&
      current.status === 'active' &&
      (role !== 'admin' || status !== 'active')
    )
      await assertAnotherActiveAdmin(
        tx,
        id,
        `${current.name} is the last active admin. Make someone else an admin first.`,
      )
    const user = await tx.user.update({
      where: { id },
      data: { name: next.name, role, pocId: next.pocId, status },
      select: userSelect,
    })
    // PRD: a role change revokes the user's sessions. Disabling must end them too.
    if (role !== current.role || status !== current.status) await revokeUserSessions(tx, id)
    return user
  })
}

export async function deleteUser(db: PrismaClient, actorId: string, id: string) {
  await db.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, role: true, status: true },
    })
    if (!current) throw new NotFoundError()
    if (current.role === 'admin' && current.status === 'active')
      await assertAnotherActiveAdmin(
        tx,
        id,
        `${current.name} is the last active admin. Make someone else an admin first.`,
      )
    const now = new Date()
    await tx.user.update({ where: { id }, data: { deletedAt: now, deletedBy: actorId } })
    await revokeUserSessions(tx, id)
    await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: now } })
  })
}

// A new deployment has no one to sign in as. This refuses once an active admin exists, so the
// command cannot quietly add admins later. Run again for a first admin who hasn't accepted yet,
// it sends a fresh invite.
export async function inviteFirstAdmin(
  deps: UsersDeps,
  input: { email: string; name: string },
  log: Logger,
) {
  const active = await deps.db.user.findFirst({
    where: { role: 'admin', status: 'active', deletedAt: null },
    select: { id: true },
  })
  if (active)
    throw new ConflictError(
      'An active admin already exists. Sign in as that admin to invite more people.',
    )
  const email = normalizeEmail(input.email)
  const existing = await deps.db.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, role: true },
  })
  if (!existing) return createUser(deps, { ...input, role: 'admin', pocId: null }, log)
  if (existing.role !== 'admin')
    throw new ConflictError(`${email} already belongs to a ${existing.role} user.`)
  return resendInvite(deps, existing.id, log)
}
