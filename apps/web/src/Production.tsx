import type { LotCards, LotFlag, LotGroup, LotSort } from '@boat/domain/api'
import { dateLabel, effectiveLotEta, quantity, signedDays } from '@boat/domain/calculations'
import type { LookupKind } from '@boat/domain/models'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns3,
  Filter,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { type MutableRefObject, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useAccess } from './access'
import { downloadLotsCsv, type LotQuery, lotPageSize } from './api/lots'
import type { LotRecord, ProductRecord } from './api/mappers'
import { useLookups, useLotGroups, useLots, useLotSummary, useProducts } from './api/queries'
import { Badge, Button, Card, type CsvExport, Empty, Input, Pager, Select } from './ui'

type Props = {
  mode: 'active' | 'completed'
  onOpenLot: (id: string) => void
  onNewLot: (productId: string) => void
  onEditProduct: (product: ProductRecord) => void
  onAddProduct: () => void
  csvRef: MutableRefObject<CsvExport | null>
}
type Column =
  | 'label'
  | 'status'
  | 'category'
  | 'ems'
  | 'stage'
  | 'lotQty'
  | 'produced'
  | 'grn'
  | 'balance'
  | 'plannedDate'
  | 'eta'
  | 'blocker'
  | 'poc'
  | 'mode'
  | 'rm'
  | 'followUp'
  | 'fullGrn'
  | 'planDelay'
  | 'leadTime'
const columnLabels: Record<Column, string> = {
  label: 'Lot',
  status: 'Status',
  category: 'Category',
  ems: 'EMS',
  stage: 'Stage',
  lotQty: 'Lot Qty',
  produced: 'Produced',
  grn: 'GRN',
  balance: 'Balance',
  plannedDate: 'Planned Date',
  eta: 'Current ETA',
  blocker: 'Blocker',
  poc: 'POC',
  mode: 'Mode',
  rm: 'RM Ready',
  followUp: 'Follow-up',
  fullGrn: 'Full GRN Date',
  planDelay: 'Vs Plan',
  leadTime: 'RM→GRN Days',
}
const defaultCols: Column[] = [
  'label',
  'status',
  'category',
  'ems',
  'stage',
  'lotQty',
  'produced',
  'grn',
  'balance',
  'plannedDate',
  'eta',
  'blocker',
]
const completedCols: Column[] = [
  'label',
  'category',
  'ems',
  'lotQty',
  'produced',
  'grn',
  'plannedDate',
  'fullGrn',
  'planDelay',
  'leadTime',
]
const simpleCols: Column[] = ['label', 'status', 'stage', 'lotQty', 'grn', 'balance', 'eta']
const allCols = Object.keys(columnLabels) as Column[]

// Dropdown filters hold lookup ids; the API filters by id.
type Filters = {
  segment: string
  category: string
  ems: string
  poc: string
  status: string
  stage: string
  mode: string
  blocker: string
  rm: boolean
  followUp: boolean
}
const noFilters: Filters = {
  segment: '',
  category: '',
  ems: '',
  poc: '',
  status: '',
  stage: '',
  mode: '',
  blocker: '',
  rm: false,
  followUp: false,
}
const filterKinds: Record<Exclude<keyof Filters, 'rm' | 'followUp'>, LookupKind> = {
  segment: 'segment',
  category: 'category',
  ems: 'ems',
  poc: 'poc',
  status: 'status',
  stage: 'stage',
  mode: 'logistics',
  blocker: 'blocker',
}
const filterPlaceholders: Record<keyof typeof filterKinds, string> = {
  segment: 'All segments',
  category: 'All categories',
  ems: 'All EMS',
  poc: 'All POCs',
  status: 'All statuses',
  stage: 'All stages',
  mode: 'All modes',
  blocker: 'All blockers',
}
const cards: { id: keyof LotCards; label: string; help: string; tone: string }[] = [
  {
    id: 'overdue',
    label: 'Overdue',
    help: 'Incomplete lots with effective ETA before today.',
    tone: 'red',
  },
  {
    id: 'dueSoon',
    label: 'Due Soon',
    help: 'Incomplete lots due today through the next 3 days.',
    tone: 'amber',
  },
  {
    id: 'onTrack',
    label: 'On Track',
    help: 'Status On Track, not overdue, due soon, or blocked.',
    tone: 'green',
  },
  {
    id: 'blocked',
    label: 'Delayed / Blocked',
    help: 'Delayed or Hold status, or an active blocker.',
    tone: 'red',
  },
  {
    id: 'approval',
    label: 'Approval',
    help: 'Incomplete lots with an Approval Blocker.',
    tone: 'amber',
  },
  {
    id: 'followUp',
    label: 'Follow-ups',
    help: 'Incomplete lots with follow-up date on or before today.',
    tone: 'blue',
  },
  {
    id: 'rm',
    label: 'RM Incomplete',
    help: 'Incomplete lots whose material target has not been fully met.',
    tone: 'amber',
  },
  { id: 'npi', label: 'NPI', help: 'Incomplete lots in a non-BAU product category.', tone: 'teal' },
]

