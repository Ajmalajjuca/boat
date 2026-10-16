import type { LookupItem } from '@boat/domain/api'
import type { LookupKind } from '@boat/domain/models'
import { api } from './client'

export const listLookups = () => api.get<{ items: LookupItem[] }>('/lookups').then((r) => r.items)
export const addLookup = (kind: LookupKind, value: string) =>
  api.post<LookupItem>('/lookups', { kind, value }).then(() => undefined)
export const renameLookup = (id: string, value: string) =>
  api.patch<LookupItem>(`/lookups/${id}`, { value }).then(() => undefined)
export const deleteLookup = (id: string) => api.delete(`/lookups/${id}`)
