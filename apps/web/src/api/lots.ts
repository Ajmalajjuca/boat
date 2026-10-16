import type {
  LookupItem,
  LotCards,
  LotDetail,
  LotFlag,
  LotGroup,
  LotItem,
  LotSort,
  Page,
} from '@boat/domain/api'
import type { GRNReceipt, Lot, RMBatch } from '@boat/domain/models'
import { api, ConflictError, download, queryString } from './client'
import { type LotRecord, lotField, lotInput, toBatch, toLot, toReceipt } from './mappers'

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

// A lot as the drawer edits it, with its batches and receipts in the domain's shapes.
export type LotView = { lot: LotRecord; batches: RMBatch[]; receipts: GRNReceipt[] }
export const toLotView = (d: LotDetail): LotView => ({
  lot: toLot(d),
  batches: d.rmBatches.map(toBatch),
  receipts: d.grnReceipts.map(toReceipt),
})
export const fetchLot = (id: string) => api.get<LotDetail>(`/lots/${id}`).then(toLotView)

// A lot without a version is new; with one, it is an edit the server checks for conflicts.
export async function saveLot(lot: Lot & { version?: number }, lookups: LookupItem[]) {
  const input = lotInput(lot, lookups)
  const options = { fields: lotField }
  const saved =
    lot.version === undefined
      ? await api.post<LotDetail>('/lots', input, options)
      : await api.patch<LotDetail>(`/lots/${lot.id}`, { ...input, version: lot.version }, options)
  return toLotView(saved)
}
export const deleteLot = (id: string) => api.delete(`/lots/${id}`)
// The server's current lot when a save met a newer version; null for any other error.
export const lotConflict = (e: unknown) =>
  e instanceof ConflictError && e.current ? toLotView(e.current as LotDetail) : null
