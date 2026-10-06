import { useState } from 'react'
import {
  Database,
  Download,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import type { DataSet, LookupKind, LookupValue } from './models'
import { isSystemLookup } from './models'
import { SCHEMA_VERSION } from './db'
import { deleteLookup, resetData, saveLookup } from './repository'
import { Badge, Button, Card, Empty, Field, Input, Modal } from './ui'

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
  data,
  run,
  onImport,
  onExport,
  onReset,
}: {
  data: DataSet
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onImport: () => void
  onExport: () => void
  onReset: () => void
}) {
  const [kind, setKind] = useState<LookupKind>('segment'),
    [value, setValue] = useState(''),
    [editing, setEditing] = useState<LookupValue | null>(null),
    [editValue, setEditValue] = useState('')
  const current = kinds.find((k) => k.kind === kind)!,
    items = data.lookupValues.filter((v) => v.kind === kind).sort((a, b) => a.sort - b.sort)
  const add = async () => {
    if (await run(() => saveLookup(kind, value))) setValue('')
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
      <div className="space-y-5">
        <Card>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-bold text-[#173b3d]">Dropdown values</h2>
            <p className="mt-1 text-xs text-slate-500">
              Add values as your operation evolves. Values in use cannot be renamed or deleted until
              records are reassigned. Required values drive status cards and cannot be changed.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row">
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 p-3 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r">
              {kinds.map((k) => (
                <button
                  key={k.kind}
                  onClick={() => setKind(k.kind)}
                  className={`rounded-lg px-3 py-2 text-left text-xs font-semibold whitespace-nowrap ${kind === k.kind ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1 p-5">
              <h3 className="font-bold text-[#173b3d]">{current.label}</h3>
              <p className="mt-1 text-xs text-slate-500">{current.help}</p>
              <div className="mt-4 flex gap-2">
                <Input
                  aria-label={`New ${current.label.toLowerCase()} value`}
                  placeholder={`Add ${current.label.toLowerCase().replace(/s$/, '')}...`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add()
                  }}
                />
                <Button onClick={add} disabled={!value.trim()}>
                  <Plus size={15} /> Add
                </Button>
              </div>
              <div className="mt-5 space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                  >
                    <span className="text-sm font-medium text-slate-700">
                      {item.value}
                      {isSystemLookup(item.kind, item.value) && (
                        <Badge className="ml-2" tone="slate">
                          Required
                        </Badge>
                      )}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Rename ${item.value}`}
                        disabled={isSystemLookup(item.kind, item.value)}
                        title={
                          isSystemLookup(item.kind, item.value)
                            ? 'Used by app calculations; cannot be renamed'
                            : undefined
                        }
                        onClick={() => {
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
                        disabled={isSystemLookup(item.kind, item.value)}
                        title={
                          isSystemLookup(item.kind, item.value)
                            ? 'Used by app calculations; cannot be deleted'
                            : undefined
                        }
                        onClick={async () => {
                          if (
                            window.confirm(
                              `Delete lookup value "${item.value}"? Values currently in use cannot be deleted.`,
                            )
                          )
                            await run(() => deleteLookup(item))
                        }}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>
                ))}
                {!items.length && (
                  <Empty
                    title="No values"
                    description="Add a value above to make it available in forms and filters."
                  />
                )}
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <Info size={18} className="mt-0.5 text-[#d96d35]" />
            <div>
              <h3 className="font-bold text-[#173b3d]">
                Operational definitions & provisional rules
              </h3>
              <div className="mt-3 grid gap-3 text-xs leading-5 text-slate-600 sm:grid-cols-2">
                <p>
                  <b>GRN</b> is Goods Received Note. <b>Lot Qty</b> is the client's arrived
                  raw-material quantity, provisionally in finished-product-equivalent units. Balance
                  + GRN = Lot Qty.
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
                  <b>Rework</b> is correction work. Rework quantity is a subset of fresh production
                  and is never added a second time. Component quantities are
                  finished-product-equivalent units; Kit mode replaces individual components.
                </p>
                <p>
                  <b>RM readiness</b> is the lowest received total among required components, capped
                  at lot quantity. All RM Received mode uses the ready quantity field. These are
                  provisional production indicators.
                </p>
                <p>
                  <b>Arrival</b> means actual warehouse arrival. Due windows include today through
                  three days ahead; missing dates produce no delay. Summary conditions can overlap.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <div className="space-y-5">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <Database size={19} className="text-[#d96d35]" />
            <div>
              <h2 className="font-bold text-[#173b3d]">Data management</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Records are stored in this browser using IndexedDB. Clearing browser storage removes
                them. Export JSON regularly for a portable backup; data does not sync across
                devices.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            <Button variant="secondary" onClick={onExport}>
              <Download size={16} /> Export all records as JSON
            </Button>
            <Button variant="secondary" onClick={onImport}>
              <Upload size={16} /> Import JSON backup
            </Button>
            <Button variant="danger" onClick={onReset}>
              <RotateCcw size={16} /> Reset all application data
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Merge updates matching IDs and adds new records, while keeping one copy of each dropdown
            value and setting key. Replace clears existing records only after validation and
            confirmation.
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-teal-700" />
            <h2 className="font-bold text-[#173b3d]">Local workspace</h2>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <div className="flex justify-between">
              <span>Products</span>
              <Badge tone="teal">{data.products.length}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Production lots</span>
              <Badge tone="teal">{data.lots.length}</Badge>
            </div>
            <div className="flex justify-between">
              <span>GRN receipts</span>
              <Badge tone="teal">{data.grnReceipts.length}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Shipments</span>
              <Badge tone="teal">{data.shipments.length}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Schema version</span>
              <Badge>{SCHEMA_VERSION}</Badge>
            </div>
          </div>
        </Card>
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
            <Field label="Value">
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={async (e) => {
                  if (
                    e.key === 'Enter' &&
                    (await run(() => saveLookup(editing.kind, editValue, editing)))
                  )
                    setEditing(null)
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
              <Button
                onClick={async () => {
                  if (await run(() => saveLookup(editing.kind, editValue, editing)))
                    setEditing(null)
                }}
              >
                Save value
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export async function performReset(
  run: (fn: () => Promise<unknown>) => Promise<boolean>,
  after: () => void,
) {
  if (
    window.confirm(
      'Reset all products, lots, receipts, shipments, lookup values, and history in this browser? This cannot be undone. Export a JSON backup first if needed.',
    )
  ) {
    if (await run(resetData)) after()
  }
}
