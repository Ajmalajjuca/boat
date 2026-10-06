import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  PackageCheck,
  Plus,
  Trash2,
} from 'lucide-react'
import type { DataSet, GRNReceipt, Lot, RMBatch } from './models'
import { productChoices, stamp } from './models'
import {
  balance,
  dateLabel,
  effectiveRmReadyDate,
  fullGrnDate,
  grnProgress,
  leadTime,
  planDelay,
  quantity,
  signedDays,
  rmMetrics,
  today,
  totalGrn,
} from './calculations'
import {
  addNote,
  deleteBatch,
  deleteLot,
  deleteReceipt,
  saveBatch,
  saveLot,
  saveReceipt,
} from './repository'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  SearchSelect,
  Select,
  Sheet,
  Textarea,
} from './ui'

type Props = {
  lot: Lot
  data: DataSet
  onClose: () => void
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}
const number = (s: string) => (s === '' ? 0 : Number(s))
export default function LotDrawer({ lot, data, onClose, run }: Props) {
  const [draft, setDraft] = useState(lot),
    [baseline, setBaseline] = useState(JSON.stringify(lot)),
    [tab, setTab] = useState<'overview' | 'rm' | 'grn' | 'history'>('overview')
  const [batch, setBatch] = useState<RMBatch | null>(null),
    [receipt, setReceipt] = useState<GRNReceipt | null>(null),
    [note, setNote] = useState('')
  useEffect(() => {
    setDraft(lot)
    setBaseline(JSON.stringify(lot))
    setTab('overview')
  }, [lot.id])
  const dirty = JSON.stringify(draft) !== baseline,
    stored = !!data.lots.find((l) => l.id === lot.id)
  const close = () => {
    if (dirty && !window.confirm('Discard unsaved lot changes?')) return
    onClose()
  }
  const rs = data.grnReceipts.filter((r) => r.lotId === lot.id),
    bs = data.rmBatches.filter((b) => b.lotId === lot.id),
    logs = data.activityLogs
      .filter((a) => a.entityType === 'lot' && a.entityId === lot.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const metrics = rmMetrics(draft, bs),
    products = productChoices(data.products)
  const lookup = (kind: string) =>
    data.lookupValues
      .filter((v) => v.kind === kind)
      .sort((a, b) => a.sort - b.sort)
      .map((v) => v.value)
  const update = <K extends keyof Lot>(key: K, value: Lot[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const setMode = (mode: Lot['rmMode']) =>
    setDraft((d) => ({ ...d, rmMode: mode, rmComponents: mode === 'all' ? [] : d.rmComponents }))
  const save = async () => {
    const ok = await run(() => saveLot(draft))
    if (ok) {
      const next = { ...draft, updatedAt: new Date().toISOString() }
      setDraft(next)
      setBaseline(JSON.stringify(next))
    }
  }
  const remove = async () => {
    if (!stored) {
      onClose()
      return
    }
    if (
      !window.confirm(
        `Delete lot ${draft.label} and its ${bs.length} RM batches, ${rs.length} GRN receipts, and history records?`,
      )
    )
      return
    if (await run(() => deleteLot(lot.id))) onClose()
  }
  const openBatch = (value?: RMBatch) =>
    setBatch(
      value ||
        stamp({
          lotId: lot.id,
          component: draft.rmComponents[0] || '',
          label: '',
          plannedQty: 0,
          plannedDate: '',
          receivedQty: 0,
          receivedDate: '',
          status: 'Pending',
          notes: '',
        }),
    )
  const openReceipt = (value?: GRNReceipt) =>
    setReceipt(value || stamp({ lotId: lot.id, label: '', date: today(), quantity: 0, note: '' }))
  const saveBatchForm = async (e: FormEvent) => {
    e.preventDefault()
    if (batch && (await run(() => saveBatch(batch)))) setBatch(null)
  }
  const saveReceiptForm = async (e: FormEvent) => {
    e.preventDefault()
    if (receipt && (await run(() => saveReceipt(receipt)))) setReceipt(null)
  }
  const toggleComponent = (component: string) =>
    update(
      'rmComponents',
      draft.rmComponents.includes(component)
        ? draft.rmComponents.filter((c) => c !== component)
        : [...draft.rmComponents, component],
    )
  const stats = useMemo(
    () => [
      { label: 'Lot quantity', value: quantity(draft.lotQty), icon: ClipboardList },
      { label: 'Fresh produced', value: quantity(draft.freshProductionQty), icon: PackageCheck },
      { label: 'Total GRN', value: quantity(totalGrn(rs)), icon: CheckCircle2 },
      { label: 'Balance', value: quantity(balance(draft, rs)), icon: Clock3 },
    ],
    [draft, rs],
  )
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={stored ? `${draft.label || 'Lot details'}` : 'New production lot'}
        subtitle={`${data.products.find((p) => p.id === draft.productId)?.name || 'Product'} · ${draft.category} · GRN means Goods Received Note`}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {stored && (
                <Button variant="danger" size="sm" onClick={remove}>
                  <Trash2 size={14} /> Delete lot
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={close}>
                Close
              </Button>
              <Button onClick={save}>
                {dirty ? 'Save changes' : 'Save lot'} <ArrowRight size={15} />
              </Button>
            </div>
          </div>
        }
      >
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <s.icon size={13} />
                {s.label}
              </div>
              <div className="mt-1 text-xl font-extrabold text-[#173b3d]">{s.value}</div>
            </Card>
          ))}
        </div>
        <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-[#d96d35] transition-all"
            style={{ width: `${grnProgress(draft, rs)}%` }}
          />
        </div>
        <div className="mb-5 flex overflow-x-auto border-b border-slate-200">
          {(
            [
              ['overview', 'Overview'],
              ['rm', 'RM Readiness'],
              ['grn', 'GRN Receipts'],
              ['history', 'Updates & History'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className="tab" data-active={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'overview' && (
          <div className="space-y-6">
            <div>
              <h3 className="section-title mb-3">Identification & ownership</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Product">
                  <SearchSelect
                    value={draft.productId}
                    options={products}
                    onChange={(id) => update('productId', id)}
                  />
                </Field>
                <Field label="Lot label">
                  <Input
                    required
                    value={draft.label}
                    onChange={(e) => update('label', e.target.value)}
                    placeholder="e.g. TWS-2403"
                  />
                </Field>
                <Field label="Product category">
                  <SearchSelect
                    value={draft.category}
                    options={lookup('category')}
                    onChange={(v) => update('category', v)}
                  />
                </Field>
                <Field label="Manufacturing partner (EMS)" help="EMS means manufacturing partner.">
                  <SearchSelect
                    value={draft.ems}
                    options={lookup('ems')}
                    onChange={(v) => update('ems', v)}
                    clearable
                  />
                </Field>
                <Field label="Point of contact">
                  <SearchSelect
                    value={draft.poc}
                    options={lookup('poc')}
                    onChange={(v) => update('poc', v)}
                    clearable
                  />
                </Field>
                <label className="flex items-center gap-3 pt-6 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={draft.directFg}
                    onChange={(e) => update('directFg', e.target.checked)}
                  />
                  <span>
                    Direct FG{' '}
                    <span className="block text-xs text-slate-500">
                      Finished goods ready for direct billing
                    </span>
                  </span>
                </label>
              </div>
            </div>
            <div>
              <h3 className="section-title mb-3">Production & material</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Overall status">
                  <SearchSelect
                    value={draft.status}
                    options={lookup('status')}
                    onChange={(v) => update('status', v)}
                  />
                </Field>
                <Field
                  label="Current stage"
                  help="PDI is the quality check before warehouse dispatch."
                >
                  <SearchSelect
                    value={draft.stage}
                    options={lookup('stage')}
                    onChange={(v) => update('stage', v)}
                  />
                </Field>
                <Field
                  label="Lot quantity"
                  help="Client-defined arrived raw material, expressed as finished-product-equivalent units."
                >
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.lotQty}
                    onChange={(e) => update('lotQty', number(e.target.value))}
                  />
                </Field>
                <Field label="Fresh production quantity">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.freshProductionQty}
                    onChange={(e) => update('freshProductionQty', number(e.target.value))}
                  />
                </Field>
                <Field
                  label="Rework quantity"
                  help="A subset of produced units; it is not added to fresh production."
                >
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.reworkQty}
                    onChange={(e) => update('reworkQty', number(e.target.value))}
                  />
                </Field>
                <Field label="Rework reason">
                  <Input
                    value={draft.reworkReason}
                    onChange={(e) => update('reworkReason', e.target.value)}
                    placeholder="Issue being corrected"
                  />
                </Field>
                <Field label="RM readiness mode">
                  <Select
                    value={draft.rmMode}
                    onChange={(e) => setMode(e.target.value as Lot['rmMode'])}
                  >
                    <option value="all">All RM Received</option>
                    <option value="components">Track by Component</option>
                  </Select>
                </Field>
                {draft.rmMode === 'all' && (
                  <Field
                    label="Ready quantity"
                    help="Producible units when tracking all RM together."
                  >
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={draft.readyQty}
                      onChange={(e) => update('readyQty', number(e.target.value))}
                    />
                  </Field>
                )}
              </div>
            </div>
            <div>
              <h3 className="section-title mb-3">Dates & logistics</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="RM ready date at factory"
                  help={
                    draft.rmMode === 'components'
                      ? 'Leave blank to use the date the last required component was fully received.'
                      : undefined
                  }
                >
                  <Input
                    type="date"
                    value={draft.rmReadyDate}
                    onChange={(e) => update('rmReadyDate', e.target.value)}
                  />
                </Field>
                <Field label="Planned completion / WH receipt">
                  <Input
                    type="date"
                    value={draft.plannedDate}
                    onChange={(e) => update('plannedDate', e.target.value)}
                  />
                </Field>
                <Field label="Current revised ETA">
                  <Input
                    type="date"
                    value={draft.revisedEta}
                    onChange={(e) => update('revisedEta', e.target.value)}
                  />
                </Field>
                <Field
                  label="Actual date"
                  help="Optional note. Completion timing is measured from the full GRN date."
                >
                  <Input
                    type="date"
                    value={draft.actualDate}
                    onChange={(e) => update('actualDate', e.target.value)}
                  />
                </Field>
                <Field label="Logistics mode">
                  <SearchSelect
                    value={draft.logisticsMode}
                    options={lookup('logistics')}
                    onChange={(v) => update('logisticsMode', v)}
                    clearable
                  />
                </Field>
                <div className="space-y-1 rounded-xl bg-teal-50 p-3 text-xs text-teal-800">
                  <div>
                    <b>Full GRN date:</b> {dateLabel(fullGrnDate(draft, rs))}
                  </div>
                  <div>
                    <b>Against planned date:</b>{' '}
                    {planDelay(draft, rs) === null
                      ? 'Not available'
                      : signedDays(planDelay(draft, rs))}
                  </div>
                  <div>
                    <b>RM ready:</b> {dateLabel(effectiveRmReadyDate(draft, bs))}
                    {!draft.rmReadyDate && effectiveRmReadyDate(draft, bs) && ' (from batches)'}
                  </div>
                  <div>
                    <b>RM-to-GRN lead time:</b>{' '}
                    {leadTime(draft, rs, bs) === null
                      ? 'Not available'
                      : `${leadTime(draft, rs, bs)} days`}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <h3 className="section-title mb-3">Blockers & follow-up</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Blocker category">
                  <SearchSelect
                    value={draft.blockerCategory}
                    options={lookup('blocker')}
                    onChange={(v) => update('blockerCategory', v)}
                  />
                </Field>
                <Field label="Follow-up date">
                  <Input
                    type="date"
                    value={draft.followUpDate}
                    onChange={(e) => update('followUpDate', e.target.value)}
                  />
                </Field>
                <Field label="Blocker description" className="sm:col-span-2">
                  <Textarea
                    value={draft.blockerDescription}
                    onChange={(e) => update('blockerDescription', e.target.value)}
                    placeholder="What is stopping progress?"
                  />
                </Field>
                <Field label="Follow-up note" className="sm:col-span-2">
                  <Textarea
                    value={draft.followUpNote}
                    onChange={(e) => update('followUpNote', e.target.value)}
                    placeholder="Next action and owner"
                  />
                </Field>
              </div>
            </div>
          </div>
        )}
        {tab === 'rm' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['RM readiness', `${Math.round(metrics.percent)}%`],
                ['Producible now', quantity(metrics.producible)],
                ['Target', quantity(metrics.target)],
                ['Bottleneck', metrics.bottleneck],
              ].map(([label, value]) => (
                <Card key={label} className="p-3">
                  <div className="metric-label">{label}</div>
                  <div className="mt-1 text-lg font-bold text-[#173b3d]">{value}</div>
                </Card>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {metrics.complete ? (
                <Badge tone="green">Fully RM Complete</Badge>
              ) : (
                <Badge tone="amber">RM Incomplete</Badge>
              )}
              <span className="text-xs text-slate-500">
                Quantities are finished-product-equivalent units.
              </span>
            </div>
            <Card className="p-4">
              <h3 className="section-title mb-3">Readiness method</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="RM readiness mode">
                  <Select
                    value={draft.rmMode}
                    onChange={(e) => setMode(e.target.value as Lot['rmMode'])}
                  >
                    <option value="all">All RM Received</option>
                    <option value="components">Track by Component</option>
                  </Select>
                </Field>
                {draft.rmMode === 'all' && (
                  <Field label="Ready quantity">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={draft.readyQty}
                      onChange={(e) => update('readyQty', number(e.target.value))}
                    />
                  </Field>
                )}
              </div>
              {draft.rmMode === 'all' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                  <Badge tone="teal">Kit (All Together) selected</Badge>
                  The ready quantity represents the complete material kit.
                </div>
              )}
              {draft.rmMode === 'components' && (
                <>
                  <p className="mt-4 text-xs text-slate-500">
                    Choose required components. Kit (All Together) is handled by All RM Received
                    mode to avoid double-counting.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => setMode('all')}
                  >
                    Use Kit (All Together)
                  </Button>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lookup('component')
                      .filter((c) => c !== 'Kit (All Together)')
                      .map((component) => (
                        <label
                          key={component}
                          className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold ${draft.rmComponents.includes(component) ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600'}`}
                        >
                          <input
                            type="checkbox"
                            className="mr-2"
                            checked={draft.rmComponents.includes(component)}
                            onChange={() => toggleComponent(component)}
                          />
                          {component}
                        </label>
                      ))}
                  </div>
                </>
              )}
              {dirty && (
                <p className="mt-3 text-xs text-amber-700">
                  Save lot changes before adding a material batch.
                </p>
              )}
            </Card>
            <div className="flex items-center justify-between">
              <h3 className="section-title">Material batches</h3>
              <Button
                size="sm"
                onClick={() => openBatch()}
                disabled={
                  !stored || draft.rmMode !== 'components' || dirty || !draft.rmComponents.length
                }
              >
                <Plus size={14} /> Add batch
              </Button>
            </div>
            {bs.length ? (
              <Card className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Batch</th>
                      <th>Planned</th>
                      <th>Received</th>
                      <th>Planned date</th>
                      <th>Received date</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bs.map((b) => (
                      <tr key={b.id}>
                        <td>
                          {b.component}
                          {!(
                            draft.rmMode === 'components' &&
                            draft.rmComponents.includes(b.component)
                          ) && (
                            <Badge tone="slate" className="ml-2">
                              Not counted
                            </Badge>
                          )}
                        </td>
                        <td>{b.label}</td>
                        <td>{quantity(b.plannedQty)}</td>
                        <td className="font-semibold">{quantity(b.receivedQty)}</td>
                        <td>{dateLabel(b.plannedDate)}</td>
                        <td>{dateLabel(b.receivedDate)}</td>
                        <td>{b.status}</td>
                        <td>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openBatch(b)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-rose-700"
                              onClick={async () => {
                                if (window.confirm(`Delete ${b.label} material batch?`))
                                  await run(() => deleteBatch(b))
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                No material batches yet. Select components, save the lot, then add batches.
              </p>
            )}
          </div>
        )}
        {tab === 'grn' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4">
                <div className="metric-label">Total GRN</div>
                <div className="metric-value mt-1">{quantity(totalGrn(rs))}</div>
              </Card>
              <Card className="p-4">
                <div className="metric-label">Pending quantity</div>
                <div className="metric-value mt-1">{quantity(balance(draft, rs))}</div>
              </Card>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="section-title">Warehouse receipts</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Multiple partial Goods Received Notes are supported.
                </p>
              </div>
              <Button size="sm" onClick={() => openReceipt()} disabled={!stored || dirty}>
                <Plus size={14} /> Add receipt
              </Button>
            </div>
            {rs.length ? (
              <div className="space-y-2">
                {[...rs]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((r) => (
                    <Card
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div>
                        <div className="font-semibold text-[#173b3d]">
                          {r.label} <Badge tone="teal">{quantity(r.quantity)} units</Badge>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {dateLabel(r.date)}
                          {r.note ? ` · ${r.note}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openReceipt(r)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-700"
                          onClick={async () => {
                            if (
                              window.confirm(
                                `Delete receipt ${r.label}? The lot's completion and balance will update.`,
                              )
                            )
                              await run(() => deleteReceipt(r))
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </Card>
                  ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No GRN receipts recorded. Add the first partial or full warehouse receipt.
              </p>
            )}
          </div>
        )}
        {tab === 'history' && (
          <div className="space-y-5">
            <Card className="p-4">
              <h3 className="section-title mb-3">Add an update</h3>
              <Textarea
                aria-label="Update note"
                placeholder="Record a meaningful update or next action..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  disabled={!stored || !note.trim()}
                  onClick={async () => {
                    if (await run(() => addNote('lot', lot.id, note))) setNote('')
                  }}
                >
                  Post update
                </Button>
              </div>
            </Card>
            <div className="space-y-3">
              {logs.map((item) => (
                <div key={item.id} className="flex gap-3 border-b border-slate-200 pb-3">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#dc713a]" />
                  <div>
                    <div className="text-sm text-slate-700">{item.message}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
              {!logs.length && (
                <p className="text-sm text-slate-500">
                  No updates yet. Committed changes and notes appear here.
                </p>
              )}
            </div>
          </div>
        )}
      </Sheet>
      <Modal
        open={!!batch}
        onOpenChange={(v) => {
          if (!v) setBatch(null)
        }}
        title={
          batch && bs.some((b) => b.id === batch.id) ? 'Edit material batch' : 'Add material batch'
        }
      >
        {batch && (
          <form onSubmit={saveBatchForm} className="space-y-4">
            <Field label="Component">
              <SearchSelect
                value={batch.component}
                options={draft.rmComponents}
                onChange={(v) => setBatch({ ...batch, component: v })}
              />
            </Field>
            <Field label="Batch label">
              <Input
                required
                value={batch.label}
                onChange={(e) => setBatch({ ...batch, label: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Planned quantity">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={batch.plannedQty}
                  onChange={(e) => setBatch({ ...batch, plannedQty: number(e.target.value) })}
                />
              </Field>
              <Field label="Received quantity">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={batch.receivedQty}
                  onChange={(e) => setBatch({ ...batch, receivedQty: number(e.target.value) })}
                />
              </Field>
              <Field label="Planned date">
                <Input
                  type="date"
                  value={batch.plannedDate}
                  onChange={(e) => setBatch({ ...batch, plannedDate: e.target.value })}
                />
              </Field>
              <Field label="Received date">
                <Input
                  type="date"
                  value={batch.receivedDate}
                  onChange={(e) => setBatch({ ...batch, receivedDate: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Status">
              <Select
                value={batch.status}
                onChange={(e) => setBatch({ ...batch, status: e.target.value })}
              >
                <option>Pending</option>
                <option>Partial</option>
                <option>Received</option>
                <option>Hold</option>
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea
                value={batch.notes}
                onChange={(e) => setBatch({ ...batch, notes: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setBatch(null)}>
                Cancel
              </Button>
              <Button type="submit">Save batch</Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={!!receipt}
        onOpenChange={(v) => {
          if (!v) setReceipt(null)
        }}
        title={
          receipt && rs.some((r) => r.id === receipt.id) ? 'Edit GRN receipt' : 'Add GRN receipt'
        }
      >
        {receipt && (
          <form onSubmit={saveReceiptForm} className="space-y-4">
            <Field label="Receipt label">
              <Input
                required
                value={receipt.label}
                onChange={(e) => setReceipt({ ...receipt, label: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Receipt date">
                <Input
                  type="date"
                  required
                  max={today()}
                  value={receipt.date}
                  onChange={(e) => setReceipt({ ...receipt, date: e.target.value })}
                />
              </Field>
              <Field label="Quantity">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  max={
                    draft.lotQty -
                    totalGrn(rs) +
                    (rs.find((r) => r.id === receipt.id)?.quantity || 0)
                  }
                  required
                  value={receipt.quantity}
                  onChange={(e) => setReceipt({ ...receipt, quantity: number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Optional note">
              <Textarea
                value={receipt.note}
                onChange={(e) => setReceipt({ ...receipt, note: e.target.value })}
              />
            </Field>
            <p className="text-xs text-slate-500">
              Available to receive:{' '}
              {quantity(
                draft.lotQty - totalGrn(rs) + (rs.find((r) => r.id === receipt.id)?.quantity || 0),
              )}{' '}
              units.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setReceipt(null)}>
                Cancel
              </Button>
              <Button type="submit">Save receipt</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
