import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Activity,
  Archive,
  ArrowDownToLine,
  Box,
  Check,
  CircleAlert,
  Database,
  Download,
  Factory,
  Menu,
  Plus,
  Settings2,
  Ship,
  Upload,
  X,
} from 'lucide-react'
import { db, getData } from './db'
import type { DataSet, LookupValue, Lot, Product, Shipment } from './models'
import { dataKeys, productChoices, stamp } from './models'
import { completed, quantity, today } from './calculations'
import {
  downloadFile,
  exportData,
  importData,
  initialize,
  parseImport,
  saveProduct,
  deleteProduct,
} from './repository'
import Production from './Production'
import LotDrawer from './LotDrawer'
import Shipments, { newShipment, ShipmentDrawer } from './Shipments'
import Settings, { performReset } from './Settings'
import { Badge, Button, Card, Field, Input, Modal, SearchSelect } from './ui'
import { defaultLookup, newLot } from './demo'

type Screen = 'production' | 'completed' | 'shipments' | 'settings'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'
const screenInfo: Record<Screen, { title: string; description: string }> = {
  production: {
    title: 'Production Tracker',
    description: 'Monitor every active lot from material readiness to warehouse receipt.',
  },
  completed: {
    title: 'Completed',
    description: 'Lots with full GRN, including their dates, receipts, and history.',
  },
  shipments: {
    title: 'Finished Goods',
    description: 'Track incoming shipments, revised ETAs, and warehouse arrivals.',
  },
  settings: { title: 'Settings', description: 'Manage operational values and local browser data.' },
}
function productBlank(lookups: LookupValue[]): Product {
  return stamp({ name: '', variant: '', segment: defaultLookup(lookups, 'segment', 'PA / TWS') })
}
export default function App() {
  const data = useLiveQuery(getData, [])
  const [dbError, setDbError] = useState(''),
    [screen, setScreen] = useState<Screen>('production'),
    [menuOpen, setMenuOpen] = useState(false)
  const [selectedLot, setSelectedLot] = useState<Lot | null>(null),
    [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null)
  const [product, setProduct] = useState<Product | null>(null),
    [productBase, setProductBase] = useState('')
  const [addLotOpen, setAddLotOpen] = useState(false),
    [addLotProductId, setAddLotProductId] = useState('')
  const [importOpen, setImportOpen] = useState(false),
    [importRaw, setImportRaw] = useState<unknown>(null),
    [importPreview, setImportPreview] = useState<DataSet | null>(null),
    [importFile, setImportFile] = useState(''),
    [importMode, setImportMode] = useState<'merge' | 'replace'>('merge'),
    [importError, setImportError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle'),
    [message, setMessage] = useState('')
  const csvRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    db.open().catch((e) => setDbError(e instanceof Error ? e.message : 'Could not open IndexedDB.'))
  }, [])
  const run = async (fn: () => Promise<unknown>) => {
    setSaveState('saving')
    setMessage('')
    try {
      await fn()
      setSaveState('saved')
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2500)
      return true
    } catch (e) {
      setSaveState('failed')
      setMessage(e instanceof Error ? e.message : 'Save failed. Please try again.')
      return false
    }
  }
  const openProduct = (value?: Product) => {
    const next = value || productBlank(data?.lookupValues || [])
    setProduct(next)
    setProductBase(JSON.stringify(next))
  }
  const closeProduct = () => {
    if (
      product &&
      JSON.stringify(product) !== productBase &&
      !window.confirm('Discard unsaved product changes?')
    )
      return
    setProduct(null)
  }
  const saveProductForm = async (e: FormEvent) => {
    e.preventDefault()
    if (product && (await run(() => saveProduct(product)))) setProduct(null)
  }
  const removeProduct = async () => {
    if (!product) return
    const lots = data?.lots.filter((l) => l.productId === product.id) || []
    if (
      !window.confirm(
        `Delete ${product.name} and its ${lots.length} lots, RM batches, GRN receipts, and lot history? Products used in shipment lines cannot be deleted.`,
      )
    )
      return
    if (await run(() => deleteProduct(product.id))) setProduct(null)
  }
  const exportJson = async () => {
    try {
      const payload = await exportData()
      downloadFile(
        `control-tower-backup-${today()}.json`,
        JSON.stringify(payload, null, 2),
        'application/json',
      )
      setMessage('JSON backup downloaded.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Export failed.')
      setSaveState('failed')
    }
  }
  const openImport = () => {
    setImportOpen(true)
    setImportRaw(null)
    setImportPreview(null)
    setImportFile('')
    setImportError('')
    setImportMode('merge')
  }
  const readImport = async (file: File | undefined) => {
    if (!file) return
    setImportError('')
    setImportPreview(null)
    setImportRaw(null)
    setImportFile(file.name)
    try {
      const raw = JSON.parse(await file.text())
      const preview = parseImport(raw)
      setImportRaw(raw)
      setImportPreview(preview)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Invalid JSON file.')
    }
  }
  const commitImport = async () => {
    if (!importRaw) return
    if (
      importMode === 'replace' &&
      !window.confirm(
        'Replace all current records with this validated backup? This cannot be undone.',
      )
    )
      return
    const ok = await run(() => importData(importRaw, importMode))
    if (ok) {
      setImportOpen(false)
      setMessage(
        `${importMode === 'merge' ? 'Merged' : 'Replaced'} ${importPreview?.products.length || 0} products, ${importPreview?.lots.length || 0} lots, and ${importPreview?.shipments.length || 0} shipments.`,
      )
    }
  }
  const reset = () =>
    performReset(run, () => {
      setScreen('production')
      setSelectedLot(null)
      setSelectedShipment(null)
    })
  const selectedLotLive =
    selectedLot && (data?.lots.find((l) => l.id === selectedLot.id) || selectedLot)
  const selectedShipmentLive =
    selectedShipment &&
    (data?.shipments.find((s) => s.id === selectedShipment.id) || selectedShipment)
  const initialized = !!data?.settings.find((s) => s.key === 'initialized')
  const navItems: [Screen, typeof Factory][] = [
    ['production', Factory],
    ['completed', Archive],
    ['shipments', Ship],
    ['settings', Settings2],
  ]
  if (dbError)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6] p-5">
        <Card className="max-w-md p-6">
          <CircleAlert className="mb-3 text-rose-600" />
          <h1 className="text-lg font-bold">Local database unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{dbError}</p>
          <p className="mt-3 text-xs text-slate-500">
            Enable browser storage and reload this page.
          </p>
        </Card>
      </div>
    )
  if (!data)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[#173b3d]">
          <Activity className="animate-pulse text-[#d96d35]" /> Loading...
        </div>
      </div>
    )
  if (!initialized)
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#edf2f1] p-5">
        <Card className="w-full max-w-xl overflow-hidden">
          <div className="bg-[#123b3e] p-8 text-white">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#d96d35]">
              <Box size={25} />
            </div>
            <div className="text-xs font-bold uppercase tracking-[.22em] text-teal-200">
              Supply chain workspace
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your app starts here.</h1>
            <p className="mt-3 text-sm leading-6 text-teal-100">
              Track production lots, material shortages, partial GRN receipts, and finished goods
              shipments in one local workspace.
            </p>
          </div>
          <div className="space-y-3 p-6 sm:p-8">
            <Button
              className="w-full justify-start"
              size="lg"
              onClick={() => run(() => initialize('demo'))}
            >
              <Plus size={17} /> Load fictional demo data
            </Button>
            <Button
              className="w-full justify-start"
              variant="secondary"
              size="lg"
              onClick={() => run(() => initialize('empty'))}
            >
              <Database size={17} /> Start with an empty workspace
            </Button>
            <p className="pt-2 text-xs leading-5 text-slate-500">
              Data stays in this browser profile. You can export a JSON backup from Settings at any
              time.
            </p>
            {message && <p className="text-sm text-rose-700">{message}</p>}
          </div>
        </Card>
      </div>
    )
  return (
    <div className="min-h-screen bg-[#f5f7f6] lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-[#123b3e] text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#dd713a]">
                <Box size={22} />
              </div>
              <div>
                <div className="text-sm font-extrabold leading-4 tracking-wide">BOAT</div>
                <div className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-teal-200">
                  Supply chain
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-white lg:hidden"
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </Button>
          </div>
          <div className="px-4 pt-8">
            <div className="px-3 text-[10px] font-bold uppercase tracking-[.18em] text-teal-200/60">
              Workspace
            </div>
            <nav className="mt-3 space-y-1" aria-label="Main navigation">
              {navItems.map(([id, Icon]) => (
                <button
                  key={id}
                  onClick={() => {
                    setScreen(id)
                    setMenuOpen(false)
                    csvRef.current = null
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${screen === id ? 'bg-white/12 text-white shadow-inner' : 'text-teal-100/75 hover:bg-white/8 hover:text-white'}`}
                >
                  <Icon size={18} className={screen === id ? 'text-[#f3a46a]' : ''} />
                  <span className="flex-1">{screenInfo[id].title}</span>
                  {id === 'completed' && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">
                      {
                        data.lots.filter((l) =>
                          completed(
                            l,
                            data.grnReceipts.filter((r) => r.lotId === l.id),
                          ),
                        ).length
                      }
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
          <div className="mt-auto px-5 pb-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Local data ready
              </div>
              <div className="mt-2 text-[11px] leading-5 text-teal-100/70">
                Stored in this browser · No account or sync required
              </div>
            </div>
          </div>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <main className="min-w-0 flex-1">
        <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-7 lg:px-8">
          <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={20} />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-extrabold tracking-tight text-[#173b3d] sm:text-2xl">
                    {screenInfo[screen].title}
                  </h1>
                  {screen === 'production' && <Badge tone="teal">LIVE</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                  {screenInfo[screen].description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {screen === 'production' || screen === 'completed' ? (
                <>
                  <Button onClick={() => openProduct()}>
                    <Plus size={16} /> Add Product
                  </Button>
                  {data.products.length > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setAddLotProductId(data.products[0].id)
                        setAddLotOpen(true)
                      }}
                    >
                      <Plus size={16} /> Add Lot
                    </Button>
                  )}
                </>
              ) : screen === 'shipments' ? (
                <Button onClick={() => setSelectedShipment(newShipment(data.lookupValues))}>
                  <Plus size={16} /> Add Shipment
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={openImport}>
                <Upload size={15} /> <span className="hidden sm:inline">Import JSON</span>
                <span className="sm:hidden">Import</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={exportJson}>
                <Download size={15} /> <span className="hidden sm:inline">Export JSON</span>
                <span className="sm:hidden">Export</span>
              </Button>
              {screen !== 'settings' && (
                <Button variant="secondary" size="sm" onClick={() => csvRef.current?.()}>
                  <ArrowDownToLine size={15} /> CSV
                </Button>
              )}
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1700px] space-y-5 px-4 py-6 sm:px-7 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-500">
              Operations overview <span className="mx-2">/</span>{' '}
              <b className="text-[#173b3d]">{screenInfo[screen].title}</b>
            </div>
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${saveState === 'failed' ? 'bg-rose-50 text-rose-700' : saveState === 'saving' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
            >
              {saveState === 'failed' ? <CircleAlert size={13} /> : <Check size={13} />}{' '}
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'Saved'
                  : saveState === 'failed'
                    ? 'Save failed'
                    : 'Local data'}
            </div>
          </div>
          {message && (
            <div
              role="alert"
              className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${saveState === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-teal-200 bg-teal-50 text-teal-800'}`}
            >
              <span>{message}</span>
              <button aria-label="Dismiss message" onClick={() => setMessage('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {(screen === 'production' || screen === 'completed') && (
            <Production
              data={data}
              mode={screen === 'production' ? 'active' : 'completed'}
              onOpenLot={setSelectedLot}
              onNewLot={(productId) => setSelectedLot(newLot(productId, data.lookupValues))}
              onEditProduct={openProduct}
              csvRef={csvRef}
            />
          )}
          {screen === 'shipments' && (
            <Shipments data={data} onOpen={setSelectedShipment} csvRef={csvRef} />
          )}
          {screen === 'settings' && (
            <Settings
              data={data}
              run={run}
              onImport={openImport}
              onExport={exportJson}
              onReset={reset}
            />
          )}
        </div>
      </main>
      {selectedLotLive && (
        <LotDrawer
          key={selectedLotLive.id}
          lot={selectedLotLive}
          data={data}
          onClose={() => setSelectedLot(null)}
          run={run}
        />
      )}
      {selectedShipmentLive && (
        <ShipmentDrawer
          key={selectedShipmentLive.id}
          shipment={selectedShipmentLive}
          data={data}
          onClose={() => setSelectedShipment(null)}
          run={run}
        />
      )}
      <Modal
        open={!!product}
        onOpenChange={(v) => {
          if (!v) closeProduct()
        }}
        title={
          product && data.products.some((p) => p.id === product.id) ? 'Edit product' : 'Add product'
        }
      >
        {product && (
          <form onSubmit={saveProductForm} className="space-y-4">
            <Field label="Product name">
              <Input
                required
                autoFocus
                value={product.name}
                onChange={(e) => setProduct({ ...product, name: e.target.value })}
                placeholder="e.g. Auralite TWS Pro"
              />
            </Field>
            <Field label="Variant">
              <Input
                value={product.variant}
                onChange={(e) => setProduct({ ...product, variant: e.target.value })}
                placeholder="e.g. Midnight Black"
              />
            </Field>
            <Field label="Segment">
              <SearchSelect
                value={product.segment}
                options={data.lookupValues
                  .filter((v) => v.kind === 'segment')
                  .sort((a, b) => a.sort - b.sort)
                  .map((v) => v.value)}
                onChange={(v) => setProduct({ ...product, segment: v })}
              />
            </Field>
            <div className="flex items-center justify-between pt-2">
              <div>
                {data.products.some((p) => p.id === product.id) && (
                  <Button type="button" variant="danger" size="sm" onClick={removeProduct}>
                    Delete product
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={closeProduct}>
                  Cancel
                </Button>
                <Button type="submit">Save product</Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
      <Modal open={addLotOpen} onOpenChange={setAddLotOpen} title="Add production lot">
        <div className="space-y-4">
          <Field label="Product">
            <SearchSelect
              value={addLotProductId}
              options={productChoices(data.products)}
              onChange={setAddLotProductId}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddLotOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!addLotProductId}
              onClick={() => {
                setAddLotOpen(false)
                setSelectedLot(newLot(addLotProductId, data.lookupValues))
              }}
            >
              Continue to lot details
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={importOpen} onOpenChange={setImportOpen} title="Import JSON backup">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Choose a JSON backup exported from this app. The file is checked before any records are
            written.
          </p>
          <Field label="Backup file">
            <Input
              type="file"
              accept=".json,application/json"
              onChange={(e) => readImport(e.target.files?.[0])}
            />
          </Field>
          {importError && (
            <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {importError}
            </div>
          )}
          {importPreview && (
            <Card className="p-4">
              <div className="mb-2 text-sm font-bold text-[#173b3d]">
                {importFile} · import summary
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                {dataKeys.map((key) => (
                  <div key={key} className="flex justify-between gap-3">
                    <span>{key}</span>
                    <b>{quantity(importPreview[key].length)}</b>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <label className="flex cursor-pointer gap-2 text-sm">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
              />
              <span>
                <b>Merge</b>
                <span className="block text-xs text-slate-500">
                  Matching IDs are updated; new IDs are inserted. Duplicate dropdown values and
                  settings are kept once. Relationships are checked against the combined data.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-2 text-sm">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
              />
              <span>
                <b>Replace</b>
                <span className="block text-xs text-slate-500">
                  Current records are cleared only after complete validation and confirmation.
                </span>
              </span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!importPreview} onClick={commitImport}>
              Import records
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
