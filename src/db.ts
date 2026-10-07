import Dexie, { type Table } from 'dexie'
import type {
  ActivityLog,
  AppSetting,
  ETARevision,
  GRNReceipt,
  LookupValue,
  Lot,
  Product,
  RMBatch,
  Shipment,
  ShipmentItem,
  DataSet,
  LocalSetting,
  UserProfile,
} from './models'

// Version of the JSON backup format; the IndexedDB version below moves independently.
export const SCHEMA_VERSION = 1
class ControlTowerDB extends Dexie {
  products!: Table<Product, string>
  lots!: Table<Lot, string>
  rmBatches!: Table<RMBatch, string>
  grnReceipts!: Table<GRNReceipt, string>
  shipments!: Table<Shipment, string>
  shipmentItems!: Table<ShipmentItem, string>
  etaRevisions!: Table<ETARevision, string>
  activityLogs!: Table<ActivityLog, string>
  lookupValues!: Table<LookupValue, string>
  settings!: Table<AppSetting, string>
  users!: Table<UserProfile, string>
  localSettings!: Table<LocalSetting, string>
  constructor() {
    super('supply-chain-control-tower')
    this.version(1).stores({
      products: 'id, name, segment',
      lots: 'id, productId, status, stage, category, ems, poc',
      rmBatches: 'id, lotId, component',
      grnReceipts: 'id, lotId, date',
      shipments: 'id, number, vessel, stage',
      shipmentItems: 'id, shipmentId, productId',
      etaRevisions: 'id, shipmentId, createdAt',
      activityLogs: 'id, [entityType+entityId], createdAt',
      lookupValues: 'id, kind, [kind+value]',
      settings: 'id, key',
    })
    // Role profiles and device-only preferences; kept out of allTables so backups skip them.
    this.version(2).stores({ users: 'id, name', localSettings: 'key' })
  }
}
export const db = new ControlTowerDB()
export const allTables = [
  db.products,
  db.lots,
  db.rmBatches,
  db.grnReceipts,
  db.shipments,
  db.shipmentItems,
  db.etaRevisions,
  db.activityLogs,
  db.lookupValues,
  db.settings,
]
export async function getData(): Promise<DataSet> {
  const [
    products,
    lots,
    rmBatches,
    grnReceipts,
    shipments,
    shipmentItems,
    etaRevisions,
    activityLogs,
    lookupValues,
    settings,
  ] = await Promise.all(allTables.map((t) => t.toArray()))
  return {
    products: products as Product[],
    lots: lots as Lot[],
    rmBatches: rmBatches as RMBatch[],
    grnReceipts: grnReceipts as GRNReceipt[],
    shipments: shipments as Shipment[],
    shipmentItems: shipmentItems as ShipmentItem[],
    etaRevisions: etaRevisions as ETARevision[],
    activityLogs: activityLogs as ActivityLog[],
    lookupValues: lookupValues as LookupValue[],
    settings: settings as AppSetting[],
  }
}
