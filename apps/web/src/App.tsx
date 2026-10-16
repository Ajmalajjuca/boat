import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Activity,
  Archive,
  ArrowDownToLine,
  Box,
  CalendarCheck,
  Check,
  CircleAlert,
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
import type { DataSet, Product } from './models'
import { dataKeys, productChoices } from './models'
import { quantity, today } from './calculations'
import { downloadFile, exportData, importData, parseImport } from './repository'
import Production from './Production'
import MonthEnd from './MonthEnd'
import LotDrawer, { type LotTarget } from './LotDrawer'
import Shipments, { ShipmentDrawer, type ShipmentTarget } from './Shipments'
import Settings, { performReset } from './Settings'
import type { MePayload } from '@boat/domain/api'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './api/queryClient'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ChangePassword } from './auth/ChangePassword'
import { ProfileCard } from './auth/ProfileCard'
import { SignIn } from './auth/SignIn'
import { AcceptInvite, ResetPassword } from './auth/TokenPages'
import { AccessContext, accessFrom, can, setAccess } from './access'
import type { LookupItem } from '@boat/domain/api'
import { ConflictError } from './api/client'
import { type ProductRecord, toProduct, values } from './api/mappers'
import { deleteProduct, saveProduct } from './api/products'
import { refreshProducts, useCompletedCount, useLookups, useProducts } from './api/queries'
import { newLot, newProduct, newShipment } from './drafts'
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  Input,
  ConflictBanner,
  type CsvExport,
  Modal,
  SearchSelect,
  useFormErrors,
  type Run,
} from './ui'
import { validateProduct } from './validation'

type Screen = 'production' | 'completed' | 'monthEnd' | 'shipments' | 'settings'
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
  monthEnd: {
    title: 'Month-end Summary',
    description: 'Units planned for a month against GRN received by the end of that month.',
  },
  shipments: {
    title: 'Finished Goods',
    description: 'Track incoming shipments, revised ETAs, and warehouse arrivals.',
  },
  settings: { title: 'Settings', description: 'Manage operational values and local browser data.' },
}
function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6]">
      <div className="flex items-center gap-3 text-sm font-semibold text-[#173b3d]">
        <Activity className="animate-pulse text-[#d96d35]" /> Loading...
      </div>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </QueryClientProvider>
  )
}

// The invite and reset pages are chosen by path; everything else needs a session.
function Root() {
  const auth = useAuth()
  const [path, setPath] = useState(location.pathname)
  const home = () => {
    history.replaceState(null, '', '/')
    setPath('/')
  }
  if (path === '/invite') return <AcceptInvite onDone={home} />
  if (path === '/reset-password') return <ResetPassword onDone={home} />
  if (auth.me === undefined) return <Loading />
  if (!auth.me) return <SignIn />
  // A new key per user, so nothing from the last user's screens survives.
  return <Workspace key={auth.me.user.id} me={auth.me} />
}

