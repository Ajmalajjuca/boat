import type { Lot, Role } from './models'

export const roleInfo: Record<Role, { label: string; description: string }> = {
  admin: {
    label: 'Admin',
    description: 'Everything, including Settings, profiles, import, restore, reset, and deletes.',
  },
  planner: {
    label: 'Planner',
    description:
      'Adds and edits products, lots, and shipments, and corrects RM batches. No Settings, restore, reset, or record deletes.',
  },
  poc: {
    label: 'POC',
    description:
      'Updates progress on lots assigned to them: status, quantities, ETAs, blockers, RM batches, and notes.',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only. Can browse every screen and download CSV files.',
  },
}
export const roles = Object.keys(roleInfo) as Role[]

export type Action =
  | 'manageSettings'
  | 'manageData'
  | 'exportBackup'
  | 'editProducts'
  | 'deleteProducts'
  | 'createLots'
  | 'deleteLots'
  | 'editShipments'
  | 'deleteShipments'
  | 'deleteEntries'
export const actionVerbs: Record<Action, string> = {
  manageSettings: 'change Settings or profiles',
  manageData: 'import, restore, or reset data',
  exportBackup: 'export a JSON backup',
  editProducts: 'add or edit products',
  deleteProducts: 'delete products',
  createLots: 'create lots',
  deleteLots: 'delete lots',
  editShipments: 'add or edit shipments',
  deleteShipments: 'delete shipments',
  deleteEntries: 'delete RM batches',
}
export const actions = Object.keys(actionVerbs) as Action[]
const grants: Record<Role, Action[]> = {
  admin: actions,
  planner: ['exportBackup', 'editProducts', 'createLots', 'editShipments', 'deleteEntries'],
  poc: [],
  viewer: [],
}
// Lot fields that set the plan. A POC can update progress on their lots but not these.
export const planFields: (keyof Lot)[] = [
  'productId',
  'label',
  'category',
  'directFg',
  'ems',
  'poc',
  'rmMode',
  'rmComponents',
  'lotQty',
  'plannedDate',
]

// Who is acting: a browser profile today, the signed-in user on the server.
export type Actor = { role: Role; poc: string }

export const roleCan = (role: Role, action: Action) => grants[role].includes(action)
// What a role may do, in actionVerbs order. /auth/me returns it so the browser can hide controls.
export const allowedActions = (role: Role) => actions.filter((a) => roleCan(role, a))

// full: every field. progress: everything except plan fields. none: read-only.
export type LotAccess = 'full' | 'progress' | 'none'
export function actorLotAccess(actor: Actor | null, lot: Pick<Lot, 'poc'>): LotAccess {
  if (!actor) return 'none'
  if (actor.role === 'admin' || actor.role === 'planner') return 'full'
  return actor.role === 'poc' && !!actor.poc && lot.poc === actor.poc ? 'progress' : 'none'
}

export const changedPlanFields = (lot: Lot, next: Lot) =>
  planFields.filter((k) => JSON.stringify(lot[k]) !== JSON.stringify(next[k]))

// The phrase for "<Role> profiles can't …", or undefined when the edit is allowed.
export function lotEditDenial(actor: Actor | null, lot: Lot, next?: Lot) {
  const level = actorLotAccess(actor, lot)
  if (level === 'none') return lot.poc ? `edit lots owned by ${lot.poc}` : 'edit lots without a POC'
  if (level === 'progress' && next && changedPlanFields(lot, next).length)
    return 'change plan fields such as product, lot quantity, planned date, or POC'
}

export class PermissionError extends Error {}
export const deniedMessage = (role: Role | null, what: string) =>
  role
    ? `${roleInfo[role].label} profiles can't ${what}. Ask an admin.`
    : 'Sign in to make changes.'
