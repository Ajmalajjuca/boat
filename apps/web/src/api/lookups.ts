import type { LookupItem } from '@boat/domain/api'
import { api } from './client'

export const listLookups = () => api.get<{ items: LookupItem[] }>('/lookups').then((r) => r.items)