function Workspace({ me }: { me: MePayload }) {
  const auth = useAuth()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const data = useLiveQuery(getData, [])
  const [dbError, setDbError] = useState(''),
    [screen, setScreen] = useState<Screen>('production'),
    [menuOpen, setMenuOpen] = useState(false)
  const [lotTarget, setLotTarget] = useState<LotTarget | null>(null),
    [shipmentTarget, setShipmentTarget] = useState<ShipmentTarget | null>(null)
  const [product, setProduct] = useState<(Product & { version?: number }) | null>(null),
    [productBase, setProductBase] = useState(''),
    [productConflict, setProductConflict] = useState<ProductRecord | null>(null)
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
  const csvRef = useRef<CsvExport | null>(null),
    busy = useRef(false),
    productForm = useFormErrors()
  const access = useMemo(() => accessFrom(me), [me])
  const lookups: LookupItem[] = useLookups().data ?? [],
    products = useProducts().data ?? [],
    completedCount = useCompletedCount().data
  setAccess(access)
  // Idle sign-out: no pointer or key activity for the workspace's idle timeout ends the session.
  const idleMinutes = me.idleTimeoutMinutes
  useEffect(() => {
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - last > idleMinutes * 60_000)
        void auth.signOut(`Signed out after ${idleMinutes} minutes without activity.`)
    }, 15_000)
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch))
      clearInterval(timer)
    }
  }, [idleMinutes, auth.signOut])
  useEffect(() => {
    db.open().catch((e) => setDbError(e instanceof Error ? e.message : 'Could not open IndexedDB.'))
  }, [])
  // Success messages fade; errors stay until dismissed or the next action.
  useEffect(() => {
    if (!message || saveState === 'failed') return
    const timer = setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(timer)
  }, [message, saveState])
  const run: Run = async (fn, onError) => {
    // Ignores repeat clicks while a save is still in flight.
    if (busy.current) return false
    busy.current = true
    setSaveState('saving')
    setMessage('')
    try {
      await fn()
      setSaveState('saved')
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2500)
      return true
    } catch (e) {
      setSaveState('failed')
      if (onError) onError(e)
      else setMessage(e instanceof Error ? e.message : 'Save failed. Please try again.')
      return false
    } finally {
      busy.current = false
    }
  }
  const openProduct = (value?: ProductRecord) => {
    const next = value || newProduct(lookups)
    productForm.reset()
    setProductConflict(null)
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
  // A 409 that carries the server's record is a stale version; other 409s are rules to explain.
  const productFailed = (e: unknown) => {
    if (e instanceof ConflictError && e.current)
      setProductConflict(toProduct(e.current as Parameters<typeof toProduct>[0]))
    else productForm.fail(e)
  }
  const saveProductForm = async (e: FormEvent) => {
    e.preventDefault()
    if (!product || !productForm.check(validateProduct(product))) return
    const saved = await run(async () => {
      await saveProduct(product, lookups)
      await refreshProducts()
    }, productFailed)
    if (saved) {
      setProduct(null)
      setMessage(`Product ${product.name.trim()} saved.`)
    }
  }
  const removeProduct = async () => {
    if (!product) return
    if (
      !window.confirm(
        `Delete ${product.name} and all its lots, RM batches, GRN receipts, and lot history? Products used in shipment lines cannot be deleted.`,
      )
    )
      return
    const removed = await run(async () => {
      await deleteProduct(product.id)
      await refreshProducts()
    }, productForm.fail)
    if (removed) setProduct(null)
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
    const ok = await run(
      () => importData(importRaw, importMode),
      (e) => setImportError(e instanceof Error ? e.message : 'Import failed.'),
    )
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
      setLotTarget(null)
      setShipmentTarget(null)
    })
  const navItems: [Screen, typeof Factory][] = [
    ['production', Factory],
    ['completed', Archive],
    ['monthEnd', CalendarCheck],
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
  if (!data) return <Loading />
  return (
    <AccessContext.Provider value={access}>
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
                        {completedCount ?? '…'}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>
            <div className="mt-auto space-y-3 px-5 pb-6">
              <ProfileCard
                onChangePassword={() => {
                  setPasswordOpen(true)
                  setMenuOpen(false)
                }}
              />
              <div className="flex items-center gap-2 px-1 text-[11px] text-teal-100/70">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Data stored in this browser
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
                    {can('editProducts') && (
                      <Button onClick={() => openProduct()}>
                        <Plus size={16} /> Add Product
                      </Button>
                    )}
                    {products.length > 0 && can('createLots') && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAddLotProductId(products[0].id)
                          setAddLotOpen(true)
                        }}
                      >
                        <Plus size={16} /> Add Lot
                      </Button>
                    )}
                  </>
                ) : screen === 'shipments' && can('editShipments') ? (
                  <Button onClick={() => setShipmentTarget({ draft: newShipment(lookups) })}>
                    <Plus size={16} /> Add Shipment
                  </Button>
                ) : null}
                {can('manageData') && (
                  <Button variant="secondary" size="sm" onClick={openImport}>
                    <Upload size={15} /> <span className="hidden sm:inline">Import JSON</span>
                    <span className="sm:hidden">Import</span>
                  </Button>
                )}
                {can('exportBackup') && (
                  <Button variant="secondary" size="sm" onClick={exportJson}>
                    <Download size={15} /> <span className="hidden sm:inline">Export JSON</span>
                    <span className="sm:hidden">Export</span>
                  </Button>
                )}
                {screen !== 'settings' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      if (!csvRef.current) return
                      try {
                        if (!(await csvRef.current())) {
                          setSaveState('idle')
                          setMessage('Nothing to export: the current view has no rows.')
                        }
                      } catch (e) {
                        setSaveState('failed')
                        setMessage(e instanceof Error ? e.message : 'Export failed.')
                      }
                    }}
                  >
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
            {message &&
              // Portaled toast stays visible and clickable above open drawers and modals.
              createPortal(
                <div
                  data-toast
                  role={saveState === 'failed' ? 'alert' : 'status'}
                  className={`pointer-events-auto fixed left-1/2 top-4 z-[90] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl ${saveState === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-teal-200 bg-teal-50 text-teal-800'}`}
                >
                  <span className="flex items-start gap-2">
                    {saveState === 'failed' ? (
                      <CircleAlert size={16} className="mt-0.5 shrink-0" />
                    ) : (
                      <Check size={16} className="mt-0.5 shrink-0" />
                    )}
                    {message}
                  </span>
                  <button aria-label="Dismiss message" onClick={() => setMessage('')}>
                    <X size={15} />
                  </button>
                </div>,
                document.body,
              )}
            {(screen === 'production' || screen === 'completed') && (
              <Production
                mode={screen === 'production' ? 'active' : 'completed'}
                onOpenLot={(id) => setLotTarget({ id })}
                onNewLot={(productId) => setLotTarget({ draft: newLot(productId, lookups) })}
                onEditProduct={openProduct}
                onAddProduct={() => openProduct()}
                csvRef={csvRef}
              />
            )}
            {screen === 'monthEnd' && (
              <MonthEnd onOpenLot={(id) => setLotTarget({ id })} csvRef={csvRef} />
            )}
            {screen === 'shipments' && (
              <Shipments onOpen={(id) => setShipmentTarget({ id })} csvRef={csvRef} />
            )}
            {screen === 'settings' && (
              <Settings
                data={data}
                run={run}
                onImport={openImport}
                onExport={exportJson}
                onReset={reset}
                onMessage={(text) => {
                  setSaveState('idle')
                  setMessage(text)
                }}
              />
            )}
          </div>
        </main>
        {lotTarget && (
          <LotDrawer
            key={'id' in lotTarget ? lotTarget.id : 'new'}
            target={lotTarget}
            onClose={() => setLotTarget(null)}
            onOpen={(id) => setLotTarget({ id })}
            onGone={() => {
              setLotTarget(null)
              setSaveState('idle')
              setMessage('This lot was deleted.')
            }}
            run={run}
          />
        )}
        {shipmentTarget && (
          <ShipmentDrawer
            key={'id' in shipmentTarget ? shipmentTarget.id : 'new'}
            target={shipmentTarget}
            onClose={() => setShipmentTarget(null)}
            onOpen={(id) => setShipmentTarget({ id })}
            onGone={() => {
              setShipmentTarget(null)
              setSaveState('idle')
              setMessage('This shipment was deleted.')
            }}
            run={run}
          />
        )}
        <Modal
          open={!!product}
          onOpenChange={(v) => {
            if (!v) closeProduct()
          }}
          title={product?.version === undefined ? 'Add product' : 'Edit product'}
        >
          {product && (
            <form onSubmit={saveProductForm} noValidate className="space-y-4">
              {productConflict && (
                <ConflictBanner
                  record="product"
                  onReload={() => {
                    setProduct(productConflict)
                    setProductBase(JSON.stringify(productConflict))
                    setProductConflict(null)
                    productForm.reset()
                  }}
                  onDismiss={() => setProductConflict(null)}
                />
              )}
              <FormError message={productForm.errors.form} />
              <Field label="Product name" required error={productForm.errors.name}>
                <Input
                  autoFocus
                  value={product.name}
                  onChange={(e) => {
                    setProduct({ ...product, name: e.target.value })
                    productForm.clear('name')
                  }}
                  placeholder="e.g. Auralite TWS Pro"
                />
              </Field>
              <Field label="Variant">
                <Input
                  value={product.variant}
                  onChange={(e) => {
                    setProduct({ ...product, variant: e.target.value })
                    productForm.clear('name')
                  }}
                  placeholder="e.g. Midnight Black"
                />
              </Field>
              <Field label="Segment" required error={productForm.errors.segment}>
                <SearchSelect
                  value={product.segment}
                  options={values(lookups, 'segment')}
                  onChange={(v) => {
                    setProduct({ ...product, segment: v })
                    productForm.clear('segment')
                  }}
                />
              </Field>
              <div className="flex items-center justify-between pt-2">
                <div>
                  {product.version !== undefined && can('deleteProducts') && (
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
                options={productChoices(products)}
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
                  setLotTarget({ draft: newLot(addLotProductId, lookups) })
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
              Choose a JSON backup exported from this app. The file is checked before any records
              are written.
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
        <ChangePassword
          open={passwordOpen}
          onClose={() => setPasswordOpen(false)}
          onDone={() => {
            setSaveState('idle')
            setMessage('Password changed.')
          }}
        />
      </div>
    </AccessContext.Provider>
  )
}
