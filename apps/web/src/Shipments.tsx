import { LoadingState } from './ui'
import { useConfirm } from './ui'
import { useEffect, useState, type FormEvent, type MutableRefObject } from 'react'
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  PackageOpen,
  Plus,
  Search,
  Ship,
  Trash2,
  X,
} from 'lucide-react'
import type { LookupItem, ShipmentFlag, ShipmentSort } from '@boat/domain/api'
import { addNote } from './api/activity'
import { NotFoundError } from './api/client'
import { lookupId, type ShipmentRecord, values } from './api/mappers'
import {
  activityKey,
  refreshShipments,
  shipmentKey,
  useActivity,
  useLookups,
  useProducts,
  useShipment,
  useShipments,
  useShipmentSummary,
} from './api/queries'
import { queryClient } from './api/queryClient'
import {
  deleteShipment,
  downloadShipmentsCsv,
  saveShipment,
  type ShipmentQuery,
  shipmentPageSize,
  type ShipmentView,
  shipmentConflict,
} from './api/shipments'
import type { Shipment, ShipmentItem } from '@boat/domain/models'
import { productChoices, stamp } from '@boat/domain/models'
import {
  arrivalDelay,
  dateLabel,
  etaSlip,
  quantity,
  shipmentQuantity,
  today,
} from '@boat/domain/calculations'
import { roleInfo, useAccess } from './access'
import { lineField, validateShipment } from '@boat/domain/validation'
import {
  Badge,
  Button,
  Card,
  cn,
  ConflictBanner,
  Empty,
  Field,
  FormError,
  useFormErrors,
  type Run,
  Input,
  Pager,
  SearchSelect,
  Select,
  Sheet,
  Textarea,
  type CsvExport,
} from './ui'

type Props = {
  onOpen: (id: string) => void
  csvRef: MutableRefObject<CsvExport | null>
}
// Shipments that need attention get a coloured edge in the list.
const edge = (s: ShipmentRecord) => {
  const t = tone(s)
  return t === 'red' || t === 'amber' ? t : undefined
}
const tone = (s: ShipmentRecord) =>
  s.actualArrival
    ? (s.computed.arrivalDelay ?? 0) > 0
      ? 'amber'
      : 'green'
    : s.computed.flags.overdue
      ? 'red'
      : 'blue'
