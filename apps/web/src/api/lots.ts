import type { LotCards, LotFlag, LotGroup, LotItem, LotSort, Page } from '@boat/domain/api'
import { api, download, queryString } from './client'
import { toLot } from './mappers'

// GET /lots, /lots/groups and /lots/export.csv take the same filters.
export type LotQuery = {
  view: 'active' | 'completed'
  q: string
  productId?: string
  segmentId?: string
  categoryId?: string
  emsId?: string
  pocId?: string
  statusId?: string
  stageId?: string
  logisticsId?: string
  blockerId?: string
  flag: LotFlag[]
  sort: LotSort
}
export const lotPageSize = 50

export async function listLots(query: LotQuery, page: number, pageSize = lotPageSize) {
  const res = await api.get<Page<LotItem>>(`/lots${queryString({ ...query, page, pageSize })}`)
  return { ...res, items: res.items.map(toLot) }
}
export const fetchLotGroups = (query: LotQuery) =>
  api.get<{ items: LotGroup[] }>(`/lots/groups${queryString(query)}`).then((r) => r.items)
export const fetchLotSummary = () => api.get<LotCards>('/lots/summary')
export const downloadLotsCsv = (query: LotQuery) =>
  download(`/lots/export.csv${queryString(query)}`)
