// Compile-time checks that the server's JSON matches @boat/domain/api, which the web app reads.
// `pnpm typecheck` fails on the line of any view or input that changed. Update the shared type,
// then the web app's use of it.
import type * as Api from '@boat/domain/api'
import type { entryView } from './modules/activity/activity.service'
import type { MePayload } from './modules/auth/auth.service'
import type { importBackup } from './modules/data-transfer/import.service'
import type { ReceiptInput } from './modules/grn-receipts/grn-receipts.service'
import type { LookupView } from './modules/lookups/lookups.service'
import type { getLotDetail, LotView } from './modules/lots/lot-view'
import type { LotInput, LotPatch, lotCards, lotGroups } from './modules/lots/lots.service'
import type { ProductInput, ProductPatch, ProductView } from './modules/products/products.service'
import type { monthEndReport, monthList } from './modules/reports/month-end.service'
import type { BatchInput } from './modules/rm-batches/rm-batches.service'
import type { Settings } from './modules/settings/settings.service'
import type { getShipmentDetail, ShipmentView } from './modules/shipments/shipment-view'
import type {
  ShipmentInput,
  ShipmentPatch,
  shipmentCards,
} from './modules/shipments/shipments.service'
import type { NewUser, UserPatch, UserView } from './modules/users/users.service'

// What JSON.stringify makes of a value: Dates become strings.
type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T
type Reply<F extends (...args: never[]) => unknown> = Json<Awaited<ReturnType<F>>>
// Each assignable to the other: a field added, removed, made optional or retyped on either side
// fails the check.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T

export type ContractChecks = [
  Expect<Same<Json<MePayload>, Api.MePayload>>,
  Expect<Same<Settings, Api.Settings>>,
  Expect<Same<LookupView, Api.LookupItem>>,
  Expect<Same<Json<ProductView>, Api.ProductItem>>,
  Expect<Same<Json<LotView>, Api.LotItem>>,
  Expect<Same<Reply<typeof getLotDetail>, Api.LotDetail>>,
  Expect<Same<Reply<typeof lotCards>, Api.LotCards>>,
  Expect<Same<Reply<typeof lotGroups>, { items: Api.LotGroup[] }>>,
  Expect<Same<Json<ReturnType<typeof entryView>>, Api.ActivityEntry>>,
  Expect<Same<Json<ShipmentView>, Api.ShipmentListItem>>,
  Expect<Same<Reply<typeof getShipmentDetail>, Api.ShipmentDetail>>,
  Expect<Same<Reply<typeof shipmentCards>, Api.ShipmentCards>>,
  Expect<Same<Reply<typeof monthEndReport>, Api.MonthEndReport>>,
  Expect<Same<Reply<typeof monthList>, { items: string[] }>>,
  Expect<Same<Json<UserView>, Api.UserItem>>,
  Expect<Same<Reply<typeof importBackup>, Api.ImportResult>>,
  Expect<Same<LotInput, Api.LotInput>>,
  Expect<Same<LotPatch, Api.LotPatch>>,
  Expect<Same<BatchInput, Api.BatchInput>>,
  Expect<Same<ReceiptInput, Api.ReceiptInput>>,
  Expect<Same<ProductInput, Api.ProductInput>>,
  Expect<Same<ProductPatch, Api.ProductPatch>>,
  Expect<Same<ShipmentInput, Api.ShipmentInput>>,
  Expect<Same<ShipmentPatch, Api.ShipmentPatch>>,
  Expect<Same<NewUser, Api.NewUser>>,
  Expect<Same<UserPatch, Api.UserPatch>>,
]
