import type { ActivityEntry, Page } from '@boat/domain/api'
import { api } from './client'

// Lots and shipments keep history and notes under the same paths.
export type ActivityOwner = 'lots' | 'shipments'

// Newest first. One page of 200 covers a record's history in practice.
export const listActivity = (owner: ActivityOwner, id: string) =>
  api.get<Page<ActivityEntry>>(`/${owner}/${id}/activity?pageSize=200`).then((r) => r.items)
export const addNote = (owner: ActivityOwner, id: string, message: string) =>
  api.post<void>(`/${owner}/${id}/notes`, { message }).then(() => undefined)
