import { createContext, useContext } from 'react'
import type { Lot, Role, UserProfile } from './models'

// UI role modes. They prevent accidental changes on a shared browser; they are not a security
// boundary, because anyone with developer tools can edit IndexedDB directly.
export const roleInfo: Record<Role, { label: string; description: string }> = {
  admin: {
    label: 'Admin',
    description: 'Everything, including Settings, profiles, import, restore, reset, and deletes.',
  },
  planner: {
    label: 'Planner',
    description:
      'Adds and edits products, lots, and shipments, and corrects RM batches and GRN receipts. No Settings, restore, reset, or record deletes.',
  },
  poc: {
    label: 'POC',
    description:
      'Updates progress on lots assigned to them: status, quantities, ETAs, blockers, RM batches, GRN receipts, and notes.',
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
const verbs: Record<Action, string> = {
  manageSettings: 'change Settings or profiles',
  manageData: 'import, restore, or reset data',
  exportBackup: 'export a JSON backup',
  editProducts: 'add or edit products',
  deleteProducts: 'delete products',
  createLots: 'create lots',
  deleteLots: 'delete lots',
  editShipments: 'add or edit shipments',
  deleteShipments: 'delete shipments',
  deleteEntries: 'delete RM batches or GRN receipts',
}
const grants: Record<Role, Action[]> = {
  admin: Object.keys(verbs) as Action[],
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

// enabled is false until the first profile is created; the app then works as before.
export type AccessState = { enabled: boolean; user: UserProfile | null }
const openAccess: AccessState = { enabled: false, user: null }
let current = openAccess
// The repository checks this state, so a hidden button is never the only guard.
export const setAccess = (state: AccessState) => {
  current = state
}
export const actorName = () => (current.enabled ? current.user?.name : undefined)

export function can(action: Action, state = current) {
  if (!state.enabled) return true
  return !!state.user && grants[state.user.role].includes(action)
}
// full: every field. progress: everything except plan fields. none: read-only.
export type LotAccess = 'full' | 'progress' | 'none'
export function lotAccess(lot: Pick<Lot, 'poc'>, state = current): LotAccess {
  if (!state.enabled) return 'full'
  const user = state.user
  if (!user) return 'none'
  if (user.role === 'admin' || user.role === 'planner') return 'full'
  return user.role === 'poc' && !!user.poc && lot.poc === user.poc ? 'progress' : 'none'
}

export class PermissionError extends Error {}
const denied = (what: string) =>
  new PermissionError(
    current.user
      ? `${roleInfo[current.user.role].label} profiles can't ${what}. Ask an admin.`
      : 'Sign in to make changes.',
  )
export function requireAction(action: Action) {
  if (!can(action)) throw denied(verbs[action])
}
export function requireLotEdit(lot: Lot, next?: Lot) {
  const level = lotAccess(lot)
  if (level === 'none')
    throw denied(lot.poc ? `edit lots owned by ${lot.poc}` : 'edit lots without a POC')
  if (
    level === 'progress' &&
    next &&
    planFields.some((k) => JSON.stringify(lot[k]) !== JSON.stringify(next[k]))
  )
    throw denied('change plan fields such as product, lot quantity, planned date, or POC')
}

export const AccessContext = createContext<AccessState>(openAccess)
export function useAccess() {
  const state = useContext(AccessContext)
  return {
    ...state,
    can: (action: Action) => can(action, state),
    lotAccess: (lot: Pick<Lot, 'poc'>) => lotAccess(lot, state),
  }
}

// PINs are 4 to 8 digits, stored as a salted SHA-256 hash.
export function validatePin(pin: string, confirm?: string) {
  if (!/^\d{4,8}$/.test(pin)) return 'Use a PIN of 4 to 8 digits.'
  if (confirm !== undefined && pin !== confirm) return 'The two PINs do not match.'
}
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)))
export async function hashSecret(secret: string, salt: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${secret}`)))
}
// Recovery keys skip look-alike characters (0/O, 1/I/L) so they can be copied from paper.
const recoveryAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newRecoveryKey() {
  const chars = [...crypto.getRandomValues(new Uint8Array(16))].map(
    (n) => recoveryAlphabet[n % recoveryAlphabet.length],
  )
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-')
}
export const normalizeRecoveryKey = (key: string) => key.toUpperCase().replace(/[^A-Z0-9]/g, '')

// The signed-in profile lasts for this browser tab, so a reload keeps it and a new tab asks.
const sessionKey = 'boat.session'
export function storedSession() {
  try {
    return sessionStorage.getItem(sessionKey) || ''
  } catch {
    return ''
  }
}
export function storeSession(userId: string) {
  try {
    if (userId) sessionStorage.setItem(sessionKey, userId)
    else sessionStorage.removeItem(sessionKey)
  } catch {
    // Without session storage the profile simply lasts until the page reloads.
  }
}