export default function Shipments({ onOpen, csvRef }: Props) {
  const lookups = useLookups().data ?? []
  const [search, setSearch] = useState(''),
    [stage, setStage] = useState(''),
    [vessel, setVessel] = useState(''),
    [sort, setSort] = useState<ShipmentSort>('eta-asc'),
    [quick, setQuick] = useState<ShipmentFlag | ''>('')
  const query: ShipmentQuery = {
    q: search,
    stageId: lookupId(lookups, 'shipmentStage', stage) ?? undefined,
    vessel: vessel || undefined,
    flag: quick || undefined,
    sort,
  }
  // The page belongs to one query, so a new filter starts again from page 1, as in Production.
  const queryText = JSON.stringify(query)
  const [paging, setPaging] = useState({ key: queryText, page: 1 })
  const page = paging.key === queryText ? paging.page : 1
  const setPage = (next: number) => setPaging({ key: queryText, page: next })
  const summary = useShipmentSummary().data
  const listQuery = useShipments(query, page),
    list = listQuery.data
  // Deleting the last row of a later page moves back to the new last page.
  const lastPage = Math.max(1, Math.ceil((list?.total ?? 0) / shipmentPageSize))
  useEffect(() => {
    if (list && page > lastPage) setPage(lastPage)
  }, [list, page, lastPage])
  const shipments = list?.items ?? []
  const clear = () => {
    setSearch('')
    setStage('')
    setVessel('')
    setQuick('')
  }
  const cards: {
    id: ShipmentFlag | 'units'
    label: string
    value: number | string
    help: string
    icon: typeof Ship
  }[] = [
    {
      id: 'open',
      label: 'In Transit',
      value: summary?.open ?? 0,
      help: 'All shipments not yet arrived, across pre-arrival logistics stages.',
      icon: Ship,
    },
    {
      id: 'soon',
      label: 'Arriving in 3 Days',
      value: summary?.soon ?? 0,
      help: 'Not arrived, ETA from today through three days ahead.',
      icon: CalendarClock,
    },
    {
      id: 'overdue',
      label: 'Overdue',
      value: summary?.overdue ?? 0,
      help: 'Not arrived and effective ETA before today.',
      icon: CalendarClock,
    },
    {
      id: 'revised',
      label: 'ETA Revised',
      value: summary?.revised ?? 0,
      help: 'Shipments with a current revised ETA.',
      icon: CalendarClock,
    },
    {
      id: 'arrived',
      label: 'Arrived',
      value: summary?.arrived ?? 0,
      help: 'Actual warehouse arrival date is present.',
      icon: PackageOpen,
    },
    {
      id: 'units',
      label: 'Units in Transit',
      value: quantity(summary?.openUnits ?? 0),
      help: 'Product-line units in shipments without warehouse arrival.',
      icon: PackageOpen,
    },
  ]
  csvRef.current = async () => {
    if (!list?.total) return false
    await downloadShipmentsCsv(query)
    return true
  }
  const names = (s: ShipmentRecord) => s.lines.map((l) => l.product.name).join(', ')
  return (
    <div className="space-y-5">
      <section
        aria-label="Shipment signals"
        className="scroll-row gap-px overflow-hidden rounded-xl border border-line bg-line-soft shadow-[0_1px_2px_rgba(16,24,40,.04)] md:grid md:grid-cols-3 xl:grid-cols-6"
      >
        {cards.map((card) => {
          const flag = card.id === 'units' ? 'open' : card.id
          const on = quick === flag
          return (
            <button
              key={card.id}
              title={card.help}
              aria-pressed={on}
              onClick={() => setQuick(on ? '' : flag)}
              className={cn(
                'relative min-w-[150px] shrink-0 bg-white px-4 pt-3.5 pb-3 text-left transition-colors md:min-w-0',
                'before:absolute before:inset-x-0 before:top-0 before:h-[3px]',
                on ? 'bg-wash before:bg-ink' : 'before:bg-transparent hover:bg-wash',
              )}
            >
              <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
                <card.icon size={15} aria-hidden="true" className="shrink-0 text-faint" />
                {card.label}
              </span>
              <span className="metric-value mt-1.5 block">{card.value}</span>
            </button>
          )
        })}
      </section>
      <Card>
        <div className="px-4 pt-4 sm:px-5">
          <h2 className="section-title">Finished goods shipments</h2>
          <p className="num mt-0.5 text-[13px] text-muted">
            {list?.total ?? 0} {list?.total === 1 ? 'shipment' : 'shipments'}. Arrived means it
            reached the warehouse.
          </p>
        </div>
        <div className="flex flex-col gap-2 px-4 pt-3 pb-4 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <Input
              aria-label="Search shipments"
              className="pl-9"
              placeholder="Search product, invoice, vessel"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="scroll-row -mx-4 items-center gap-2 px-4 sm:mx-0 sm:px-0">
            <Select
              aria-label="Filter shipment stage"
              className="w-auto shrink-0"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              <option value="">All stages</option>
              {values(lookups, 'shipmentStage').map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
            <Select
              aria-label="Filter vessel"
              className="w-auto shrink-0"
              value={vessel}
              onChange={(e) => setVessel(e.target.value)}
            >
              <option value="">All vessels</option>
              {(summary?.vessels ?? []).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
            <Select
              aria-label="Sort shipments"
              className="w-auto shrink-0"
              value={sort}
              onChange={(e) => setSort(e.target.value as ShipmentSort)}
            >
              <option value="eta-asc">ETA: soonest</option>
              <option value="eta-desc">ETA: latest</option>
              <option value="qty-desc">Qty: high to low</option>
              <option value="number-asc">Invoice: A–Z</option>
            </Select>
            {(search || stage || vessel || quick) && (
              <Button variant="ghost" className="shrink-0" onClick={clear}>
                <X size={15} /> Clear
              </Button>
            )}
          </div>
        </div>
        {listQuery.isPending ? (
          <LoadingState label="Loading shipments" />
        ) : listQuery.isError && !list ? (
          <div className="p-5">
            <Empty
              title="Couldn't load shipments"
              description={listQuery.error.message}
              action={
                <Button variant="secondary" onClick={() => listQuery.refetch()}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : shipments.length ? (
          <>
            <div className="table-wrap hidden border-t border-line md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shipment / invoice</th>
                    <th>Vessel</th>
                    <th>Products</th>
                    <th className="cell-num">Units</th>
                    <th>ETD</th>
                    <th>Current ETA</th>
                    <th className="cell-num">ETA slip</th>
                    <th>Status</th>
                    <th>Arrival</th>
                    <th aria-label="Open" className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id} data-clickable data-tone={edge(s)} onClick={() => onOpen(s.id)}>
                      <td className="font-semibold text-ink">{s.number}</td>
                      <td>{s.vessel}</td>
                      <td className="max-w-56 truncate" title={names(s)}>
                        {names(s)}
                      </td>
                      <td className="cell-num font-medium text-ink">
                        {quantity(s.computed.totalQty)}
                      </td>
                      <td>{dateLabel(s.etd)}</td>
                      <td className={s.computed.flags.overdue ? 'font-semibold text-rose-700' : ''}>
                        {dateLabel(s.computed.currentEta ?? '')}
                      </td>
                      <td className="cell-num">
                        {s.computed.etaSlip === null
                          ? '—'
                          : `${s.computed.etaSlip > 0 ? '+' : ''}${s.computed.etaSlip}d`}
                      </td>
                      <td>
                        <Badge tone={tone(s)}>{s.computed.status}</Badge>
                        {s.actualArrival && (
                          <div className="mt-1 text-xs text-muted">Stage: {s.stage}</div>
                        )}
                      </td>
                      <td>{dateLabel(s.actualArrival)}</td>
                      <td className="text-faint">
                        <ChevronRight size={15} aria-hidden="true" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-line-soft border-t border-line md:hidden">
              {shipments.map((s) => (
                <button
                  key={s.id}
                  data-tone={edge(s)}
                  onClick={() => onOpen(s.id)}
                  className="tone-edge block w-full px-4 py-3.5 text-left active:bg-wash"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-ink">{s.number}</span>
                    <Badge tone={tone(s)}>{s.computed.status}</Badge>
                  </div>
                  <div className="num mt-1 text-[13px] text-muted">
                    {s.vessel} · {quantity(s.computed.totalQty)} units
                  </div>
                  <div className="num mt-2 flex justify-between text-[13px] text-ink-2">
                    <span>ETA {dateLabel(s.computed.currentEta ?? '')}</span>
                    <span>
                      {s.lines.length} product {s.lines.length === 1 ? 'line' : 'lines'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <Pager
              page={page}
              pageSize={shipmentPageSize}
              total={list?.total ?? 0}
              onPage={setPage}
            />
          </>
        ) : (
          <div className="p-5">
            <Empty
              title="No matching shipments"
              description="Try clearing filters or add a shipment with product lines."
              action={
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          </div>
        )}
      </Card>
    </div>
  )
}

export type ShipmentTarget = { id: string } | { draft: Shipment }
type DrawerProps = {
  target: ShipmentTarget
  onClose: () => void
  // A new shipment reopens by id after its first save.
  onOpen: (id: string) => void
  // The shipment was deleted by someone else.
  onGone: () => void
  run: Run
}
type EditorProps = Omit<DrawerProps, 'target'> & {
  view: ShipmentView | null
  initial: Shipment
  lookups: LookupItem[]
}

export function ShipmentDrawer({ target, ...props }: DrawerProps) {
  const lookups = useLookups().data
  const detail = useShipment('id' in target ? target.id : undefined)
  const gone = detail.error instanceof NotFoundError
  useEffect(() => {
    if (gone) props.onGone()
  }, [gone])
  if (lookups && 'draft' in target)
    return <ShipmentEditor view={null} initial={target.draft} lookups={lookups} {...props} />
  if (lookups && detail.data)
    return (
      <ShipmentEditor
        view={detail.data}
        initial={detail.data.shipment}
        lookups={lookups}
        {...props}
      />
    )
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title="Shipment details"
    >
      {detail.error && !gone ? (
        <FormError message={detail.error.message} />
      ) : (
        <LoadingState label="Loading shipment" />
      )}
    </Sheet>
  )
}

function ShipmentEditor({ view, initial, lookups, onClose, onOpen, onGone, run }: EditorProps) {
  const blankLine = () => stamp({ shipmentId: initial.id, productId: '', quantity: 1 })
  // A new shipment starts with one empty product line so it can be filled in directly.
  const initialLines = () => (view ? view.lines : [blankLine()])
  const [draft, setDraft] = useState<Shipment & { version?: number }>(initial),
    [lines, setLines] = useState<ShipmentItem[]>(initialLines),
    [baseline, setBaseline] = useState(() => JSON.stringify({ shipment: initial, lines })),
    [conflict, setConflict] = useState<ShipmentView | null>(null),
    [reason, setReason] = useState(''),
    [note, setNote] = useState(''),
    [tab, setTab] = useState<'details' | 'history'>('details')
  const form = useFormErrors()
  const stored = !!view,
    dirty = JSON.stringify({ shipment: draft, lines }) !== baseline
  const adopt = (next: ShipmentView) => {
    setDraft(next.shipment)
    setLines(next.lines)
    setBaseline(JSON.stringify({ shipment: next.shipment, lines: next.lines }))
  }
  // Follows the server while there are no unsaved edits, as the lot drawer does.
  useEffect(() => {
    if (view && !dirty) adopt(view)
  }, [view])
  const access = useAccess(),
    readOnly = !access.can('editShipments')
  // Warns before a reload or tab close would discard unsaved shipment edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const confirm = useConfirm()
  const close = async () => {
    if (dirty && !(await confirm('Discard unsaved shipment changes?'))) return
    onClose()
  }
  const productOptions = productChoices(useProducts().data ?? [])
  const update = <K extends keyof Shipment>(key: K, value: Shipment[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    // ETD changes can resolve the date-order errors on the other date fields.
    form.clear(key, ...(key === 'etd' ? ['plannedEta', 'revisedEta', 'actualArrival'] : []))
  }
  const addLine = () => {
    setLines([...lines, blankLine()])
    form.clear('lines')
  }
  const updateLine = (id: string, patch: Partial<ShipmentItem>) => {
    setLines(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)))
    // Duplicate-product errors involve other lines, so a product change clears them all.
    form.clear(
      ...Object.keys(patch).map((key) => lineField(id, key as 'productId' | 'quantity')),
      ...(patch.productId !== undefined ? lines.map((l) => lineField(l.id, 'productId')) : []),
    )
  }
  const failed = (e: unknown) => {
    const current = shipmentConflict(e)
    if (current) return setConflict(current)
    if (e instanceof NotFoundError) return onGone()
    form.fail(e)
  }
  const save = async (closeAfter = false) => {
    setTab('details')
    if (!form.check(validateShipment(draft, lines))) return
    let saved: ShipmentView | undefined
    const sent = draft,
      sentLines = lines
    const ok = await run(async () => {
      saved = await saveShipment(sent, sentLines, reason, lookups)
      queryClient.setQueryData(shipmentKey(saved.shipment.id), saved)
      await refreshShipments()
    }, failed)
    if (!ok || !saved) return
    if (closeAfter) return onClose()
    if (!view) return onOpen(saved.shipment.id)
    // Edits typed while the save was on its way stay, with the new version for their own save.
    const next = saved
    setDraft((d) => (d === sent ? next.shipment : { ...d, version: next.shipment.version }))
    setLines((l) => (l === sentLines ? next.lines : l))
    setBaseline(JSON.stringify({ shipment: next.shipment, lines: next.lines }))
    setReason('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save()
  }
  const remove = async () => {
    if (
      !(await confirm(
        `Delete shipment ${draft.number}, its ${lines.length} product lines, ETA revision history, and activity records?`,
      ))
    )
      return
    const removed = await run(async () => {
      await deleteShipment(draft.id)
      await refreshShipments()
    }, failed)
    if (removed) onClose()
  }
  const revisions = view?.revisions ?? []
  const logs = useActivity('shipments', view?.shipment.id).data ?? []
  return (
    <Sheet
      open
      onOpenChange={(v) => {
        if (!v) close()
      }}
      title={stored ? draft.number || 'Shipment details' : 'New shipment'}
      subtitle="Finished goods · Multiple product lines · Actual warehouse arrival"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div>
            {stored && access.can('deleteShipments') && (
              <Button
                variant="danger"
                aria-label="Delete shipment"
                className="px-3"
                onClick={remove}
              >
                <Trash2 size={14} /> <span className="hidden sm:inline">Delete shipment</span>
              </Button>
            )}
          </div>
          <div className="flex justify-end gap-2">
            {/* Phones close with the X in the header; the footer keeps room for saving. */}
            <Button variant="secondary" className="hidden sm:inline-flex" onClick={close}>
              Close
            </Button>
            {!readOnly && (
              <>
                <Button variant="secondary" onClick={() => save()}>
                  Save shipment
                </Button>
                <Button onClick={() => save(true)}>Save & close</Button>
              </>
            )}
          </div>
        </div>
      }
    >
      {conflict && (
        <ConflictBanner
          record="shipment"
          onReload={() => {
            queryClient.setQueryData(shipmentKey(conflict.shipment.id), conflict)
            adopt(conflict)
            setConflict(null)
            form.reset()
          }}
          onDismiss={() => setConflict(null)}
        />
      )}
      <div className="mb-5 empty:hidden">
        <FormError
          message={
            form.errors.form ||
            (Object.keys(form.errors).length > 1
              ? `Fix the ${Object.keys(form.errors).length} highlighted fields to save this shipment.`
              : undefined)
          }
        />
      </div>
      {access.user && readOnly && (
        <div className="mb-5 rounded-xl bg-canvas px-3 py-2.5 text-xs text-ink-2">
          View only. {roleInfo[access.user.role].label} users can't change shipments.
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line-soft sm:grid-cols-4">
        {[
          ['Total units', quantity(shipmentQuantity(lines))],
          ['Product lines', String(lines.length)],
          [
            'ETA slip',
            etaSlip(draft) === null
              ? 'Not set'
              : `${etaSlip(draft)! > 0 ? '+' : ''}${etaSlip(draft)} days`,
          ],
          [
            'Arrival delay',
            arrivalDelay(draft) === null
              ? 'Not set'
              : `${arrivalDelay(draft)! > 0 ? '+' : ''}${arrivalDelay(draft)} days`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-4 py-3">
            <div className="text-[13px] text-muted">{label}</div>
            <div className="num mt-0.5 text-lg font-semibold text-ink">{value}</div>
          </div>
        ))}
      </div>
      <div className="scroll-row mb-5 border-b border-line" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'details'}
          className="tab"
          data-active={tab === 'details'}
          onClick={() => setTab('details')}
        >
          Shipment details
        </button>
        <button
          role="tab"
          aria-selected={tab === 'history'}
          className="tab"
          data-active={tab === 'history'}
          onClick={() => setTab('history')}
        >
          ETA revisions & history <Badge tone="slate">{revisions.length}</Badge>
        </button>
      </div>
      {tab === 'details' && (
        <form onSubmit={submit} noValidate>
          <fieldset disabled={readOnly} className="min-w-0 space-y-6">
            <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <h3 className="section-title mb-3">Identity & schedule</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Shipment / invoice number" required error={form.errors.number}>
                  <Input
                    value={draft.number}
                    onChange={(e) => update('number', e.target.value)}
                    placeholder="INV-SEA-1053"
                  />
                </Field>
                <Field label="Vessel / flight" required error={form.errors.vessel}>
                  <Input
                    value={draft.vessel}
                    onChange={(e) => update('vessel', e.target.value)}
                    placeholder="Vessel, flight, or carrier"
                  />
                </Field>
                <Field label="ETD">
                  <Input
                    type="date"
                    value={draft.etd}
                    onChange={(e) => update('etd', e.target.value)}
                  />
                </Field>
                <Field label="Original planned ETA" error={form.errors.plannedEta}>
                  <Input
                    type="date"
                    value={draft.plannedEta}
                    onChange={(e) => update('plannedEta', e.target.value)}
                  />
                </Field>
                <Field label="Current revised ETA" error={form.errors.revisedEta}>
                  <Input
                    type="date"
                    value={draft.revisedEta}
                    onChange={(e) => update('revisedEta', e.target.value)}
                  />
                </Field>
                <Field label="Actual warehouse arrival" error={form.errors.actualArrival}>
                  <Input
                    type="date"
                    max={today()}
                    value={draft.actualArrival}
                    onChange={(e) => update('actualArrival', e.target.value)}
                  />
                </Field>
                <Field label="Current stage" error={form.errors.stage}>
                  <SearchSelect
                    value={draft.stage}
                    options={values(lookups, 'shipmentStage')}
                    onChange={(v) => update('stage', v)}
                  />
                </Field>
                <Field
                  label="ETA change reason"
                  help="Saved with each committed effective ETA change."
                  error={form.errors.etaChangeReason}
                >
                  <Input
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                      form.clear('etaChangeReason')
                    }}
                    placeholder="Optional reason"
                  />
                </Field>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <h3 className="section-title mb-3">Product lines</h3>
              <div className="space-y-3" data-invalid={form.errors.lines ? true : undefined}>
                {form.errors.lines && (
                  <p role="alert" className="text-xs font-medium text-rose-700">
                    {form.errors.lines}
                  </p>
                )}
                {lines.map((line, index) => (
                  <Card key={line.id} className="flex flex-wrap items-start gap-3 p-3">
                    <Field
                      label={`Product ${index + 1}`}
                      required
                      error={form.errors[lineField(line.id, 'productId')]}
                      className="min-w-52 flex-1"
                    >
                      <SearchSelect
                        value={line.productId}
                        options={productOptions}
                        onChange={(id) => updateLine(line.id, { productId: id })}
                      />
                    </Field>
                    <Field
                      label="Quantity"
                      required
                      error={form.errors[lineField(line.id, 'quantity')]}
                      className="w-32"
                    >
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) })}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-6 text-rose-700"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => setLines(lines.filter((x) => x.id !== line.id))}
                    >
                      <Trash2 size={17} />
                    </Button>
                  </Card>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                  <Plus size={14} /> Add product line
                </Button>
                <div className="text-sm font-bold text-ink">
                  Total: {quantity(shipmentQuantity(lines))} units
                </div>
              </div>
            </div>
            <Field label="Remarks">
              <Textarea
                value={draft.remarks}
                onChange={(e) => update('remarks', e.target.value)}
                placeholder="Shipment context and next steps"
              />
            </Field>
            {draft.stage === 'Arrived at Warehouse' && !draft.actualArrival && (
              <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                The stage says Arrived at Warehouse, but no actual arrival date is set, so this
                shipment still counts as in transit.
              </div>
            )}
            <div className="rounded-xl bg-teal-50 p-3 text-xs text-teal-800">
              An arrival is counted only when Actual warehouse arrival is set. The stage remains a
              separately editable operational label.
            </div>
            {/* Lets Enter submit the form; hidden from assistive tech to avoid a duplicate Save. */}
            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
              Save shipment
            </button>
          </fieldset>
        </form>
      )}
      {tab === 'history' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
            <h3 className="section-title mb-3">ETA revision history</h3>
            {revisions.length ? (
              <div className="space-y-3">
                {revisions.map((r) => (
                  <Card key={r.id} className="p-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span>{dateLabel(r.previousDate ?? '')}</span>
                      <ArrowRight size={15} className="text-brand" />
                      <span>{dateLabel(r.newDate ?? '')}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {new Date(r.createdAt).toLocaleString()}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                No ETA revisions yet. Saving a changed effective ETA records one here.
              </p>
            )}
          </div>
          <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
            <h3 className="section-title mb-3">Activity & notes</h3>
            {!readOnly && (
              <>
                <Textarea
                  aria-label="Shipment update note"
                  placeholder="Record a shipment update..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    disabled={!stored || !note.trim()}
                    onClick={async () => {
                      const posted = await run(async () => {
                        await addNote('shipments', draft.id, note)
                        await queryClient.invalidateQueries({
                          queryKey: activityKey('shipments', draft.id),
                        })
                      })
                      if (posted) setNote('')
                    }}
                  >
                    Post update
                  </Button>
                </div>
              </>
            )}
            <div className="mt-4 space-y-3">
              {logs.map((a) => (
                <div key={a.id} className="border-b border-line pb-3">
                  <div className="text-sm text-ink-2">{a.message}</div>
                  <div className="mt-1 text-xs text-muted">
                    {new Date(a.createdAt).toLocaleString()}
                    {a.actorName && ` · ${a.actorName}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  )
}
