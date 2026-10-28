import { LoadingState } from './ui'
import type { LotCards, LotFlag, LotGroup, LotSort } from '@boat/domain/api'
import { dateLabel, effectiveLotEta, quantity, signedDays } from '@boat/domain/calculations'
import type { LookupKind } from '@boat/domain/models'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns3,
  List,
  Plus,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { type MutableRefObject, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useAccess, useFeatures } from './access'
import { downloadLotsCsv, type LotQuery, lotPageSize } from './api/lots'
import type { LotRecord, ProductRecord } from './api/mappers'
import { useLookups, useLotGroups, useLots, useLotSummary, useProducts } from './api/queries'
import { Badge, Button, Card, cn, type CsvExport, Empty, Input, Pager, Select } from './ui'

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
  | 'actualDate'
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
  actualDate: 'Actual Date',
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
  leadTime: 'RM→Actual Days',
}
const defaultCols: Column[] = [
  'label',
  'status',
  'category',
  'ems',
  'stage',
  'lotQty',
  'rm',
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
  'grn',
  'plannedDate',
  'actualDate',
  'fullGrn',
  'planDelay',
  'leadTime',
]
const simpleCols: Column[] = ['label', 'status', 'stage', 'lotQty', 'grn', 'balance', 'eta']
const allCols = Object.keys(columnLabels) as Column[]
// Shown only while GRN is switched on (FEATURE_GRN).
const grnCols: Column[] = ['grn', 'balance', 'fullGrn']

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

