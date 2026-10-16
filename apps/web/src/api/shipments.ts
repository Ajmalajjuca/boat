import type {
  EtaRevisionItem,
  LookupItem,
  Page,
  ShipmentCards,
  ShipmentDetail,
  ShipmentFlag,
  ShipmentListItem,
  ShipmentSort,
} from '@boat/domain/api'
import type { Shipment, ShipmentItem } from '@boat/domain/models'
import { api, ConflictError, download, queryString } from './client'
import { type ShipmentRecord, shipmentField, shipmentInput, toLines, toShipment } from './mappers'

// GET /shipments and /shipments/export.csv take the same filters.
export type ShipmentQuery = {
  q: string
  stageId?: string
  vessel?: string
  flag?: ShipmentFlag
  sort: ShipmentSort
}
export const shipmentPageSize = 50

export async function listShipments(query: ShipmentQuery, page: number) {
  const res = await api.get<Page<ShipmentListItem>>(
    `/shipments${queryString({ ...query, page, pageSize: shipmentPageSize })}`,
  )
  return { ...res, items: res.items.map(toShipment) }
}
export const fetchShipmentSummary = () => api.get<ShipmentCards>('/shipments/summary')
export const downloadShipmentsCsv = (query: ShipmentQuery) =>
  download(`/shipments/export.csv${queryString(query)}`)

// A shipment as the drawer edits it: the record, its lines and its ETA revisions, newest first.
export type ShipmentView = {
  shipment: ShipmentRecord
  lines: ShipmentItem[]
  revisions: EtaRevisionItem[]
}
export const toShipmentView = (d: ShipmentDetail): ShipmentView => ({
  shipment: toShipment(d),
  lines: toLines(d),
  revisions: d.etaRevisions,
})
export const fetchShipment = (id: string) =>
  api.get<ShipmentDetail>(`/shipments/${id}`).then(toShipmentView)

// Without a version the shipment is new. Lines go in the form's order, so a server error on
// items.1.productId lands on the form's second line.
export async function saveShipment(
  shipment: Shipment & { version?: number },
  lines: ShipmentItem[],
  reason: string,
  lookups: LookupItem[],
) {
  const input = shipmentInput(shipment, lines, lookups)
  const options = { fields: shipmentField(lines) }
  const etaChangeReason = reason.trim() || undefined
  const saved =
    shipment.version === undefined
      ? await api.post<ShipmentDetail>('/shipments', input, options)
      : await api.patch<ShipmentDetail>(
          `/shipments/${shipment.id}`,
          { ...input, version: shipment.version, etaChangeReason },
          options,
        )
  return toShipmentView(saved)
}
export const deleteShipment = (id: string) => api.delete(`/shipments/${id}`)
// The server's current shipment when a save met a newer version; null for any other error.
export const shipmentConflict = (e: unknown) =>
  e instanceof ConflictError && e.current ? toShipmentView(e.current as ShipmentDetail) : null
