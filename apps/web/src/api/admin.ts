import type {
  ImportResult,
  InviteResult,
  LookupItem,
  NewUser,
  Page,
  ResetResult,
  Settings,
  UserItem,
  UserPatch,
} from '@boat/domain/api'
import type { Role } from '@boat/domain/models'
import { normalizeEmail } from '@boat/domain/validation'
import { api, download, queryString } from './client'
import { lookupId } from './mappers'

export const fetchSettings = () => api.get<Settings>('/settings')
export const saveSettings = (patch: Partial<Settings>) => api.patch<Settings>('/settings', patch)

// The user form keeps the POC as its dropdown text, as the other forms do.
export type UserForm = { name: string; email: string; role: Role; poc: string }
export const userInput = (form: UserForm, lookups: LookupItem[]): NewUser => ({
  name: form.name.trim(),
  email: normalizeEmail(form.email),
  role: form.role,
  pocId: form.role === 'poc' ? lookupId(lookups, 'poc', form.poc) : null,
})
export const userField = (name: string) => (name === 'pocId' ? 'poc' : name)
const fields = { fields: userField }

export const listUsers = () => api.get<Page<UserItem>>('/users?pageSize=200').then((r) => r.items)
export const inviteUser = (input: NewUser) => api.post<InviteResult>('/users', input, fields)
export const updateUser = (id: string, patch: UserPatch) =>
  api.patch<UserItem>(`/users/${id}`, patch, fields)
export const deleteUser = (id: string) => api.delete(`/users/${id}`)

export const exportBackup = () => download('/data/export')
// The file was already checked in the browser with @boat/domain/backup; the server checks again.
export const importBackup = (raw: unknown, mode: 'merge' | 'replace') =>
  api.post<ImportResult>(`/data/import${queryString({ mode })}`, raw)
export const resetAllData = (confirm: string) => api.post<ResetResult>('/data/reset', { confirm })
