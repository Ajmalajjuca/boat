import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { listLookups } from './lookups'
import { type ActivityOwner, listActivity } from './activity'
import { fetchSettings, listUsers } from './admin'
import {
  fetchLot,
  fetchLotGroups,
  fetchLotSummary,
  listLots,
  type LotQuery,
  lotPageSize,
} from './lots'
import { listProducts } from './products'
import { fetchMonthEnd, listMonths } from './reports'
import { fetchShipment, fetchShipmentSummary, listShipments, type ShipmentQuery } from './shipments'
import { queryClient } from './queryClient'

// Query keys by area. A write invalidates whole areas, so every view of them refetches.
export const keys = {
  lookups: ['lookups'],
  products: ['products'],
  lots: ['lots'],
  monthEnd: ['month-end'],
  shipments: ['shipments'],
  settings: ['settings'],
  users: ['users'],
} as const

// Dropdown values change only in Settings, which refreshes them itself.
export const useLookups = () =>
  useQuery({ queryKey: keys.lookups, queryFn: listLookups, staleTime: 5 * 60_000 })
export const useProducts = () => useQuery({ queryKey: keys.products, queryFn: listProducts })
export const useLotSummary = () =>
  useQuery({ queryKey: [...keys.lots, 'summary'], queryFn: fetchLotSummary })
// Previous results stay on screen while new filters load, so the list doesn't flicker.
export const useLotGroups = (query: LotQuery) =>
  useQuery({
    queryKey: [...keys.lots, 'groups', query],
    queryFn: () => fetchLotGroups(query),
    placeholderData: keepPreviousData,
  })
export const useLots = (query: LotQuery, page: number, pageSize = lotPageSize, enabled = true) =>
  useQuery({
    queryKey: [...keys.lots, 'list', query, page, pageSize],
    queryFn: () => listLots(query, page, pageSize),
    placeholderData: keepPreviousData,
    enabled,
  })
const completed: LotQuery = { view: 'completed', q: '', flag: [], sort: 'eta-asc' }
export const useCompletedCount = () =>
  useQuery({
    queryKey: [...keys.lots, 'completed-count'],
    queryFn: () => listLots(completed, 1, 1).then((r) => r.total),
  })

export const lotKey = (id: string) => [...keys.lots, 'detail', id]
// Lot history sits under the lots key and shipment history under the shipments key, so the
// refresh after any write to either also reloads its history.
export const activityKey = (owner: ActivityOwner, id: string) => [
  ...(owner === 'lots' ? keys.lots : keys.shipments),
  'activity',
  id,
]
export const useLot = (id: string | undefined) =>
  useQuery({ queryKey: lotKey(id ?? ''), queryFn: () => fetchLot(id!), enabled: !!id })
export const useActivity = (owner: ActivityOwner, id: string | undefined) =>
  useQuery({
    queryKey: activityKey(owner, id ?? ''),
    queryFn: () => listActivity(owner, id!),
    enabled: !!id,
  })

export const useMonths = () =>
  useQuery({ queryKey: [...keys.monthEnd, 'months'], queryFn: listMonths })
export const useMonthEnd = (month: string) =>
  useQuery({
    queryKey: [...keys.monthEnd, 'report', month],
    queryFn: () => fetchMonthEnd(month),
    placeholderData: keepPreviousData,
  })

export const shipmentKey = (id: string) => [...keys.shipments, 'detail', id]
export const useShipments = (query: ShipmentQuery, page: number) =>
  useQuery({
    queryKey: [...keys.shipments, 'list', query, page],
    queryFn: () => listShipments(query, page),
    placeholderData: keepPreviousData,
  })
export const useShipmentSummary = () =>
  useQuery({ queryKey: [...keys.shipments, 'summary'], queryFn: fetchShipmentSummary })
export const useShipment = (id: string | undefined) =>
  useQuery({
    queryKey: shipmentKey(id ?? ''),
    queryFn: () => fetchShipment(id!),
    enabled: !!id,
  })

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: fetchSettings })
// Only admins may list users, so the screen enables this for them alone.
export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: keys.users, queryFn: listUsers, enabled })

const refresh = (...areas: (readonly string[])[]) =>
  Promise.all(areas.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
// After a lot, batch or receipt changes: every lot read, and month-end, which sums receipts.
export const refreshLots = () => refresh(keys.lots, keys.monthEnd)
// Products appear in lots, shipments and month-end.
export const refreshProducts = () =>
  refresh(keys.products, keys.lots, keys.monthEnd, keys.shipments)
export const refreshShipments = () => refresh(keys.shipments)
// Dropdown changes, imports and resets touch everything.
export const refreshEverything = () => queryClient.invalidateQueries()
