import { LoadingState } from './ui'
import { useConfirm } from './ui'
import { useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, ClipboardList, Clock3, PackageCheck, Plus, Trash2 } from 'lucide-react'
import type { LookupItem } from '@boat/domain/api'
import { addNote } from './api/activity'
import { NotFoundError } from './api/client'
import { deleteBatch, deleteReceipt, saveBatch, saveReceipt } from './api/entries'
import { deleteLot, lotConflict, type LotView, saveLot } from './api/lots'
import { type LotRecord, values } from './api/mappers'
import {
  activityKey,
  lotKey,
  refreshLots,
  useActivity,
  useLookups,
  useLot,
  useProducts,
} from './api/queries'
import { queryClient } from './api/queryClient'
import type { GRNReceipt, Lot, RMBatch } from '@boat/domain/models'
import { productChoices, stamp } from '@boat/domain/models'
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
} from '@boat/domain/calculations'
import {
  Badge,
  Button,
  Card,
  ConflictBanner,
  Field,
  Input,
  Modal,
  SavingContext,
  SearchSelect,
  Select,
  Sheet,
  Textarea,
  FormError,
  useFormErrors,
  type Run,
} from './ui'
import {
  fieldErrors,
  validateBatch,
  validateLot,
  validateReceipt,
  type FieldErrors,
} from '@boat/domain/validation'
import { type LotAccess, roleInfo, useAccess, useFeatures } from './access'

// addBatch opens the material batch form once the lot has loaded, for "Add batch" on a new lot.
// It names the component to start with; empty starts with the first one.
export type LotTarget = { id: string; addBatch?: string } | { draft: Lot }
type OpenOptions = { addBatch?: string }
type Props = {
  target: LotTarget
  onClose: () => void
  // A new lot reopens by id after its first save.
  onOpen: (id: string, options?: OpenOptions) => void
  // The lot was deleted by someone else.
  onGone: () => void
  run: Run
}
type EditorProps = Omit<Props, 'target'> & {
  view: LotView | null
  initial: Lot
  lookups: LookupItem[]
  addBatchOnOpen?: string
}
// Fields edited on the Overview tab; a failed save switches there so the error is visible.
const overviewFields = [
  'productId',
  'label',
  'category',
  'ems',
  'poc',
  'status',
  'stage',
  'lotQty',
  'readyQty',
  'rmReadyDate',
  'plannedDate',
  'revisedEta',
  'actualDate',
  'logisticsMode',
  'blockerCategory',
]
const number = (s: string) => (s === '' ? 0 : Number(s))
export default function LotDrawer({ target, ...props }: Props) {
  const lookups = useLookups().data
  const detail = useLot('id' in target ? target.id : undefined)
  const gone = detail.error instanceof NotFoundError
  useEffect(() => {
    if (gone) props.onGone()
  }, [gone])
  if (lookups && 'draft' in target)
    return <LotEditor view={null} initial={target.draft} lookups={lookups} {...props} />
  if (lookups && detail.data)
    return (
      <LotEditor
        view={detail.data}
        initial={detail.data.lot}
        lookups={lookups}
        addBatchOnOpen={'id' in target ? target.addBatch : undefined}
        {...props}
      />
    )
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title="Lot details"
    >
      {detail.error && !gone ? (
        <FormError message={detail.error.message} />
      ) : (
        <LoadingState label="Loading lot" />
      )}
    </Sheet>
  )
}