// Signal colours: the dot on each status card, and its top edge while it filters the list.
const toneDot: Record<string, string> = {
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
  teal: 'bg-teal-500',
}
const toneBar: Record<string, string> = {
  red: 'before:bg-rose-500',
  amber: 'before:bg-amber-500',
  green: 'before:bg-emerald-500',
  blue: 'before:bg-sky-500',
  teal: 'before:bg-teal-500',
}
// Columns of numbers, right-aligned so they compare down the column.
const numericCols: Column[] = ['lotQty', 'grn', 'balance', 'rm', 'planDelay', 'leadTime']
// Only lots that need attention get a coloured edge, so the eye finds them.
const toneOf = (lot: LotRecord) => {
  const f = lot.computed.flags
  if (lot.computed.completed) return undefined
  if (f.blocked) return lot.status === 'Hold' ? 'amber' : 'red'
  if (f.overdue) return 'red'
  if (f.dueSoon) return 'amber'
  return undefined
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
      return <span className="font-semibold text-ink">{l.label}</span>
    case 'status':
      return (
        <div>
          {statuses(l)}
          <span className="mt-1 block max-w-64 min-w-48 text-xs leading-4 whitespace-normal text-muted">
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
    case 'actualDate':
      return dateLabel(l.actualDate)
    case 'grn':
      return <span className="font-semibold">{quantity(c.grnTotal)}</span>
    case 'balance':
      return <span className="font-semibold text-rose-700">{quantity(c.balance)}</span>
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
  const access = useAccess(),
    { grn } = useFeatures()
  const shown = (cols: Column[]) => (grn ? cols : cols.filter((c) => !grnCols.includes(c)))
  const lookups = useLookups().data ?? [],
    products = useProducts().data ?? []
  const [search, setSearch] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false),
    [columnsOpen, setColumnsOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>(noFilters)
  const [sort, setSort] = useState<LotSort>('eta-asc'),
    [group, setGroup] = useState(true),
    [expanded, setExpanded] = useState<string[]>([]),
    [chosen, setColumns] = useState<Column[]>(defaultCols),
    [quick, setQuick] = useState('')
  const columns = shown(chosen)
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
  const activeFilters = Object.values(filters).filter(Boolean).length
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
        <section aria-label="Lot signals">
          <div className="scroll-row gap-px overflow-hidden rounded-xl border border-line bg-line-soft shadow-[0_1px_2px_rgba(16,24,40,.04)] md:grid md:grid-cols-4 xl:grid-cols-8">
            {cards.map((card) => {
              const on = quick === card.id
              return (
                <button
                  key={card.id}
                  title={card.help}
                  aria-pressed={on}
                  onClick={() => setQuick(on ? '' : card.id)}
                  className={cn(
                    'relative flex min-w-[136px] shrink-0 flex-col bg-white px-4 pt-3.5 pb-3 text-left transition-colors md:min-w-0',
                    'before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:transition-colors',
                    on ? cn('bg-wash', toneBar[card.tone]) : 'before:bg-transparent hover:bg-wash',
                  )}
                >
                  <span className="flex items-baseline gap-2 text-[13px] leading-5 font-medium text-muted">
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 -translate-y-px rounded-full',
                        toneDot[card.tone],
                      )}
                    />
                    {card.label}
                  </span>
                  <span className="metric-value mt-auto block pt-1.5">
                    {summary ? summary[card.id] : '—'}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 hidden text-xs text-muted sm:block">
            A lot can count under more than one signal. Select one to filter the list below.
          </p>
        </section>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="section-title">
              {mode === 'active' ? 'Active production lots' : 'Completed lots'}
            </h2>
            <p className="num mt-0.5 text-[13px] text-muted">
              {total} {total === 1 ? 'lot' : 'lots'} across {groups.length}{' '}
              {groups.length === 1 ? 'product' : 'products'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setGroup(!group)
                setExpanded([])
              }}
              title={group ? 'Switch to one list of lots' : 'Group lots under their product'}
            >
              {group ? <Rows3 size={14} /> : <List size={14} />}
              {group ? 'Grouped by product' : 'Flat view'}
            </Button>
            {group && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(groups.map((g) => g.product.id))}
                  title="Expand all products"
                >
                  <ChevronsUpDown size={14} /> <span className="hidden sm:inline">Expand all</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded([])}
                  title="Collapse all products"
                >
                  <ChevronsDownUp size={14} /> <span className="hidden sm:inline">Collapse</span>
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 pt-3 pb-4 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <Input
              aria-label="Search product, variant, or lot"
              className="pl-9"
              placeholder="Search product, variant, or lot"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="scroll-row -mx-4 items-center gap-2 px-4 sm:mx-0 sm:px-0">
            <Button
              variant={filtersOpen ? 'teal' : 'secondary'}
              className="shrink-0"
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal size={15} /> Filters
              {activeFilters > 0 && (
                <span className="num rounded bg-brand px-1.5 text-xs leading-5 text-white">
                  {activeFilters}
                </span>
              )}
            </Button>
            <Button
              variant={columnsOpen ? 'teal' : 'secondary'}
              className="shrink-0"
              onClick={() => setColumnsOpen(!columnsOpen)}
              aria-expanded={columnsOpen}
            >
              <Columns3 size={15} /> Columns
            </Button>
            <Select
              aria-label="Sort lots"
              className="w-auto shrink-0"
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
            {(search || narrowing) && (
              <Button variant="ghost" className="shrink-0" onClick={clear}>
                <X size={15} /> Clear filters
              </Button>
            )}
          </div>
        </div>
        {filtersOpen && (
          <div className="grid grid-cols-2 gap-2 border-t border-line-soft bg-wash px-4 py-4 sm:grid-cols-4 sm:px-5 xl:grid-cols-5">
            {(Object.keys(filterKinds) as (keyof typeof filterKinds)[]).map((key) => (
              <Select
                key={key}
                aria-label={`Filter by ${key}`}
                className={filters[key] ? 'border-ink' : undefined}
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
            <label className="flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={filters.rm}
                onChange={(e) => setFilters({ ...filters, rm: e.target.checked })}
              />
              RM incomplete
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={filters.followUp}
                onChange={(e) => setFilters({ ...filters, followUp: e.target.checked })}
              />
              Follow-up due
            </label>
          </div>
        )}
        {columnsOpen && (
          <div className="border-t border-line-soft bg-wash px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[13px] font-medium text-muted">Show</span>
              <Button variant="secondary" size="sm" onClick={() => setColumns(simpleCols)}>
                Simple View
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setColumns(allCols)}>
                Show All Details
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {shown(allCols).map((c) => (
                <label
                  key={c}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink-2 has-[:checked]:border-ink/30 has-[:checked]:text-ink"
                >
                  <input
                    type="checkbox"
                    checked={columns.includes(c)}
                    onChange={(e) =>
                      setColumns(
                        e.target.checked ? [...columns, c] : columns.filter((x) => x !== c),
                      )
                    }
                  />
                  {columnLabels[c]}
                </label>
              ))}
            </div>
          </div>
        )}
        {groupsQuery.isPending ? (
          <LoadingState label="Loading lots" />
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
          <div className="p-5 pt-1">
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
                  ? 'A lot appears here once its actual date is entered.'
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
          <div className="border-t border-line">
            {groups.map((g) => {
              const open = expanded.includes(g.product.id)
              return (
                <div
                  key={g.product.id}
                  role="group"
                  aria-label={groupName(g)}
                  className="border-t border-line-soft first:border-t-0"
                >
                  <div
                    className={cn(
                      'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5',
                      open ? 'bg-wash' : 'hover:bg-wash/70',
                    )}
                  >
                    <button
                      className="flex min-w-0 flex-1 basis-56 items-start gap-2.5 text-left"
                      onClick={() =>
                        setExpanded(
                          open
                            ? expanded.filter((x) => x !== g.product.id)
                            : [...expanded, g.product.id],
                        )
                      }
                      aria-expanded={open}
                    >
                      <ChevronRight
                        size={18}
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 shrink-0 text-faint transition-transform',
                          open && 'rotate-90 text-ink',
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-ink">
                          {g.product.name}
                          {g.product.variant && (
                            <span className="font-normal text-muted"> · {g.product.variant}</span>
                          )}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                          <span className="num">
                            {g.product.segment.value} · {g.lots} {g.lots === 1 ? 'lot' : 'lots'}
                          </span>
                          {mode === 'active' && g.delayed > 0 && (
                            <Badge tone="red">{g.delayed} delayed</Badge>
                          )}
                        </span>
                      </span>
                    </button>
                    <div className="ml-auto flex items-center gap-1 pl-7 sm:pl-0">
                      <span className="num mr-2 text-[13px] text-muted" title="Total lot quantity">
                        Qty <b className="font-semibold text-ink">{quantity(g.lotQty)}</b>
                      </span>
                      {grn && (
                        <>
                          <span className="num mr-2 text-[13px] text-muted" title="Total GRN">
                            GRN <b className="font-semibold text-ink">{quantity(g.grnTotal)}</b>
                          </span>
                          <span
                            className="num mr-2 text-[13px] text-muted"
                            title="Remaining balance"
                          >
                            Balance{' '}
                            <b className="font-semibold text-rose-700">{quantity(g.balance)}</b>
                          </span>
                        </>
                      )}
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
                      <p className="px-5 pb-4 pl-12 text-[13px] text-muted">
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
              <div className="border-t border-line">
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
              </div>
            )}
            {emptyProducts.length > 0 && (
              <div className="border-t border-line-soft px-4 py-4 sm:px-5">
                <h3 className="mb-3 text-[13px] font-semibold text-muted">
                  Products without active lots
                </h3>
                <div className="space-y-2">
                  {emptyProducts.map((g) => (
                    <div
                      key={g.product.id}
                      role="group"
                      aria-label={groupName(g)}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <b className="text-sm font-semibold text-ink">{g.product.name}</b>
                        <span className="ml-2 text-[13px] text-muted">
                          {[g.product.variant, g.product.segment.value].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex gap-1">{productButtons(g)}</div>
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
  if (!lots.data) return <p className="px-5 py-3 text-[13px] text-muted">Loading lots…</p>
  return (
    <>
      <LotTable lots={lots.data.items} columns={columns} onOpenLot={onOpenLot} />
      {lots.data.total > lots.data.items.length && (
        <p className="px-5 pb-4 text-[13px] text-muted">
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
  const { grn } = useFeatures()
  return (
    <>
      <div className="table-wrap hidden border-t border-line-soft md:block">
        <table className="data-table">
          <thead>
            <tr>
              {showProduct && <th>Product</th>}
              {columns.map((c) => (
                <th key={c} className={numericCols.includes(c) ? 'cell-num' : undefined}>
                  {columnLabels[c]}
                </th>
              ))}
              <th aria-label="Open" className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id} data-clickable data-tone={toneOf(l)} onClick={() => onOpenLot(l.id)}>
                {showProduct && <td className="font-medium text-ink">{l.product.name}</td>}
                {columns.map((c) => (
                  <td key={c} className={numericCols.includes(c) ? 'cell-num num' : undefined}>
                    {renderCell(l, c)}
                  </td>
                ))}
                <td className="text-faint">
                  <ChevronRight size={15} aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-line-soft border-t border-line-soft md:hidden">
        {lots.map((l) => {
          const c = l.computed
          return (
            <button
              key={l.id}
              data-tone={toneOf(l)}
              onClick={() => onOpenLot(l.id)}
              className="tone-edge block w-full px-4 py-3.5 text-left active:bg-wash"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{l.label}</span>
                  {showProduct && (
                    <span className="block truncate text-[13px] text-muted">{l.product.name}</span>
                  )}
                </span>
                {statuses(l)}
              </div>
              <p className="mt-1 text-[13px] leading-snug text-muted">{c.summary}</p>
              <dl className="num mt-3 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-xs text-muted">Qty</dt>
                  <dd className="text-sm font-semibold text-ink">{quantity(l.lotQty)}</dd>
                </div>
                {grn ? (
                  <div>
                    <dt className="text-xs text-muted">Balance</dt>
                    <dd className="text-sm font-semibold text-ink">{quantity(c.balance)}</dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-xs text-muted">RM ready</dt>
                    <dd className="text-sm font-semibold text-ink">{Math.round(c.rm.percent)}%</dd>
                  </div>
                )}
                {c.completed ? (
                  <div>
                    <dt className="text-xs text-muted">Completed</dt>
                    <dd className="text-sm font-semibold text-ink">{dateLabel(l.actualDate)}</dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-xs text-muted">ETA</dt>
                    <dd
                      className={cn(
                        'text-sm font-semibold',
                        c.flags.overdue ? 'text-rose-700' : 'text-ink',
                      )}
                    >
                      {dateLabel(effectiveLotEta(l))}
                    </dd>
                  </div>
                )}
              </dl>
              {c.completed ? (
                <p className="mt-2 text-[13px] text-muted">
                  {signedDays(c.planDelay)} vs plan · RM→actual {c.leadTime ?? '—'} days
                </p>
              ) : (
                <div className="mt-3 flex items-center gap-3">
                  <span className="truncate text-[13px] text-muted">{l.stage}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-line-soft">
                    <span
                      className="block h-full rounded-full bg-ink/60"
                      style={{ width: `${grn ? c.grnPercent : c.rm.percent}%` }}
                    />
                  </span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
