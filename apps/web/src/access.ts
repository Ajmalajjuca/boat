import { createContext, useContext } from 'react'
import {
  actionVerbs,
  actorLotAccess,
  deniedMessage,
  lotEditDenial,
  PermissionError,
  type Action,
  type LotAccess,
} from '@boat/domain/permissions'
import type { MePayload } from '@boat/domain/api'
import type { Lot, Role } from './models'

export {
  actionVerbs,
  planFields,
  PermissionError,
  roleInfo,
  roles,
  type Action,
  type LotAccess,
} from '@boat/domain/permissions'

// The signed-in user and what their role allows, from GET /auth/me. Hiding controls is a
// convenience: the API checks every request itself.
export type AccessUser = { id: string; name: string; email: string; role: Role; poc: string }
export type AccessState = { user: AccessUser | null; actions: Action[] }
const signedOut: AccessState = { user: null, actions: [] }
export const accessFrom = (me: MePayload): AccessState => ({
  user: {
    id: me.user.id,
    name: me.user.name,
    email: me.user.email,
    role: me.user.role,
    poc: me.user.poc?.value ?? '',
  },
  actions: me.allowedActions,
})

// repository.ts reads this state until Task 11 removes it with IndexedDB.
let current = signedOut
export const setAccess = (state: AccessState) => {
  current = state
}
export const actorName = () => current.user?.name

export function can(action: Action, state = current) {
  return state.actions.includes(action)
}
export function lotAccess(lot: Pick<Lot, 'poc'>, state = current): LotAccess {
  return actorLotAccess(state.user, lot)
}

const denied = (what: string) =>
  new PermissionError(deniedMessage(current.user?.role ?? null, what))
export function requireAction(action: Action) {
  if (!can(action)) throw denied(actionVerbs[action])
}
export function requireLotEdit(lot: Lot, next?: Lot) {
  const what = lotEditDenial(current.user, lot, next)
  if (what) throw denied(what)
}

export const AccessContext = createContext<AccessState>(signedOut)
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