function toQuery(
  view: LotQuery['view'],
  q: string,
  f: Filters,
  quick: string,
  sort: LotSort,
): LotQuery {
  const flag = new Set<LotFlag>()
  if (f.rm) flag.add('rm')
  if (f.followUp) flag.add('followUp')
  if (quick) flag.add(quick as LotFlag)
  return {
    view,
    q: q.trim(),
    segmentId: f.segment || undefined,
    categoryId: f.category || undefined,
    emsId: f.ems || undefined,
    pocId: f.poc || undefined,
    statusId: f.status || undefined,
    stageId: f.stage || undefined,
    logisticsId: f.mode || undefined,
    blockerId: f.blocker || undefined,
    flag: [...flag],
    sort,
  }
}

// Waits for typing to pause before searching, so each keystroke isn't a request.
function useDebounced<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

const statuses = (lot: LotRecord) => {
  const f = lot.computed.flags
  if (lot.computed.completed) return <Badge tone="green">Completed</Badge>
  if (f.blocked)
    return (
      <Badge tone={lot.status === 'Hold' ? 'amber' : 'red'}>
        {lot.status === 'On Track' ? 'Blocked' : lot.status}
      </Badge>
    )
  if (f.overdue) return <Badge tone="red">Overdue</Badge>
  if (f.dueSoon) return <Badge tone="amber">Due soon</Badge>
  return <Badge tone="green">On track</Badge>
}

function renderCell(l: LotRecord, col: Column): ReactNode {
  const c = l.computed
  switch (col) {
    case 'label':
      return <span className="font-bold text-[#193e40]">{l.label}</span>
    case 'status':
      return (
        <div>
          {statuses(l)}
          <span className="mt-1 block min-w-48 max-w-64 whitespace-normal text-[11px] leading-4 text-slate-500">
            {c.summary}
          </span>
        </div>
      )
    case 'category':
      return <Badge tone={l.category === 'BAU' ? 'slate' : 'blue'}>{l.category}</Badge>
    case 'ems':
      return l.ems || '—'
    case 'stage':
      return l.stage
    case 'lotQty':
      return quantity(l.lotQty)
    case 'produced':
      return quantity(l.freshProductionQty)
    case 'grn':
      return <span className="font-semibold">{quantity(c.grnTotal)}</span>
    case 'balance':
      return <span className="font-bold text-[#bd5e2d]">{quantity(c.balance)}</span>
    case 'plannedDate':
      return dateLabel(l.plannedDate)
    case 'eta':
      return (
        <span className={c.flags.overdue ? 'font-semibold text-rose-700' : ''}>
          {dateLabel(effectiveLotEta(l))}
        </span>
      )
    case 'blocker':
      return !l.blockerCategory || l.blockerCategory === 'None' ? (
        '—'
      ) : (
        <span className="max-w-32 truncate" title={l.blockerDescription}>
          {l.blockerCategory}
        </span>
      )
    case 'poc':
      return l.poc || '—'
    case 'mode':
      return l.logisticsMode || '—'
    case 'rm':
      return `${Math.round(c.rm.percent)}%`
    case 'followUp':
      return dateLabel(l.followUpDate)
    case 'fullGrn':
      return dateLabel(c.fullGrnDate ?? '')
    case 'planDelay':
      return (
        <span className={c.planDelay && c.planDelay > 0 ? 'font-semibold text-rose-700' : ''}>
          {signedDays(c.planDelay)}
        </span>
      )
    case 'leadTime':
      return c.leadTime ?? '—'
  }
}

