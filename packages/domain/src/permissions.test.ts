import { describe, expect, it } from 'vitest'
import type { Role } from './models'
import {
  actionVerbs,
  actorLotAccess,
  changedPlanFields,
  deniedMessage,
  lotEditDenial,
  roleCan,
  roleInfo,
  roles,
  type Action,
} from './permissions'
import { makeLot } from './test-factories'

// The PRD's role table, written out independently of the implementation.
const allowed: Record<Role, Action[]> = {
  admin: [
    'manageSettings',
    'manageData',
    'exportBackup',
    'editProducts',
    'deleteProducts',
    'createLots',
    'deleteLots',
    'editShipments',
    'deleteShipments',
    'deleteEntries',
  ],
  planner: ['exportBackup', 'editProducts', 'createLots', 'editShipments', 'deleteEntries'],
  poc: [],
  viewer: [],
}
const actions = Object.keys(actionVerbs) as Action[]

describe('roleCan', () => {
  it('knows all ten actions and four roles', () => {
    expect(actions).toHaveLength(10)
    expect(roles).toEqual(['admin', 'planner', 'poc', 'viewer'])
    expect(roleInfo.poc.label).toBe('POC')
  })
  it.each(roles.flatMap((role) => actions.map((action) => [role, action] as const)))(
    '%s → %s matches the role table',
    (role, action) => {
      expect(roleCan(role, action)).toBe(allowed[role].includes(action))
    },
  )
})

describe('actorLotAccess', () => {
  const owned = { poc: 'Ravi' }
  it('gives admins and planners full access', () => {
    expect(actorLotAccess({ role: 'admin', poc: '' }, owned)).toBe('full')
    expect(actorLotAccess({ role: 'planner', poc: '' }, owned)).toBe('full')
  })
  it('gives a POC progress access to their own lots only', () => {
    expect(actorLotAccess({ role: 'poc', poc: 'Ravi' }, owned)).toBe('progress')
    expect(actorLotAccess({ role: 'poc', poc: 'Asha' }, owned)).toBe('none')
    expect(actorLotAccess({ role: 'poc', poc: '' }, { poc: '' })).toBe('none')
  })
  it('gives viewers and signed-out users no access', () => {
    expect(actorLotAccess({ role: 'viewer', poc: '' }, owned)).toBe('none')
    expect(actorLotAccess(null, owned)).toBe('none')
  })
})

describe('lot edit rules', () => {
  const lot = makeLot({ poc: 'Ravi', lotQty: 100, plannedDate: '2026-10-20' })
  const ravi = { role: 'poc' as const, poc: 'Ravi' }

  it('lists changed plan fields in plan order', () => {
    expect(changedPlanFields(lot, { ...lot, plannedDate: '2026-10-25', lotQty: 120 })).toEqual([
      'lotQty',
      'plannedDate',
    ])
    expect(changedPlanFields(lot, { ...lot, status: 'Delayed' })).toEqual([])
    expect(changedPlanFields(lot, { ...lot, rmComponents: ['PCB'] })).toEqual(['rmComponents'])
  })
  it('lets a POC change progress but not the plan', () => {
    expect(lotEditDenial(ravi, lot, { ...lot, status: 'Delayed', reworkQty: 0 })).toBeUndefined()
    expect(lotEditDenial(ravi, lot)).toBeUndefined()
    expect(lotEditDenial(ravi, lot, { ...lot, lotQty: 120 })).toBe(
      'change plan fields such as product, lot quantity, planned date, or POC',
    )
  })
  it('names the owner when access is refused', () => {
    expect(lotEditDenial({ role: 'viewer', poc: '' }, lot)).toBe('edit lots owned by Ravi')
    expect(lotEditDenial({ role: 'poc', poc: 'Asha' }, makeLot({ poc: '' }))).toBe(
      'edit lots without a POC',
    )
  })
  it('lets planners change the plan', () => {
    expect(
      lotEditDenial({ role: 'planner', poc: '' }, lot, { ...lot, lotQty: 120 }),
    ).toBeUndefined()
  })
  it('words the refusal by role', () => {
    expect(deniedMessage('planner', 'delete lots')).toBe(
      "Planner profiles can't delete lots. Ask an admin.",
    )
    expect(deniedMessage(null, 'delete lots')).toBe('Sign in to make changes.')
  })
})
