import { useEffect, useMemo, useState, type FormEvent, type MutableRefObject } from 'react'
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
import type { DataSet, Shipment, ShipmentItem } from './models'
import { productChoices, stamp } from './models'
import {
  arrivalDelay,
  dateLabel,
  effectiveShipmentEta,
  etaSlip,
  quantity,
  shipmentFlags,
  shipmentQuantity,
  sum,
  today,
} from './calculations'
import { addNote, deleteShipment, downloadFile, saveShipment, toCsv } from './repository'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  SearchSelect,
  Select,
  Sheet,
  Textarea,
} from './ui'

type Props = {
  data: DataSet
  onOpen: (s: Shipment) => void
  csvRef: MutableRefObject<(() => void) | null>
}
export const newShipment = (): Shipment =>
  stamp({
    number: '',
    vessel: '',
    etd: '',
    plannedEta: '',
    revisedEta: '',
    actualArrival: '',
    stage: 'In Transit',
    remarks: '',
  })
export default function Shipments({ data, onOpen, csvRef }: Props) {
  const [search, setSearch] = useState(''),
    [stage, setStage] = useState(''),
    [vessel, setVessel] = useState(''),
    [sort, setSort] = useState('eta-asc'),
    [quick, setQuick] = useState('')
  const items = (id: string) => data.shipmentItems.filter((i) => i.shipmentId === id)
  const shipments = useMemo(
    () =>
      data.shipments
        .filter((s) => {
          const f = shipmentFlags(s),
            text = `${s.number} ${s.vessel} ${items(s.id)
              .map((i) => data.products.find((p) => p.id === i.productId)?.name || '')
              .join(' ')}`.toLowerCase()
          return (
            (!search || text.includes(search.toLowerCase())) &&
            (!stage || s.stage === stage) &&
            (!vessel || s.vessel === vessel) &&
            (!quick ||
              (quick === 'overdue' && f.overdue) ||
              (quick === 'soon' && f.soon) ||
              (quick === 'revised' && f.revised) ||
              (quick === 'arrived' && f.arrived) ||
              (quick === 'open' && f.open))
          )
        })
        .sort((a, b) => {
          const [key, dir] = sort.split('-'),
            sgn = dir === 'desc' ? -1 : 1
          let av: string | number, bv: string | number
          if (key === 'qty') {
            av = shipmentQuantity(items(a.id))
            bv = shipmentQuantity(items(b.id))
          } else if (key === 'number') {
            av = a.number
            bv = b.number
          } else {
            av = effectiveShipmentEta(a) || '9999'
            bv = effectiveShipmentEta(b) || '9999'
          }
          return av < bv ? -sgn : av > bv ? sgn : 0
        }),
    [data, search, stage, vessel, sort, quick],
  )
  const count = (p: (s: Shipment) => boolean) => data.shipments.filter(p).length
  const cards = [
    {
      id: 'open',
      label: 'In Transit',
      value: count((s) => shipmentFlags(s).open),
      help: 'All shipments not yet arrived, across pre-arrival logistics stages.',
      icon: Ship,
    },
    {
      id: 'soon',
      label: 'Arriving in 3 Days',
      value: count((s) => shipmentFlags(s).soon),
      help: 'Not arrived, ETA from today through three days ahead.',
      icon: CalendarClock,
    },
    {
      id: 'overdue',
      label: 'Overdue',
      value: count((s) => shipmentFlags(s).overdue),
      help: 'Not arrived and effective ETA before today.',
      icon: CalendarClock,
    },
    {
      id: 'revised',
      label: 'ETA Revised',
      value: count((s) => shipmentFlags(s).revised),
      help: 'Shipments with a current revised ETA.',
      icon: CalendarClock,
    },
    {
      id: 'arrived',
      label: 'Arrived',
      value: count((s) => shipmentFlags(s).arrived),
      help: 'Actual warehouse arrival date is present.',
      icon: PackageOpen,
    },
    {
      id: 'units',
      label: 'Units in Transit',
      value: quantity(
        sum(
          data.shipments.filter((s) => !s.actualArrival).map((s) => shipmentQuantity(items(s.id))),
        ),
      ),
      help: 'Product-line units in shipments without warehouse arrival.',
      icon: PackageOpen,
    },
  ]
  const csv = () =>
    downloadFile(
      `shipments-${today()}.csv`,
      toCsv(
        shipments.map((s) => ({
          Invoice: s.number,
          Vessel: s.vessel,
          Products: items(s.id)
            .map(
              (i) =>
                `${data.products.find((p) => p.id === i.productId)?.name || 'Unknown'} (${i.quantity})`,
            )
            .join('; '),
          TotalQty: shipmentQuantity(items(s.id)),
          ETD: s.etd,
          PlannedETA: s.plannedEta,
          CurrentETA: effectiveShipmentEta(s),
          ActualWarehouseArrival: s.actualArrival,
          Stage: s.stage,
          ETASlipDays: etaSlip(s) ?? '',
          ActualArrivalDelayDays: arrivalDelay(s) ?? '',
          Remarks: s.remarks,
        })),
      ),
      'text/csv;charset=utf-8',
    )
  csvRef.current = csv
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <button
            key={card.id}
            title={card.help}
            onClick={() =>
              setQuick(
                quick === (card.id === 'units' ? 'open' : card.id)
                  ? ''
                  : card.id === 'units'
                    ? 'open'
                    : card.id,
              )
            }
            className={`rounded-2xl border bg-white p-4 text-left shadow-[0_2px_14px_rgba(15,23,42,.035)] transition hover:border-orange-300 ${quick === (card.id === 'units' ? 'open' : card.id) ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200'}`}
          >
            <div className="flex items-center justify-between">
              <span className="metric-label">{card.label}</span>
              <card.icon size={16} className="text-[#dc713a]" />
            </div>
            <div className="mt-2 metric-value">{card.value}</div>
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-[#173b3d]">Finished goods shipments</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {shipments.length} shipments · Arrival means actual warehouse arrival
            </p>
          </div>
          <Badge tone="teal">{data.shipments.length} total</Badge>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3 sm:px-5">
          <div className="relative min-w-48 flex-1 sm:max-w-sm">
            <Search size={15} className="absolute left-3 top-3 text-slate-400" />
            <Input
              aria-label="Search shipments"
              className="pl-9"
              placeholder="Search product, invoice, vessel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            aria-label="Filter shipment stage"
            className="max-w-48"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">All stages</option>
            {data.lookupValues
              .filter((v) => v.kind === 'shipmentStage')
              .map((v) => (
                <option key={v.id}>{v.value}</option>
              ))}
          </Select>
          <Select
            aria-label="Filter vessel"
            className="max-w-48"
            value={vessel}
            onChange={(e) => setVessel(e.target.value)}
          >
            <option value="">All vessels</option>
            {[...new Set(data.shipments.map((s) => s.vessel))].sort().map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
          <Select
            aria-label="Sort shipments"
            className="max-w-44"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="eta-asc">ETA: soonest</option>
            <option value="eta-desc">ETA: latest</option>
            <option value="qty-desc">Qty: high to low</option>
            <option value="number-asc">Invoice: A–Z</option>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setStage('')
              setVessel('')
              setQuick('')
            }}
          >
            <X size={14} /> Clear
          </Button>
        </div>
        {shipments.length ? (
          <>
            <div className="table-wrap hidden md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shipment / invoice</th>
                    <th>Vessel</th>
                    <th>Products</th>
                    <th>Units</th>
                    <th>ETD</th>
                    <th>Current ETA</th>
                    <th>ETA slip</th>
                    <th>Stage</th>
                    <th>Arrival</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id} className="cursor-pointer" onClick={() => onOpen(s)}>
                      <td className="font-bold text-[#173b3d]">{s.number}</td>
                      <td>{s.vessel}</td>
                      <td
                        className="max-w-56 truncate"
                        title={items(s.id)
                          .map((i) => data.products.find((p) => p.id === i.productId)?.name)
                          .join(', ')}
                      >
                        {items(s.id)
                          .map((i) => data.products.find((p) => p.id === i.productId)?.name)
                          .join(', ')}
                      </td>
                      <td className="font-semibold">{quantity(shipmentQuantity(items(s.id)))}</td>
                      <td>{dateLabel(s.etd)}</td>
                      <td className={shipmentFlags(s).overdue ? 'font-bold text-rose-700' : ''}>
                        {dateLabel(effectiveShipmentEta(s))}
                      </td>
                      <td>
                        {etaSlip(s) === null ? '—' : `${etaSlip(s)! > 0 ? '+' : ''}${etaSlip(s)}d`}
                      </td>
                      <td>
                        <Badge
                          tone={
                            s.actualArrival ? 'green' : shipmentFlags(s).overdue ? 'red' : 'blue'
                          }
                        >
                          {s.actualArrival ? 'Arrived' : s.stage}
                        </Badge>
                      </td>
                      <td>{dateLabel(s.actualArrival)}</td>
                      <td>
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {shipments.map((s) => (
                <button key={s.id} onClick={() => onOpen(s)} className="w-full p-4 text-left">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#173b3d]">{s.number}</span>
                    <Badge
                      tone={s.actualArrival ? 'green' : shipmentFlags(s).overdue ? 'red' : 'blue'}
                    >
                      {s.actualArrival ? 'Arrived' : s.stage}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {s.vessel} · {quantity(shipmentQuantity(items(s.id)))} units
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-slate-600">
                    <span>ETA {dateLabel(effectiveShipmentEta(s))}</span>
                    <span>{items(s.id).length} product lines</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="p-5">
            <Empty
              title="No matching shipments"
              description="Try clearing filters or add a shipment with product lines."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setStage('')
                    setVessel('')
                    setQuick('')
                  }}
                >
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

export function ShipmentDrawer({
  shipment,
  data,
  onClose,
  run,
}: {
  shipment: Shipment
  data: DataSet
  onClose: () => void
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const initialLines = () => data.shipmentItems.filter((i) => i.shipmentId === shipment.id)
  const [draft, setDraft] = useState(shipment),
    [lines, setLines] = useState<ShipmentItem[]>(initialLines),
    [baseline, setBaseline] = useState(JSON.stringify({ shipment, lines: initialLines() })),
    [reason, setReason] = useState(''),
    [note, setNote] = useState(''),
    [tab, setTab] = useState<'details' | 'history'>('details')
  useEffect(() => {
    const current = data.shipmentItems.filter((i) => i.shipmentId === shipment.id)
    setDraft(shipment)
    setLines(current)
    setBaseline(JSON.stringify({ shipment, lines: current }))
    setTab('details')
  }, [shipment.id])
  const stored = !!data.shipments.find((s) => s.id === shipment.id),
    dirty = JSON.stringify({ shipment: draft, lines }) !== baseline
  const close = () => {
    if (dirty && !window.confirm('Discard unsaved shipment changes?')) return
    onClose()
  }
  const productOptions = productChoices(data.products)
  const lookup = (kind: string) =>
    data.lookupValues
      .filter((v) => v.kind === kind)
      .sort((a, b) => a.sort - b.sort)
      .map((v) => v.value)
  const update = <K extends keyof Shipment>(key: K, value: Shipment[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const addLine = () =>
    setLines([...lines, stamp({ shipmentId: shipment.id, productId: '', quantity: 1 })])
  const updateLine = (id: string, patch: Partial<ShipmentItem>) =>
    setLines(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (await run(() => saveShipment(draft, lines, reason))) {
      const next = { ...draft, updatedAt: new Date().toISOString() }
      setDraft(next)
      setBaseline(JSON.stringify({ shipment: next, lines }))
      setReason('')
    }
  }
  const remove = async () => {
    if (
      !window.confirm(
        `Delete shipment ${draft.number}, its ${lines.length} product lines, ETA revision history, and activity records?`,
      )
    )
      return
    if (await run(() => deleteShipment(draft.id))) onClose()
  }
  const revisions = data.etaRevisions
    .filter((r) => r.shipmentId === shipment.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const logs = data.activityLogs
    .filter((a) => a.entityType === 'shipment' && a.entityId === shipment.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
            {stored && (
              <Button variant="danger" size="sm" onClick={remove}>
                <Trash2 size={14} /> Delete shipment
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
            <Button onClick={() => save()}>
              Save shipment <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <Card key={label} className="p-3">
            <div className="metric-label">{label}</div>
            <div className="mt-1 text-lg font-bold text-[#173b3d]">{value}</div>
          </Card>
        ))}
      </div>
      <div className="mb-5 flex border-b border-slate-200">
        <button className="tab" data-active={tab === 'details'} onClick={() => setTab('details')}>
          Shipment details
        </button>
        <button className="tab" data-active={tab === 'history'} onClick={() => setTab('history')}>
          ETA revisions & history <Badge tone="slate">{revisions.length}</Badge>
        </button>
      </div>
      {tab === 'details' && (
        <form onSubmit={save} className="space-y-6">
          <div>
            <h3 className="section-title mb-3">Identity & schedule</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Shipment / invoice number">
                <Input
                  required
                  value={draft.number}
                  onChange={(e) => update('number', e.target.value)}
                  placeholder="INV-SEA-1053"
                />
              </Field>
              <Field label="Vessel">
                <Input
                  required
                  value={draft.vessel}
                  onChange={(e) => update('vessel', e.target.value)}
                  placeholder="Vessel or carrier"
                />
              </Field>
              <Field label="ETD">
                <Input
                  type="date"
                  value={draft.etd}
                  onChange={(e) => update('etd', e.target.value)}
                />
              </Field>
              <Field label="Original planned ETA">
                <Input
                  type="date"
                  value={draft.plannedEta}
                  onChange={(e) => update('plannedEta', e.target.value)}
                />
              </Field>
              <Field label="Current revised ETA">
                <Input
                  type="date"
                  value={draft.revisedEta}
                  onChange={(e) => update('revisedEta', e.target.value)}
                />
              </Field>
              <Field label="Actual warehouse arrival">
                <Input
                  type="date"
                  value={draft.actualArrival}
                  onChange={(e) => update('actualArrival', e.target.value)}
                />
              </Field>
              <Field label="Current stage">
                <SearchSelect
                  value={draft.stage}
                  options={lookup('shipmentStage')}
                  onChange={(v) => update('stage', v)}
                />
              </Field>
              <Field
                label="ETA change reason"
                help="Saved with each committed effective ETA change."
              >
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Optional reason"
                />
              </Field>
            </div>
          </div>
          <div>
            <h3 className="section-title mb-3">Product lines</h3>
            <div className="space-y-3">
              {lines.map((line, index) => (
                <Card key={line.id} className="flex flex-wrap items-end gap-3 p-3">
                  <Field label={`Product ${index + 1}`} className="min-w-52 flex-1">
                    <SearchSelect
                      value={line.productId}
                      options={productOptions}
                      onChange={(id) => updateLine(line.id, { productId: id })}
                    />
                  </Field>
                  <Field label="Quantity" className="w-28">
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
                    className="text-rose-700"
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
              <div className="text-sm font-bold text-[#173b3d]">
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
          <div className="rounded-xl bg-teal-50 p-3 text-xs text-teal-800">
            An arrival is counted only when Actual warehouse arrival is set. The stage remains a
            separately editable operational label.
          </div>
          <button type="submit" className="sr-only">
            Save shipment
          </button>
        </form>
      )}
      {tab === 'history' && (
        <div className="space-y-6">
          <div>
            <h3 className="section-title mb-3">ETA revision history</h3>
            {revisions.length ? (
              <div className="space-y-3">
                {revisions.map((r) => (
                  <Card key={r.id} className="p-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <span>{dateLabel(r.previousDate)}</span>
                      <ArrowRight size={15} className="text-[#d96d35]" />
                      <span>{dateLabel(r.newDate)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleString()}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No ETA revisions yet. Saving a changed effective ETA records one here.
              </p>
            )}
          </div>
          <div>
            <h3 className="section-title mb-3">Activity & notes</h3>
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
                  if (await run(() => addNote('shipment', shipment.id, note))) setNote('')
                }}
              >
                Post update
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {logs.map((a) => (
                <div key={a.id} className="border-b border-slate-200 pb-3">
                  <div className="text-sm text-slate-700">{a.message}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {new Date(a.createdAt).toLocaleString()}
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
