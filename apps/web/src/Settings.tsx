import { useConfirm } from './ui'
import { useState } from 'react'
import { Database, Download, Info, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react'
import type { LookupItem } from '@boat/domain/api'
import { fetchMe } from './api/auth'
import { saveSettings } from './api/admin'
import { addLookup, deleteLookup, renameLookup } from './api/lookups'
import { refreshEverything, useLookups, useSettings } from './api/queries'
import { useAuth } from './auth/AuthProvider'
import type { LookupKind } from '@boat/domain/models'
import Users from './Users'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  FormError,
  Input,
  Modal,
  SearchSelect,
  useFormErrors,
  type Run,
} from './ui'
import { validateLookupValue } from '@boat/domain/validation'
import { useAccess } from './access'

const kinds: { kind: LookupKind; label: string; help: string }[] = [
  { kind: 'segment', label: 'Segments', help: 'Product families used for grouping and filtering.' },
  { kind: 'category', label: 'Product categories', help: 'BAU and configurable NPI labels.' },
  { kind: 'ems', label: 'Manufacturing partners', help: 'EMS partners assigned to lots.' },
  { kind: 'poc', label: 'Points of contact', help: 'Operational owners on lots.' },
  { kind: 'status', label: 'Lot statuses', help: 'Overall lot health.' },
  { kind: 'stage', label: 'Production stages', help: 'Current manufacturing stage.' },
  { kind: 'blocker', label: 'Blocker categories', help: 'Causes of blocked production.' },
  { kind: 'logistics', label: 'Logistics modes', help: 'Transport method for lots.' },
  { kind: 'component', label: 'RM components', help: 'Material types used in readiness tracking.' },
  { kind: 'shipmentStage', label: 'Shipment stages', help: 'Pre-arrival and warehouse stages.' },
]
export default function Settings({
  run,
  onImport,
  onExport,
  onReset,
  onMessage,
}: {
  run: Run
  onImport: () => void
  onExport: () => void
  onReset: () => void
  onMessage: (message: string) => void
}) {
  const confirm = useConfirm()
  const access = useAccess(),
    editable = access.can('manageSettings')
  const [kind, setKind] = useState<LookupKind>('segment'),
    [value, setValue] = useState(''),
    [editing, setEditing] = useState<LookupItem | null>(null),
    [editValue, setEditValue] = useState('')
  const addForm = useFormErrors(),
    renameForm = useFormErrors()
  const current = kinds.find((k) => k.kind === kind)!,
    items = (useLookups().data ?? []).filter((v) => v.kind === kind).sort((a, b) => a.sort - b.sort)
  // Dropdown text appears in every record, so a change refreshes everything.
  const add = async () => {
    if (!addForm.check(validateLookupValue(value))) return
    const added = await run(async () => {
      await addLookup(kind, value)
      await refreshEverything()
    }, addForm.fail)
    if (added) setValue('')
  }
  const rename = async () => {
    if (!editing || !renameForm.check(validateLookupValue(editValue))) return
    const renamed = await run(async () => {
      await renameLookup(editing.id, editValue)
      await refreshEverything()
    }, renameForm.fail)
    if (renamed) setEditing(null)
  }
  return (
    <div className="space-y-6">
      {editable && <Users run={run} onMessage={onMessage} />}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="space-y-5">
          <Card>
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-[#1a2024]">Dropdown values</h2>
              <p className="mt-1 text-xs text-slate-500">
                {editable
                  ? 'Add values as your operation evolves. Values in use cannot be renamed or deleted until records are reassigned. Required values drive status cards and cannot be changed.'
                  : 'Values used in forms and filters. Only admins can change them.'}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row">
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 p-3 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r">
                {kinds.map((k) => (
                  <button
                    key={k.kind}
                    onClick={() => {
                      setKind(k.kind)
                      addForm.reset()
                    }}
                    className={`rounded-lg px-3 py-2 text-left text-xs font-semibold whitespace-nowrap ${kind === k.kind ? 'bg-red-50 text-red-700' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <div className="min-w-0 flex-1 p-5">
                <h3 className="font-bold text-[#1a2024]">{current.label}</h3>
                <p className="mt-1 text-xs text-slate-500">{current.help}</p>
                {editable && (
                  <div className="mt-4 flex items-start gap-2">
                    <Field
                      label={`New ${current.label.toLowerCase().replace(/s$/, '')}`}
                      error={addForm.errors.value || addForm.errors.form}
                      className="flex-1"
                    >
                      <Input
                        placeholder={`Add ${current.label.toLowerCase().replace(/s$/, '')}...`}
                        value={value}
                        onChange={(e) => {
                          setValue(e.target.value)
                          addForm.clear('value')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') add()
                        }}
                      />
                    </Field>
                    <Button onClick={add} className="mt-[22px]">
                      <Plus size={15} /> Add
                    </Button>
                  </div>
                )}
                <div className="mt-5 space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                    >
                      <span className="text-sm font-medium text-slate-700">
                        {item.value}
                        {item.system && (
                          <Badge className="ml-2" tone="slate">
                            Required
                          </Badge>
                        )}
                      </span>
                      {editable && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Rename ${item.value}`}
                            disabled={item.system}
                            title={
                              item.system
                                ? 'Used by app calculations; cannot be renamed'
                                : undefined
                            }
                            onClick={() => {
                              renameForm.reset()
                              setEditing(item)
                              setEditValue(item.value)
                            }}
                          >
                            <Pencil size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-rose-700"
                            aria-label={`Delete ${item.value}`}
                            disabled={item.system}
                            title={
                              item.system
                                ? 'Used by app calculations; cannot be deleted'
                                : undefined
                            }
                            onClick={async () => {
                              if (
                                await confirm(
                                  `Delete lookup value "${item.value}"? Values currently in use cannot be deleted.`,
                                )
                              )
                                await run(async () => {
                                  await deleteLookup(item.id)
                                  await refreshEverything()
                                })
                            }}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!items.length && (
                    <Empty
                      title="No values"
                      description={
                        editable
                          ? 'Add a value above to make it available in forms and filters.'
                          : 'An admin can add values here.'
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <Info size={18} className="mt-0.5 shrink-0 text-[#ed1c24]" />
              <div>
                <h3 className="font-bold text-[#1a2024]">
                  Operational definitions & provisional rules
                </h3>
                <div className="mt-3 grid gap-3 text-xs leading-5 text-slate-600 sm:grid-cols-2">
                  <p>
                    <b>GRN</b> is Goods Received Note. <b>Lot Qty</b> is the client's arrived
                    raw-material quantity, provisionally in finished-product-equivalent units.
                    Balance + GRN = Lot Qty.
                  </p>
                  <p>
                    <b>EMS</b> are manufacturing partners. <b>PDI</b> is the quality check before
                    warehouse dispatch. <b>FG</b> is finished goods ready for direct billing.
                  </p>
                  <p>
                    <b>PA</b> is personal audio: earphones, neckbands, and headphones. <b>NPI</b> is
                    New Product Integration. <b>BAU</b> is business as usual for launched products.
                  </p>
                  <p>
                    <b>Rework</b> is correction work. Rework quantity is a subset of fresh
                    production and is never added a second time. Component quantities are
                    finished-product-equivalent units; Kit mode replaces individual components.
                  </p>
                  <p>
                    <b>RM readiness</b> is the lowest received total among required components,
                    capped at lot quantity. All RM Received mode uses the ready quantity field.
                    These are provisional production indicators.
                  </p>
                  <p>
                    <b>Arrival</b> means actual warehouse arrival. Due windows include today through
                    three days ahead; missing dates produce no delay. Summary conditions can
                    overlap.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          {editable && (
            <>
              <SignInSettings run={run} onMessage={onMessage} />
            </>
          )}
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <Database size={19} className="shrink-0 text-[#ed1c24]" />
              <div>
                <h2 className="font-bold text-[#1a2024]">Data management</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Records are stored on the server and shared by every user. Export a JSON backup
                  for a copy you keep.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-2">
              {access.can('exportBackup') && (
                <Button variant="secondary" onClick={onExport}>
                  <Download size={16} /> Export all records as JSON
                </Button>
              )}
              {access.can('manageData') && (
                <>
                  <Button variant="secondary" onClick={onImport}>
                    <Upload size={16} /> Import JSON backup
                  </Button>
                  <Button variant="danger" onClick={onReset}>
                    <RotateCcw size={16} /> Reset all application data
                  </Button>
                </>
              )}
              {!access.can('exportBackup') && (
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  Backups are available to admins and planners. Import and reset are admin only.
                </p>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Merge updates matching IDs and adds new records, while keeping one copy of each
              dropdown value and setting key. Replace clears existing records only after validation
              and confirmation.
            </p>
          </Card>
        </div>
      </div>
      <Modal
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null)
        }}
        title="Rename dropdown value"
      >
        {editing && (
          <div>
            <FormError message={renameForm.errors.form} />
            <Field label="Value" required error={renameForm.errors.value}>
              <Input
                autoFocus
                value={editValue}
                onChange={(e) => {
                  setEditValue(e.target.value)
                  renameForm.clear('value')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename()
                }}
              />
            </Field>
            <p className="mt-2 text-xs text-slate-500">
              If this value is in use, reassign its records before renaming it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={rename}>Save value</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const timeZones = Intl.supportedValuesOf('timeZone')

// The idle sign-out time and the company time zone, which sets "today" for every date rule.
function SignInSettings({ run, onMessage }: { run: Run; onMessage: (message: string) => void }) {
  const auth = useAuth()
  const settings = useSettings().data
  const [idle, setIdle] = useState(''),
    [zone, setZone] = useState('')
  const form = useFormErrors()
  const idleValue = idle || String(settings?.idleTimeoutMinutes ?? ''),
    zoneValue = zone || settings?.timeZone || ''
  const save = async () => {
    const saved = await run(async () => {
      await saveSettings({ idleTimeoutMinutes: Number(idleValue), timeZone: zoneValue })
      // The time zone sets "today" for lot flags and month-end, so every read refreshes.
      await refreshEverything()
      // This browser's idle timer reads the session's value, so refresh it now.
      auth.signedIn(await fetchMe())
    }, form.fail)
    if (saved) onMessage('Settings saved.')
  }
  return (
    <Card className="p-5">
      <h2 className="font-bold text-[#1a2024]">Sign-in</h2>
      <div className="mt-4 grid gap-3">
        <FormError message={form.errors.form} />
        <Field label="Idle sign-out (minutes)" error={form.errors.idleTimeoutMinutes}>
          <Input
            type="number"
            min="5"
            max="720"
            step="1"
            value={idleValue}
            onChange={(e) => {
              setIdle(e.target.value)
              form.clear('idleTimeoutMinutes')
            }}
          />
        </Field>
        <Field label="Company time zone" error={form.errors.timeZone}>
          <SearchSelect
            value={zoneValue}
            options={timeZones}
            onChange={(v) => {
              setZone(v)
              form.clear('timeZone')
            }}
          />
        </Field>
        <Button onClick={save}>Save sign-in settings</Button>
      </div>
    </Card>
  )
}
