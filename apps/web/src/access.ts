import { createContext, useContext } from 'react'
import { actorLotAccess, type Action, type LotAccess } from '@boat/domain/permissions'
import type { MePayload } from '@boat/domain/api'
import type { Lot, Role } from '@boat/domain/models'

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

export function can(action: Action, state: AccessState) {
  return state.actions.includes(action)
}
export function lotAccess(lot: Pick<Lot, 'poc'>, state: AccessState): LotAccess {
  return actorLotAccess(state.user, lot)
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