function LotEditor({
  view,
  initial,
  lookups,
  addBatchOnOpen,
  onClose,
  onOpen,
  onGone,
  run,
}: EditorProps) {
  const confirm = useConfirm()
  const [draft, setDraft] = useState<Lot & { version?: number }>(initial),
    [baseline, setBaseline] = useState(JSON.stringify(initial)),
    [conflict, setConflict] = useState<LotView | null>(null),
    [tab, setTab] = useState<'overview' | 'rm' | 'grn' | 'history'>(
      addBatchOnOpen ? 'rm' : 'overview',
    )
  // The component ticked last, which a new batch starts with.
  const lastTicked = useRef('')
  // "Add batch" may save the lot, so it waits while another save is on its way, including the
  // moment after a lot save lands and before its new version is adopted.
  const saving = useContext(SavingContext),
    [savingLot, setSavingLot] = useState(false)
  const [batch, setBatch] = useState<RMBatch | null>(null),
    [receipt, setReceipt] = useState<GRNReceipt | null>(null),
    [note, setNote] = useState('')
  const lotForm = useFormErrors(),
    batchForm = useFormErrors(),
    receiptForm = useFormErrors()
  const access = useAccess(),
    { grn } = useFeatures()
  const products = useProducts().data ?? []
  const dirty = JSON.stringify(draft) !== baseline,
    stored = !!view
  const adopt = (lot: LotRecord) => {
    setDraft(lot)
    setBaseline(JSON.stringify(lot))
  }
  // Follows the server while there are no unsaved edits. Query results keep their identity when
  // nothing changed, so this runs only on a real change, such as a refetch on window focus.
  useEffect(() => {
    if (view && !dirty) adopt(view.lot)
  }, [view])
  // A saved lot's edit level comes from the server, so editing the POC field cannot unlock it.
  const level: LotAccess = view ? view.lot.access : access.can('createLots') ? 'full' : 'none',
    readOnly = level === 'none',
    planLocked = level !== 'full',
    canDeleteEntries = access.can('deleteEntries') && !readOnly
  // Warns before a reload or tab close would discard unsaved lot edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const close = async () => {
    if (dirty && !(await confirm('Discard unsaved lot changes?'))) return
    onClose()
  }
  const rs = view?.receipts ?? [],
    bs = view?.batches ?? [],
    logs = useActivity('lots', view?.lot.id).data ?? []
  const metrics = rmMetrics(draft, bs),
    productOptions = productChoices(products)
  const lookup = (kind: Parameters<typeof values>[1]) => values(lookups, kind)
  const update = <K extends keyof Lot>(key: K, value: Lot[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    lotForm.clear(key)
  }
  const setMode = (mode: Lot['rmMode']) => {
    setDraft((d) => ({ ...d, rmMode: mode, rmComponents: mode === 'all' ? [] : d.rmComponents }))
    lotForm.clear('rmComponents', 'readyQty')
  }
  const showTabFor = (errors: FieldErrors) => {
    const keys = Object.keys(errors)
    if (keys.some((k) => overviewFields.includes(k))) setTab('overview')
    else if (keys.includes('rmComponents')) setTab('rm')
  }
  const failed = (e: unknown) => {
    const current = lotConflict(e)
    if (current) return setConflict(current)
    if (e instanceof NotFoundError) return onGone()
    lotForm.fail(e)
    showTabFor(fieldErrors(e))
  }
  // True when the lot saved and this drawer stays open on it. A new lot reopens by id instead,
  // carrying options to the reopened drawer.
  const save = async (closeAfter = false, options?: OpenOptions) => {
    setSavingLot(true)
    try {
      return await saveDraft(closeAfter, options)
    } finally {
      setSavingLot(false)
    }
  }
  const saveDraft = async (closeAfter: boolean, options?: OpenOptions) => {
    const found = validateLot(draft, !stored, view?.lot ?? null)
    if (!lotForm.check(found)) {
      showTabFor(found)
      return false
    }
    let saved: LotView | undefined
    const sent = draft
    const ok = await run(async () => {
      saved = await saveLot(sent, lookups)
      queryClient.setQueryData(lotKey(saved.lot.id), saved)
      await refreshLots()
    }, failed)
    if (!ok || !saved) return false
    if (closeAfter) {
      onClose()
      return false
    }
    if (!view) {
      onOpen(saved.lot.id, options)
      return false
    }
    // Edits typed while the save was on its way stay, with the new version for their own save.
    const next = saved.lot
    setDraft((d) => (d === sent ? next : { ...d, version: next.version }))
    setBaseline(JSON.stringify(next))
    return true
  }
  const remove = async () => {
    if (!stored) {
      onClose()
      return
    }
    if (
      !(await confirm(
        grn
          ? `Delete lot ${draft.label} and its ${bs.length} RM batches, ${rs.length} GRN receipts, and history records?`
          : `Delete lot ${draft.label} and its ${bs.length} RM batches and history records?`,
      ))
    )
      return
    const removed = await run(async () => {
      await deleteLot(draft.id)
      await refreshLots()
    }, failed)
    if (removed) onClose()
  }
  const openBatch = (value?: RMBatch, component = lastTicked.current) => {
    batchForm.reset()
    setBatch(
      value ||
        stamp({
          lotId: draft.id,
          component: draft.rmComponents.includes(component)
            ? component
            : draft.rmComponents[0] || '',
          label: '',
          plannedQty: 0,
          plannedDate: '',
          receivedQty: 0,
          receivedDate: '',
          status: 'Pending',
          notes: '',
        }),
    )
  }
  // "Add batch" saves a new or edited lot first, so the batch belongs to the lot as it stands.
  const addBatch = async () => {
    if (stored && !dirty) return openBatch()
    if (await save(false, { addBatch: lastTicked.current })) openBatch()
  }
  // A new lot saved through "Add batch" reopens here with the batch form open.
  useEffect(() => {
    if (addBatchOnOpen !== undefined) openBatch(undefined, addBatchOnOpen)
  }, [])
  const openReceipt = (value?: GRNReceipt) => {
    receiptForm.reset()
    setReceipt(value || stamp({ lotId: draft.id, label: '', date: today(), quantity: 0, note: '' }))
  }
  const editBatch = (patch: Partial<RMBatch>) => {
    setBatch((b) => (b ? { ...b, ...patch } : b))
    batchForm.clear(...Object.keys(patch))
  }
  const editReceipt = (patch: Partial<GRNReceipt>) => {
    setReceipt((r) => (r ? { ...r, ...patch } : r))
    receiptForm.clear(...Object.keys(patch))
  }
  const available = (r: GRNReceipt) =>
    draft.lotQty - totalGrn(rs) + (rs.find((x) => x.id === r.id)?.quantity || 0)
  // A batch or receipt someone else deleted answers 404; reload the lot so it disappears.
  const entryFailed = (form: ReturnType<typeof useFormErrors>) => (e: unknown) => {
    form.fail(e)
    if (e instanceof NotFoundError) void refreshLots()
  }
  const saveBatchForm = async (e: FormEvent) => {
    e.preventDefault()
    if (!batch) return
    const existing = bs.some((b) => b.id === batch.id)
    const previous = bs.find((b) => b.id === batch.id) ?? null
    if (!batchForm.check(validateBatch(batch, undefined, !existing, previous))) return
    const ok = await run(async () => {
      await saveBatch(draft.id, batch, lookups, existing)
      await refreshLots()
    }, entryFailed(batchForm))
    if (ok) setBatch(null)
  }
  const saveReceiptForm = async (e: FormEvent) => {
    e.preventDefault()
    if (!receipt) return
    const existing = rs.some((r) => r.id === receipt.id)
    if (!receiptForm.check(validateReceipt(receipt, available(receipt), undefined, !existing)))
      return
    const ok = await run(async () => {
      await saveReceipt(draft.id, receipt, existing)
      await refreshLots()
    }, entryFailed(receiptForm))
    if (ok) setReceipt(null)
  }
  const toggleComponent = (component: string) => {
    if (!draft.rmComponents.includes(component)) lastTicked.current = component
    update(
      'rmComponents',
      draft.rmComponents.includes(component)
        ? draft.rmComponents.filter((c) => c !== component)
        : [...draft.rmComponents, component],
    )
  }
  // GRN figures show only while GRN is switched on (FEATURE_GRN); rework and fresh production
  // are hidden for good.
  const stats = useMemo(
    () => [
      { label: 'Lot quantity', value: quantity(draft.lotQty), icon: ClipboardList },
      { label: 'RM ready', value: `${Math.round(metrics.percent)}%`, icon: PackageCheck },
      ...(grn
        ? [
            { label: 'Total GRN', value: quantity(totalGrn(rs)), icon: CheckCircle2 },
            { label: 'Balance', value: quantity(balance(draft, rs)), icon: Clock3 },
          ]
        : [
            {
              label: 'Actual date',
              value: draft.actualDate ? dateLabel(draft.actualDate) : 'Open',
              icon: CheckCircle2,
            },
          ]),
    ],
    [draft, rs, grn, metrics.percent],
  )
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
        title={stored ? `${draft.label || 'Lot details'}` : 'New production lot'}
        subtitle={`${products.find((p) => p.id === draft.productId)?.name || 'Product'} · ${draft.category}${view ? ` · ${view.lot.computed.summary}` : ''}`}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              {stored && access.can('deleteLots') && (
                <Button variant="danger" aria-label="Delete lot" className="px-3" onClick={remove}>
                  <Trash2 size={14} /> <span className="hidden sm:inline">Delete lot</span>
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
                    Save lot
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
            record="lot"
            onReload={() => {
              queryClient.setQueryData(lotKey(conflict.lot.id), conflict)
              adopt(conflict.lot)
              setConflict(null)
              lotForm.reset()
            }}
            onDismiss={() => setConflict(null)}
          />
        )}
        <div className="mb-5 empty:hidden">
          <FormError
            message={
              lotForm.errors.form ||
              (Object.keys(lotForm.errors).length > 1
                ? `Fix the ${Object.keys(lotForm.errors).length} highlighted fields to save this lot.`
                : undefined)
            }
          />
        </div>
        {access.user && level !== 'full' && (
          <div className="mb-5 rounded-lg border border-line bg-white px-3 py-2.5 text-[13px] text-ink-2">
            {readOnly
              ? `View only. ${roleInfo[access.user.role].label} users can't change this lot${access.user.role === 'poc' ? ` because its POC is ${view?.lot.poc || 'not set'}` : ''}.`
              : 'You can update progress on this lot. Locked fields such as product, lot quantity, planned date, and POC are set by a planner or admin.'}
          </div>
        )}
        <Card className="mb-5 overflow-hidden">
          <div
            className={`grid divide-x divide-line-soft ${grn ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}
          >
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 px-3 py-3 sm:px-4">
                <div className="flex items-center gap-1.5 truncate text-[13px] text-muted">
                  <s.icon size={14} aria-hidden="true" className="hidden shrink-0 sm:block" />
                  {s.label}
                </div>
                <div className="num mt-0.5 text-xl font-semibold text-ink">{s.value}</div>
              </div>
            ))}
          </div>
          <div className="h-1 bg-line-soft">
            <div
              className="h-full bg-ink/70 transition-all"
              style={{ width: `${grn ? grnProgress(draft, rs) : metrics.percent}%` }}
            />
          </div>
        </Card>
        <div className="scroll-row mb-5 border-b border-line" role="tablist">
          {(
            [
              ['overview', 'Overview'],
              ['rm', 'RM Readiness'],
              ...(grn ? ([['grn', 'GRN Receipts']] as const) : []),
              ['history', 'Updates & History'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className="tab"
              data-active={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'overview' && (
          <fieldset disabled={readOnly} className="min-w-0 space-y-6">
            <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <h3 className="section-title mb-3">Identification & ownership</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Product"
                  required
                  error={lotForm.errors.productId}
                  locked={planLocked && !readOnly}
                >
                  <SearchSelect
                    value={draft.productId}
                    options={productOptions}
                    onChange={(id) => update('productId', id)}
                  />
                </Field>
                <Field
                  label="Lot label"
                  required={stored}
                  help={
                    stored
                      ? undefined
                      : 'Leave blank to generate a lot reference automatically when saved.'
                  }
                  error={lotForm.errors.label}
                  locked={planLocked && !readOnly}
                >
                  <Input
                    required={stored}
                    value={draft.label}
                    onChange={(e) => update('label', e.target.value)}
                    placeholder="Generated automatically on save"
                  />
                </Field>
                <Field
                  label="Product category"
                  required
                  error={lotForm.errors.category}
                  locked={planLocked && !readOnly}
                >
                  <SearchSelect
                    value={draft.category}
                    options={lookup('category')}
                    onChange={(v) => update('category', v)}
                  />
                </Field>
                <Field
                  label="Manufacturing partner (EMS)"
                  locked={planLocked && !readOnly}
                  error={lotForm.errors.ems}
                  help="EMS means manufacturing partner."
                >
                  <SearchSelect
                    value={draft.ems}
                    options={lookup('ems')}
                    onChange={(v) => update('ems', v)}
                    clearable
                  />
                </Field>
                <Field
                  label="Point of contact"
                  error={lotForm.errors.poc}
                  locked={planLocked && !readOnly}
                >
                  <SearchSelect
                    value={draft.poc}
                    options={lookup('poc')}
                    onChange={(v) => update('poc', v)}
                    clearable
                  />
                </Field>
                <label className="flex items-center gap-3 pt-6 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    disabled={planLocked}
                    checked={draft.directFg}
                    onChange={(e) => update('directFg', e.target.checked)}
                  />
                  <span>
                    Direct FG{' '}
                    <span className="block text-xs text-muted">
                      Finished goods ready for direct billing
                    </span>
                  </span>
                </label>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <h3 className="section-title mb-3">Production & material</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Overall status" required error={lotForm.errors.status}>
                  <SearchSelect
                    value={draft.status}
                    options={lookup('status')}
                    onChange={(v) => update('status', v)}
                  />
                </Field>
                <Field
                  label="Current stage"
                  required
                  error={lotForm.errors.stage}
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
                  locked={planLocked && !readOnly}
                  error={lotForm.errors.lotQty}
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
                <Field label="RM readiness mode" locked={planLocked && !readOnly}>
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
                    error={lotForm.errors.readyQty}
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
            <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <h3 className="section-title mb-3">Dates & logistics</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="RM ready date at factory"
                  error={lotForm.errors.rmReadyDate}
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
                <Field
                  label="Planned completion / WH receipt"
                  locked={planLocked && !readOnly}
                  error={lotForm.errors.plannedDate}
                >
                  <Input
                    type="date"
                    value={draft.plannedDate}
                    onChange={(e) => update('plannedDate', e.target.value)}
                  />
                </Field>
                <Field label="Current revised ETA" error={lotForm.errors.revisedEta}>
                  <Input
                    type="date"
                    value={draft.revisedEta}
                    onChange={(e) => update('revisedEta', e.target.value)}
                  />
                </Field>
                <Field
                  label="Actual date"
                  error={lotForm.errors.actualDate}
                  help="Entering the actual date marks the lot as completed."
                >
                  <Input
                    type="date"
                    value={draft.actualDate}
                    onChange={(e) => update('actualDate', e.target.value)}
                  />
                </Field>
                <Field label="Logistics mode" error={lotForm.errors.logisticsMode}>
                  <SearchSelect
                    value={draft.logisticsMode}
                    options={lookup('logistics')}
                    onChange={(v) => update('logisticsMode', v)}
                    clearable
                  />
                </Field>
                <div className="space-y-1 rounded-xl bg-teal-50 p-3 text-xs text-teal-800">
                  {grn && (
                    <div>
                      <b>Full GRN date:</b> {dateLabel(fullGrnDate(draft, rs))}
                    </div>
                  )}
                  <div>
                    <b>Actual against planned date:</b>{' '}
                    {planDelay(draft) === null ? 'Not available' : signedDays(planDelay(draft))}
                  </div>
                  <div>
                    <b>RM ready:</b> {dateLabel(effectiveRmReadyDate(draft, bs))}
                    {!draft.rmReadyDate && effectiveRmReadyDate(draft, bs) && ' (from batches)'}
                  </div>
                  <div>
                    <b>RM ready to actual date:</b>{' '}
                    {leadTime(draft, bs) === null ? 'Not available' : `${leadTime(draft, bs)} days`}
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <h3 className="section-title mb-3">Blockers & follow-up</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Blocker category" error={lotForm.errors.blockerCategory}>
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
          </fieldset>
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
                  <div className="mt-1 text-lg font-bold text-ink">{value}</div>
                </Card>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {metrics.complete ? (
                <Badge tone="green">Fully RM Complete</Badge>
              ) : (
                <Badge tone="amber">RM Incomplete</Badge>
              )}
              <span className="text-xs text-muted">
                Quantities are finished-product-equivalent units.
              </span>
            </div>
            <Card className="p-4">
              <fieldset disabled={readOnly} className="min-w-0">
                <h3 className="section-title mb-3">Readiness method</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="RM readiness mode" locked={planLocked && !readOnly}>
                    <Select
                      value={draft.rmMode}
                      onChange={(e) => setMode(e.target.value as Lot['rmMode'])}
                    >
                      <option value="all">All RM Received</option>
                      <option value="components">Track by Component</option>
                    </Select>
                  </Field>
                  {draft.rmMode === 'all' && (
                    <Field label="Ready quantity" error={lotForm.errors.readyQty}>
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
                  <div className="mt-3 flex items-center gap-2 text-xs text-ink-2">
                    <Badge tone="teal">Kit (All Together) selected</Badge>
                    The ready quantity represents the complete material kit.
                  </div>
                )}
                {draft.rmMode === 'components' && (
                  <fieldset disabled={planLocked} className="min-w-0">
                    <p className="mt-4 text-xs text-muted">
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
                    <div
                      className="mt-3 flex flex-wrap gap-2"
                      data-invalid={lotForm.errors.rmComponents ? true : undefined}
                    >
                      {lookup('component')
                        .filter((c) => c !== 'Kit (All Together)')
                        .map((component) => (
                          <label
                            key={component}
                            className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold ${draft.rmComponents.includes(component) ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-line bg-white text-ink-2'}`}
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
                  </fieldset>
                )}
                {lotForm.errors.rmComponents && (
                  <p role="alert" className="mt-3 text-xs font-medium text-rose-700">
                    {lotForm.errors.rmComponents}
                  </p>
                )}
              </fieldset>
            </Card>
            <div className="flex items-center justify-between">
              <h3 className="section-title">Material batches</h3>
              {!readOnly && (
                <Button
                  size="sm"
                  onClick={() => void addBatch()}
                  disabled={
                    saving ||
                    savingLot ||
                    draft.rmMode !== 'components' ||
                    !draft.rmComponents.length
                  }
                >
                  <Plus size={14} /> Add batch
                </Button>
              )}
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
                            {!readOnly && (
                              <Button size="sm" variant="ghost" onClick={() => openBatch(b)}>
                                Edit
                              </Button>
                            )}
                            {canDeleteEntries && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-700"
                                onClick={async () => {
                                  if (await confirm(`Delete ${b.label} material batch?`))
                                    await run(async () => {
                                      await deleteBatch(b.id)
                                      await refreshLots()
                                    })
                                }}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : (
              <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">
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
                <p className="mt-1 text-xs text-muted">
                  Multiple partial Goods Received Notes are supported.
                </p>
              </div>
              {!readOnly && (
                <Button size="sm" onClick={() => openReceipt()} disabled={!stored || dirty}>
                  <Plus size={14} /> Add receipt
                </Button>
              )}
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
                        <div className="font-semibold text-ink">
                          {r.label} <Badge tone="teal">{quantity(r.quantity)} units</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {dateLabel(r.date)}
                          {r.note ? ` · ${r.note}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {!readOnly && (
                          <Button variant="ghost" size="sm" onClick={() => openReceipt(r)}>
                            Edit
                          </Button>
                        )}
                        {canDeleteEntries && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-700"
                            onClick={async () => {
                              if (
                                await confirm(
                                  `Delete receipt ${r.label}? The lot's completion and balance will update.`,
                                )
                              )
                                await run(async () => {
                                  await deleteReceipt(r.id)
                                  await refreshLots()
                                })
                            }}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line bg-white p-8 text-center text-sm text-muted">
                No GRN receipts recorded. Add the first partial or full warehouse receipt.
              </p>
            )}
          </div>
        )}
        {tab === 'history' && (
          <div className="space-y-5">
            {!readOnly && (
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
                      const posted = await run(async () => {
                        await addNote('lots', draft.id, note)
                        await queryClient.invalidateQueries({
                          queryKey: activityKey('lots', draft.id),
                        })
                      })
                      if (posted) setNote('')
                    }}
                  >
                    Post update
                  </Button>
                </div>
              </Card>
            )}
            <div className="space-y-3">
              {logs.map((item) => (
                <div key={item.id} className="flex gap-3 border-b border-line pb-3">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <div>
                    <div className="text-sm text-ink-2">{item.message}</div>
                    <div className="mt-1 text-xs text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                      {item.actorName && ` · ${item.actorName}`}
                    </div>
                  </div>
                </div>
              ))}
              {!logs.length && (
                <p className="text-sm text-muted">
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
          <form onSubmit={saveBatchForm} noValidate className="space-y-4">
            <FormError message={batchForm.errors.form} />
            <Field label="Component" required error={batchForm.errors.component}>
              <SearchSelect
                value={batch.component}
                options={draft.rmComponents}
                onChange={(v) => editBatch({ component: v })}
              />
            </Field>
            <Field
              label="Batch label"
              required={bs.some((b) => b.id === batch.id)}
              error={batchForm.errors.label}
              help={
                bs.some((b) => b.id === batch.id)
                  ? undefined
                  : 'Leave blank to generate a material batch reference automatically when saved.'
              }
            >
              <Input
                required={bs.some((b) => b.id === batch.id)}
                placeholder="Generated automatically on save"
                value={batch.label}
                onChange={(e) => editBatch({ label: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Planned quantity" error={batchForm.errors.plannedQty}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={batch.plannedQty}
                  onChange={(e) => editBatch({ plannedQty: number(e.target.value) })}
                />
              </Field>
              <Field label="Received quantity" error={batchForm.errors.receivedQty}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={batch.receivedQty}
                  onChange={(e) => editBatch({ receivedQty: number(e.target.value) })}
                />
              </Field>
              <Field label="Planned date" error={batchForm.errors.plannedDate}>
                <Input
                  type="date"
                  value={batch.plannedDate}
                  onChange={(e) => editBatch({ plannedDate: e.target.value })}
                />
              </Field>
              <Field label="Received date" error={batchForm.errors.receivedDate}>
                <Input
                  type="date"
                  value={batch.receivedDate}
                  onChange={(e) => editBatch({ receivedDate: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Status">
              <Select value={batch.status} onChange={(e) => editBatch({ status: e.target.value })}>
                <option>Pending</option>
                <option>Partial</option>
                <option>Received</option>
                <option>Hold</option>
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea
                value={batch.notes}
                onChange={(e) => editBatch({ notes: e.target.value })}
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
          <form onSubmit={saveReceiptForm} noValidate className="space-y-4">
            <FormError message={receiptForm.errors.form} />
            <Field
              label="Receipt label"
              required={rs.some((r) => r.id === receipt.id)}
              error={receiptForm.errors.label}
              help={
                rs.some((r) => r.id === receipt.id)
                  ? undefined
                  : 'Leave blank to generate a receipt reference automatically when saved.'
              }
            >
              <Input
                required={rs.some((r) => r.id === receipt.id)}
                placeholder="Generated automatically on save"
                value={receipt.label}
                onChange={(e) => editReceipt({ label: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Receipt date" required error={receiptForm.errors.date}>
                <Input
                  type="date"
                  required
                  max={today()}
                  value={receipt.date}
                  onChange={(e) => editReceipt({ date: e.target.value })}
                />
              </Field>
              <Field label="Quantity" required error={receiptForm.errors.quantity}>
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
                  onChange={(e) => editReceipt({ quantity: number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Optional note">
              <Textarea
                value={receipt.note}
                onChange={(e) => editReceipt({ note: e.target.value })}
              />
            </Field>
            <p className="text-xs text-muted">
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