export default function Production({
  mode,
  onOpenLot,
  onNewLot,
  onEditProduct,
  onAddProduct,
  csvRef,
}: Props) {
  const access = useAccess()
  const lookups = useLookups().data ?? [],
    products = useProducts().data ?? []
  const [search, setSearch] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false),
    [columnsOpen, setColumnsOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>(noFilters)
  const [sort, setSort] = useState<LotSort>('eta-asc'),
    [group, setGroup] = useState(true),
    [expanded, setExpanded] = useState<string[]>([]),
    [columns, setColumns] = useState<Column[]>(defaultCols),
    [quick, setQuick] = useState('')
  const term = useDebounced(search)
  const query = useMemo(
    () => toQuery(mode, term, filters, quick, sort),
    [mode, term, filters, quick, sort],
  )
  // The page belongs to one query: a new filter or sort starts again from page 1, so the list
  // never opens on an empty later page.
  const queryKey = JSON.stringify(query)
  const [paging, setPaging] = useState({ key: queryKey, page: 1 })
  const page = paging.key === queryKey ? paging.page : 1
  const groupsQuery = useLotGroups(query)
  const groups = groupsQuery.data ?? []
  const flat = useLots(query, page, lotPageSize, !group)
  // Deleting the last row of a later page moves back to the new last page.
  const lastPage = Math.max(1, Math.ceil((flat.data?.total ?? 0) / lotPageSize))
  useEffect(() => {
    if (flat.data && page > lastPage) setPaging({ key: queryKey, page: lastPage })
  }, [flat.data, page, lastPage, queryKey])
  const summary = useLotSummary().data
  const withLots = groups.filter((g) => g.lots > 0),
    emptyProducts = groups.filter((g) => g.lots === 0),
    total = withLots.reduce((n, g) => n + g.lots, 0)
  const record = (id: string) => products.find((p) => p.id === id)
  const look = (kind: LookupKind) =>
    lookups.filter((v) => v.kind === kind).sort((a, b) => a.sort - b.sort)
  csvRef.current = async () => {
    if (!total) return false
    await downloadLotsCsv(query)
    return true
  }
  const clear = () => {
    setSearch('')
    setFilters(noFilters)
    setQuick('')
  }
  useEffect(() => {
    setExpanded([])
    setQuick('')
    setColumns(mode === 'completed' ? completedCols : defaultCols)
  }, [mode])
  // Searching or filtering expands the matching products so their lots are visible at once.
  const narrowing = !!term.trim() || !!quick || Object.values(filters).some(Boolean)
  const matchingProducts = withLots.map((g) => g.product.id).join(',')
  useEffect(() => {
    if (narrowing) setExpanded(matchingProducts ? matchingProducts.split(',') : [])
  }, [narrowing, matchingProducts])
  const productButtons = (g: LotGroup) => {
    const product = record(g.product.id)
    return (
      <>
        {product && access.can('editProducts') && (
          <Button variant="ghost" size="sm" onClick={() => onEditProduct(product)}>
            Edit
          </Button>
        )}
        {mode === 'active' && access.can('createLots') && (
          <Button variant="secondary" size="sm" onClick={() => onNewLot(g.product.id)}>
            <Plus size={14} /> Add lot
          </Button>
        )}
      </>
    )
  }
  const groupName = (g: LotGroup) =>
    `${g.product.name}${g.product.variant ? ` ${g.product.variant}` : ''}`
  return (
    <div className="space-y-5">
      {mode === 'active' && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {cards.map((card) => (
              <button
                key={card.id}
                title={card.help}
                onClick={() => setQuick(quick === card.id ? '' : card.id)}
                className={`rounded-2xl border bg-white p-4 text-left shadow-[0_2px_14px_rgba(15,23,42,.035)] transition hover:border-orange-300 ${quick === card.id ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="metric-label">{card.label}</span>
                  <span
                    className={`icon-dot ${card.tone === 'red' ? 'text-rose-500' : card.tone === 'amber' ? 'text-amber-500' : card.tone === 'green' ? 'text-emerald-500' : card.tone === 'blue' ? 'text-sky-500' : 'text-teal-500'}`}
                  />
                </div>
                <div className="mt-2 metric-value">{summary ? summary[card.id] : '—'}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Cards describe overlapping conditions; their counts are not intended to add up to the
            total number of lots. Hover for definitions.
          </p>
        </>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-[#173b3d]">
              {mode === 'active' ? 'Active production lots' : 'Completed lots'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {total} lots across {groups.length} products · Completion is based on full GRN
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setGroup(!group)
                setExpanded([])
              }}
            >
              {group ? 'Grouped by product' : 'Flat view'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded(groups.map((g) => g.product.id))}
              title="Expand all products"
            >
              <ChevronsUpDown size={14} /> Expand all
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded([])}
              title="Collapse all products"
            >
              <ChevronsDownUp size={14} /> Collapse
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <div className="relative min-w-52 flex-1 sm:max-w-sm">
            <Search size={15} className="absolute left-3 top-3 text-slate-400" />
            <Input
              aria-label="Search product, variant, or lot"
              className="pl-9"
              placeholder="Search product, variant, or lot..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setFiltersOpen(!filtersOpen)}>
            <Filter size={14} /> Filters{' '}
            {Object.values(filters).filter(Boolean).length > 0 && (
              <Badge tone="amber">{Object.values(filters).filter(Boolean).length}</Badge>
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setColumnsOpen(!columnsOpen)}>
            <Columns3 size={14} /> Columns
          </Button>
          <Select
            aria-label="Sort lots"
            className="max-w-40"
            value={sort}
            onChange={(e) => setSort(e.target.value as LotSort)}
          >
            <option value="eta-asc">ETA: soonest</option>
            <option value="eta-desc">ETA: latest</option>
            <option value="qty-desc">Qty: high to low</option>
            <option value="balance-desc">Balance: high to low</option>
            <option value="product-asc">Product: A–Z</option>
            <option value="label-asc">Lot: A–Z</option>
          </Select>
          <Button variant="ghost" size="sm" onClick={clear}>
            <X size={14} /> Clear filters
          </Button>
        </div>
        {filtersOpen && (
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-4 sm:grid-cols-4 xl:grid-cols-8 sm:px-5">
            {(Object.keys(filterKinds) as (keyof typeof filterKinds)[]).map((key) => (
              <Select
                key={key}
                aria-label={`Filter by ${key}`}
                value={filters[key]}
                onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
              >
                <option value="">{filterPlaceholders[key]}</option>
                {look(filterKinds[key]).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.value}
                  </option>
                ))}
              </Select>
            ))}
            <label className="col-span-1 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={filters.rm}
                onChange={(e) => setFilters({ ...filters, rm: e.target.checked })}
              />{' '}
              RM incomplete
            </label>
            <label className="col-span-1 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={filters.followUp}
                onChange={(e) => setFilters({ ...filters, followUp: e.target.checked })}
              />{' '}
              Follow-up due
            </label>
          </div>
        )}
        {columnsOpen && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 sm:px-5">
            <Button variant="ghost" size="sm" onClick={() => setColumns(simpleCols)}>
              Simple View
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setColumns(allCols)}>
              Show All Details
            </Button>
            {allCols.map((c) => (
              <label key={c} className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={columns.includes(c)}
                  onChange={(e) =>
                    setColumns(e.target.checked ? [...columns, c] : columns.filter((x) => x !== c))
                  }
                />
                {columnLabels[c]}
              </label>
            ))}
          </div>
        )}
        {groupsQuery.isPending ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Loading lots…</p>
        ) : groupsQuery.isError ? (
          <div className="p-5">
            <Empty
              title="Couldn't load lots"
              description={groupsQuery.error.message}
              action={
                <Button variant="secondary" onClick={() => groupsQuery.refetch()}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : !groups.length ? (
          <div className="p-5">
            <Empty
              title={
                mode === 'completed'
                  ? 'No completed lots yet'
                  : products.length
                    ? 'No matching lots'
                    : 'No products yet'
              }
              description={
                mode === 'completed'
                  ? 'A lot appears here when its GRN receipts equal its positive lot quantity.'
                  : products.length
                    ? 'Try clearing filters or add a lot to a product.'
                    : access.can('editProducts')
                      ? 'Add your first product, then add production lots to it.'
                      : 'An admin or planner adds products and lots.'
              }
              action={
                mode === 'active' && (search || quick || Object.values(filters).some(Boolean)) ? (
                  <Button variant="secondary" onClick={clear}>
                    Clear filters
                  </Button>
                ) : mode === 'active' && !products.length && access.can('editProducts') ? (
                  <Button onClick={onAddProduct}>
                    <Plus size={16} /> Add Product
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : group ? (
          <div>
            {groups.map((g) => {
              const open = expanded.includes(g.product.id)
              return (
                <div
                  key={g.product.id}
                  role="group"
                  aria-label={groupName(g)}
                  className="border-t border-slate-100 first:border-t-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-slate-50/60 sm:px-5">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() =>
                        setExpanded(
                          open
                            ? expanded.filter((x) => x !== g.product.id)
                            : [...expanded, g.product.id],
                        )
                      }
                      aria-expanded={open}
                    >
                      {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-sm font-extrabold text-teal-700">
                        {g.product.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[#173b3d]">
                          {g.product.name}{' '}
                          {g.product.variant && (
                            <span className="font-normal text-slate-500">
                              · {g.product.variant}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-slate-500">
                          {g.product.segment.value} · {g.lots} lots ·{' '}
                          {mode === 'active' ? `${g.delayed} delayed` : 'completed'}
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span title="Total lot quantity">
                        Qty <b>{quantity(g.lotQty)}</b>
                      </span>
                      <span title="Fresh production quantity">
                        Produced <b>{quantity(g.produced)}</b>
                      </span>
                      <span title="Total GRN">
                        GRN <b>{quantity(g.grnTotal)}</b>
                      </span>
                      <span title="Remaining balance">
                        Balance <b className="text-[#c46736]">{quantity(g.balance)}</b>
                      </span>
                      {productButtons(g)}
                    </div>
                  </div>
                  {open &&
                    (g.lots ? (
                      <ProductLots
                        productId={g.product.id}
                        query={query}
                        columns={columns}
                        onOpenLot={onOpenLot}
                      />
                    ) : (
                      <p className="px-5 pb-4 text-xs text-slate-500">
                        No active lots yet.
                        {access.can('createLots') && ' Use Add lot to start tracking this product.'}
                      </p>
                    ))}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {flat.data && flat.data.items.length > 0 && (
              <>
                <LotTable
                  lots={flat.data.items}
                  columns={columns}
                  onOpenLot={onOpenLot}
                  showProduct
                />
                <Pager
                  page={page}
                  pageSize={lotPageSize}
                  total={flat.data.total}
                  onPage={(next) => setPaging({ key: queryKey, page: next })}
                />
              </>
            )}
            {emptyProducts.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Products without active lots
                </h3>
                <div className="space-y-2">
                  {emptyProducts.map((g) => (
                    <div
                      key={g.product.id}
                      role="group"
                      aria-label={groupName(g)}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    >
                      <div>
                        <b className="text-sm text-[#173b3d]">{g.product.name}</b>
                        <span className="ml-2 text-xs text-slate-500">
                          {[g.product.variant, g.product.segment.value].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex gap-2">{productButtons(g)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

// One product's matching lots in the grouped view. More than 200 is rare; the flat view pages.
function ProductLots({
  productId,
  query,
  columns,
  onOpenLot,
}: {
  productId: string
  query: LotQuery
  columns: Column[]
  onOpenLot: (id: string) => void
}) {
  const lots = useLots({ ...query, productId }, 1, 200)
  if (!lots.data) return <p className="px-5 pb-4 text-xs text-slate-500">Loading lots…</p>
  return (
    <>
      <LotTable lots={lots.data.items} columns={columns} onOpenLot={onOpenLot} />
      {lots.data.total > lots.data.items.length && (
        <p className="px-5 pb-4 text-xs text-slate-500">
          Showing {lots.data.items.length} of {lots.data.total} lots. Use the flat view or filters
          to see the rest.
        </p>
      )}
    </>
  )
}

function LotTable({
  lots,
  columns,
  onOpenLot,
  showProduct = false,
}: {
  lots: LotRecord[]
  columns: Column[]
  onOpenLot: (id: string) => void
  showProduct?: boolean
}) {
  return (
    <>
      <div className="table-wrap hidden md:block">
        <table className="data-table">
          <thead>
            <tr>
              {showProduct && <th>Product</th>}
              {columns.map((c) => (
                <th key={c}>{columnLabels[c]}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id} className="cursor-pointer" onClick={() => onOpenLot(l.id)}>
                {showProduct && <td className="font-semibold">{l.product.name}</td>}
                {columns.map((c) => (
                  <td key={c}>{renderCell(l, c)}</td>
                ))}
                <td>
                  <ChevronRight size={14} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-100 md:hidden">
        {lots.map((l) => (
          <button key={l.id} onClick={() => onOpenLot(l.id)} className="w-full p-4 text-left">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#173b3d]">{l.label}</span>
              {statuses(l)}
            </div>
            <div className="mt-1 text-xs text-slate-500">{l.computed.summary}</div>
            {showProduct && <div className="mt-1 text-xs text-slate-500">{l.product.name}</div>}
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <span>
                Qty <b>{quantity(l.lotQty)}</b>
              </span>
              <span>
                GRN <b>{quantity(l.computed.grnTotal)}</b>
              </span>
              <span>
                Balance <b>{quantity(l.computed.balance)}</b>
              </span>
            </div>
            {l.computed.completed ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-500">
                <span>Full GRN {dateLabel(l.computed.fullGrnDate ?? '')}</span>
                <span>
                  {signedDays(l.computed.planDelay)} vs plan · RM→GRN {l.computed.leadTime ?? '—'}{' '}
                  days
                </span>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{l.stage}</span>
                <span>ETA {dateLabel(effectiveLotEta(l))}</span>
              </div>
            )}
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-[#d96d35]" style={{ width: `${l.computed.grnPercent}%` }} />
            </div>
          </button>
        ))}
      </div>
    </>
  )
}
