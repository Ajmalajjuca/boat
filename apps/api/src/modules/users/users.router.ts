import type { Role } from '@boat/domain/models'
import { roles } from '@boat/domain/permissions'
import { Router } from 'express'
import { z } from 'zod'
import { authOf, requirePermission } from '../../core/access'
import { pageQuery } from '../../core/pagination'
import { parseId, parseInput } from '../../core/parse'
import {
  createUser,
  deleteUser,
  listUsers,
  resendInvite,
  updateUser,
  type UsersDeps,
} from './users.service'

// Shape only. The rules (email format, name length, POC for POC users) run in the service
// through validateAccount, so the browser and the server share one set of messages.
const role = z.enum(roles as [Role, ...Role[]], { error: 'Choose a role.' })
const pocId = z.guid({ error: 'Choose a point of contact from the list.' }).nullable()
const createBody = z.object({
  email: z.string({ error: 'Enter an email address.' }),
  name: z.string({ error: 'Enter a name.' }),
  role,
  pocId: pocId.default(null),
})
// Email cannot be changed. Unknown keys are refused rather than silently ignored.
const patchBody = z.strictObject({
  name: z.string({ error: 'Enter a name.' }).optional(),
  role: role.optional(),
  pocId: pocId.optional(),
  status: z.enum(['active', 'disabled'], { error: 'Choose active or disabled.' }).optional(),
})

export function usersRouter(deps: UsersDeps) {
  const router = Router()

  router.get('/', requirePermission('manageSettings'), async (req, res) => {
    res.json(await listUsers(deps.db, parseInput(pageQuery, req.query)))
  })

  router.post('/', requirePermission('manageSettings'), async (req, res) => {
    res.status(201).json(await createUser(deps, parseInput(createBody, req.body), req.log))
  })

  router.post('/:id/invite', requirePermission('manageSettings'), async (req, res) => {
    res.json(await resendInvite(deps, parseId(req.params.id), req.log))
  })

  router.patch('/:id', requirePermission('manageSettings'), async (req, res) => {
    res.json(await updateUser(deps.db, parseId(req.params.id), parseInput(patchBody, req.body)))
  })

  router.delete('/:id', requirePermission('manageSettings'), async (req, res) => {
    await deleteUser(deps.db, authOf(req).user.id, parseId(req.params.id))
    res.status(204).end()
  })

  return router
}
