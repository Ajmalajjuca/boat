import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
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
import type { DataSet, Lot, Product } from './models'
import {
  balance,
  completed,
  dateLabel,
  effectiveLotEta,
  grnProgress,
  lotFlags,
  quantity,
  rmMetrics,
  sum,
  today,
  totalGrn,
} from './calculations'
import { downloadFile, toCsv } from './repository'
import { Badge, Button, Card, Empty, Input, Select } from './ui'

type Props = {
  data: DataSet
  mode: 'active' | 'completed'
  onOpenLot: (lot: Lot) => void
  onNewLot: (productId: string) => void
  onEditProduct: (product: Product) => void
  csvRef: MutableRefObject<(() => void) | null>
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
const simpleCols: Column[] = ['label', 'status', 'stage', 'lotQty', 'grn', 'balance', 'eta']
const allCols = Object.keys(columnLabels) as Column[]
const statuses = (lot: Lot, receipts: DataSet['grnReceipts']) => {
  const f = lotFlags(lot, receipts)
  if (f.done) return <Badge tone="green">Completed</Badge>
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

export default function Production({
  data,
  mode,
  onOpenLot,
  onNewLot,
  onEditProduct,
  csvRef,
}: Props) {
  const [search, setSearch] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false),
    [columnsOpen, setColumnsOpen] = useState(false)
  const [filters, setFilters] = useState({
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
  })
  const [sort, setSort] = useState('eta-asc'),
    [group, setGroup] = useState(true),
    [expanded, setExpanded] = useState<string[]>([]),
    [columns, setColumns] = useState<Column[]>(defaultCols),
    [quick, setQuick] = useState('')
  const look = (kind: string) =>
    data.lookupValues
      .filter((v) => v.kind === kind)
      .sort((a, b) => a.sort - b.sort)
      .map((v) => v.value)
  const receiptsFor = (id: string) => data.grnReceipts.filter((r) => r.lotId === id)
  const lots = useMemo(() => {
    const term = search.toLowerCase().trim()
    const filtered = data.lots.filter((l) => {
      const product = data.products.find((p) => p.id === l.productId),
        receipts = receiptsFor(l.id),
        f = lotFlags(l, receipts),
        rm = rmMetrics(
          l,
          data.rmBatches.filter((b) => b.lotId === l.id),
        )
      if (mode === 'completed' ? !f.done : f.done) return false
      if (
        term &&
        !`${product?.name || ''} ${product?.variant || ''} ${l.label}`.toLowerCase().includes(term)
      )
        return false
      if (
        (filters.segment && product?.segment !== filters.segment) ||
        (filters.category && l.category !== filters.category) ||
        (filters.ems && l.ems !== filters.ems) ||
        (filters.poc && l.poc !== filters.poc) ||
        (filters.status && l.status !== filters.status) ||
        (filters.stage && l.stage !== filters.stage) ||
        (filters.mode && l.logisticsMode !== filters.mode) ||
        (filters.blocker && l.blockerCategory !== filters.blocker)
      )
        return false
      if ((filters.rm && rm.complete) || (filters.followUp && !f.followUp)) return false
      if (
        (quick === 'overdue' && !f.overdue) ||
        (quick === 'dueSoon' && !f.dueSoon) ||
        (quick === 'blocked' && !f.blocked) ||
        (quick === 'approval' && !f.approval) ||
        (quick === 'followUp' && !f.followUp) ||
        (quick === 'rm' && rm.complete) ||
        (quick === 'npi' && l.category === 'BAU') ||
        (quick === 'onTrack' && (f.overdue || f.dueSoon || f.blocked || l.status !== 'On Track'))
      )
        return false
      return true
    })
    return filtered.sort((a, b) => {
      const [field, dir] = sort.split('-'),
        sgn = dir === 'desc' ? -1 : 1
      let av: string | number = '',
        bv: string | number = ''
      if (field === 'eta') {
        av = effectiveLotEta(a) || '9999'
        bv = effectiveLotEta(b) || '9999'
      } else if (field === 'qty') {
        av = a.lotQty
        bv = b.lotQty
      } else if (field === 'balance') {
        av = balance(a, receiptsFor(a.id))
        bv = balance(b, receiptsFor(b.id))
      } else if (field === 'product') {
        av = data.products.find((p) => p.id === a.productId)?.name || ''
        bv = data.products.find((p) => p.id === b.productId)?.name || ''
      } else {
        av = a.label
        bv = b.label
      }
      return av < bv ? -sgn : av > bv ? sgn : 0
    })
  }, [data, mode, search, filters, sort, quick])
  const active = data.lots.filter((l) => !completed(l, receiptsFor(l.id)))
  const count = (p: (l: Lot) => boolean) => active.filter(p).length
  const cards = [
    {
      id: 'overdue',
      label: 'Overdue',
      value: count((l) => lotFlags(l, receiptsFor(l.id)).overdue),
      help: 'Incomplete lots with effective ETA before today.',
      tone: 'red',
    },
    {
      id: 'dueSoon',
      label: 'Due Soon',
      value: count((l) => lotFlags(l, receiptsFor(l.id)).dueSoon),
      help: 'Incomplete lots due today through the next 3 days.',
      tone: 'amber',
    },
    {
      id: 'onTrack',
      label: 'On Track',
      value: count((l) => {
        const f = lotFlags(l, receiptsFor(l.id))
        return l.status === 'On Track' && !f.blocked && !f.overdue && !f.dueSoon
      }),
      help: 'Status On Track, not overdue, due soon, or blocked.',
      tone: 'green',
    },
    {
      id: 'blocked',
      label: 'Delayed / Blocked',
      value: count((l) => lotFlags(l, receiptsFor(l.id)).blocked),
      help: 'Delayed or Hold status, or an active blocker.',
      tone: 'red',
    },
    {
      id: 'approval',
      label: 'Approval',
      value: count((l) => lotFlags(l, receiptsFor(l.id)).approval),
      help: 'Incomplete lots with an Approval Blocker.',
      tone: 'amber',
    },
    {
      id: 'followUp',
      label: 'Follow-ups',
      value: count((l) => lotFlags(l, receiptsFor(l.id)).followUp),
      help: 'Incomplete lots with follow-up date on or before today.',
      tone: 'blue',
    },
    {
      id: 'rm',
      label: 'RM Incomplete',
      value: count(
        (l) =>
          !rmMetrics(
            l,
            data.rmBatches.filter((b) => b.lotId === l.id),
          ).complete,
      ),
      help: 'Incomplete lots whose material target has not been fully met.',
      tone: 'amber',
    },
    {
      id: 'npi',
      label: 'NPI',
      value: count((l) => l.category !== 'BAU'),
      help: 'Incomplete lots in a non-BAU product category.',
      tone: 'teal',
    },
  ]
  const emptyProducts =
    mode === 'active' &&
    !quick &&
    !Object.entries(filters).some(([key, value]) => key !== 'segment' && Boolean(value))
      ? data.products.filter(
          (p) =>
            !active.some((l) => l.productId === p.id) &&
            (!filters.segment || p.segment === filters.segment) &&
            `${p.name} ${p.variant}`.toLowerCase().includes(search.toLowerCase().trim()),
        )
      : []
  const productOrder = data.products
    .filter(
      (p) => lots.some((l) => l.productId === p.id) || emptyProducts.some((e) => e.id === p.id),
    )
    .sort((a, b) => {
      const ai = lots.findIndex((l) => l.productId === a.id),
        bi = lots.findIndex((l) => l.productId === b.id)
      return ai < 0 && bi < 0 ? a.name.localeCompare(b.name) : ai < 0 ? 1 : bi < 0 ? -1 : ai - bi
    })
  const renderCell = (l: Lot, col: Column) => {
    const rs = receiptsFor(l.id)
    switch (col) {
      case 'label':
        return <span className="font-bold text-[#193e40]">{l.label}</span>
      case 'status':
        return statuses(l, rs)
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
        return <span className="font-semibold">{quantity(totalGrn(rs))}</span>
      case 'balance':
        return <span className="font-bold text-[#bd5e2d]">{quantity(balance(l, rs))}</span>
      case 'plannedDate':
        return dateLabel(l.plannedDate)
      case 'eta':
        return (
          <span className={lotFlags(l, rs).overdue ? 'font-semibold text-rose-700' : ''}>
            {dateLabel(effectiveLotEta(l))}
          </span>
        )
      case 'blocker':
        return l.blockerCategory === 'None' ? (
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
        return `${Math.round(
          rmMetrics(
            l,
            data.rmBatches.filter((b) => b.lotId === l.id),
          ).percent,
        )}%`
      case 'followUp':
        return dateLabel(l.followUpDate)
    }
  }
  const csv = () => {
    const rows = lots.map((l) => {
      const p = data.products.find((p) => p.id === l.productId),
        rs = receiptsFor(l.id)
      return {
        Product: p?.name || '',
        Variant: p?.variant || '',
        Segment: p?.segment || '',
        Lot: l.label,
        Status: l.status,
        Category: l.category,
        EMS: l.ems,
        POC: l.poc,
        Stage: l.stage,
        Mode: l.logisticsMode,
        LotQty: l.lotQty,
        Produced: l.freshProductionQty,
        Rework: l.reworkQty,
        GRN: totalGrn(rs),
        Balance: balance(l, rs),
        RMReadyPercent: Math.round(
          rmMetrics(
            l,
            data.rmBatches.filter((b) => b.lotId === l.id),
          ).percent,
        ),
        PlannedDate: l.plannedDate,
        CurrentETA: effectiveLotEta(l),
        Blocker: l.blockerCategory,
        FollowUp: l.followUpDate,
      }
    })
    downloadFile(`${mode}-lots-${today()}.csv`, toCsv(rows), 'text/csv;charset=utf-8')
  }
  csvRef.current = csv
  const clear = () => {
    setSearch('')
    setFilters({
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
    })
    setQuick('')
  }
  useEffect(() => {
    setExpanded([])
    setQuick('')
  }, [mode])
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
                <div className="mt-2 metric-value">{card.value}</div>
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
              {lots.length} lots across {productOrder.length} products · Completion is based on full
              GRN
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
              onClick={() => setExpanded(productOrder.map((p) => p.id))}
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
            onChange={(e) => setSort(e.target.value)}
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
            {(
              ['segment', 'category', 'ems', 'poc', 'status', 'stage', 'mode', 'blocker'] as const
            ).map((kind) => (
              <Select
                key={kind}
                aria-label={`Filter by ${kind}`}
                value={filters[kind]}
                onChange={(e) => setFilters({ ...filters, [kind]: e.target.value })}
              >
                <option value="">
                  All {kind === 'mode' ? 'modes' : kind === 'ems' ? 'EMS' : `${kind}s`}
                </option>
                {look(kind === 'mode' ? 'logistics' : kind).map((v) => (
                  <option key={v}>{v}</option>
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
        {lots.length === 0 && emptyProducts.length === 0 ? (
          <div className="p-5">
            <Empty
              title={mode === 'completed' ? 'No completed lots yet' : 'No matching lots'}
              description={
                mode === 'completed'
                  ? 'A lot appears here when its GRN receipts equal its positive lot quantity.'
                  : 'Try clearing filters or add a lot to a product.'
              }
              action={
                mode === 'active' && (search || quick || Object.values(filters).some(Boolean)) ? (
                  <Button variant="secondary" onClick={clear}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : group ? (
          <div>
            {productOrder.map((product) => {
              const pl = lots.filter((l) => l.productId === product.id),
                open = expanded.includes(product.id),
                rs = pl.flatMap((l) => receiptsFor(l.id))
              return (
                <div key={product.id} className="border-t border-slate-100 first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 hover:bg-slate-50/60 sm:px-5">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() =>
                        setExpanded(
                          open
                            ? expanded.filter((x) => x !== product.id)
                            : [...expanded, product.id],
                        )
                      }
                      aria-expanded={open}
                    >
                      {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-sm font-extrabold text-teal-700">
                        {product.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[#173b3d]">
                          {product.name}{' '}
                          {product.variant && (
                            <span className="font-normal text-slate-500">· {product.variant}</span>
                          )}
                        </span>
                        <span className="text-xs text-slate-500">
                          {product.segment} · {pl.length} lots ·{' '}
                          {pl.filter((l) => l.status === 'Delayed').length} delayed
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span title="Total lot quantity">
                        Qty <b>{quantity(sum(pl.map((l) => l.lotQty)))}</b>
                      </span>
                      <span title="Fresh production quantity">
                        Produced <b>{quantity(sum(pl.map((l) => l.freshProductionQty)))}</b>
                      </span>
                      <span title="Total GRN">
                        GRN <b>{quantity(totalGrn(rs))}</b>
                      </span>
                      <span title="Remaining balance">
                        Balance{' '}
                        <b className="text-[#c46736]">
                          {quantity(sum(pl.map((l) => balance(l, receiptsFor(l.id)))))}
                        </b>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => onEditProduct(product)}>
                        Edit
                      </Button>
                      {mode === 'active' && (
                        <Button variant="secondary" size="sm" onClick={() => onNewLot(product.id)}>
                          <Plus size={14} /> Add lot
                        </Button>
                      )}
                    </div>
                  </div>
                  {open &&
                    (pl.length ? (
                      <LotTable
                        lots={pl}
                        columns={columns}
                        renderCell={renderCell}
                        onOpenLot={onOpenLot}
                        data={data}
                      />
                    ) : (
                      <p className="px-5 pb-4 text-xs text-slate-500">
                        No active lots yet. Use Add lot to start tracking this product.
                      </p>
                    ))}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {lots.length > 0 && (
              <LotTable
                lots={lots}
                columns={columns}
                renderCell={renderCell}
                onOpenLot={onOpenLot}
                data={data}
                showProduct
              />
            )}
            {emptyProducts.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Products without active lots
                </h3>
                <div className="space-y-2">
                  {emptyProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    >
                      <div>
                        <b className="text-sm text-[#173b3d]">{product.name}</b>
                        <span className="ml-2 text-xs text-slate-500">
                          {[product.variant, product.segment].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => onEditProduct(product)}>
                          Edit
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => onNewLot(product.id)}>
                          <Plus size={14} /> Add lot
                        </Button>
                      </div>
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
function LotTable({
  lots,
  columns,
  renderCell,
  onOpenLot,
  data,
  showProduct = false,
}: {
  lots: Lot[]
  columns: Column[]
  renderCell: (l: Lot, c: Column) => React.ReactNode
  onOpenLot: (l: Lot) => void
  data: DataSet
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
              <tr key={l.id} className="cursor-pointer" onClick={() => onOpenLot(l)}>
                {showProduct && (
                  <td className="font-semibold">
                    {data.products.find((p) => p.id === l.productId)?.name}
                  </td>
                )}
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
        {lots.map((l) => {
          const rs = data.grnReceipts.filter((r) => r.lotId === l.id)
          return (
            <button key={l.id} onClick={() => onOpenLot(l)} className="w-full p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#173b3d]">{l.label}</span>
                {statuses(l, rs)}
              </div>
              {showProduct && (
                <div className="mt-1 text-xs text-slate-500">
                  {data.products.find((p) => p.id === l.productId)?.name}
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <span>
                  Qty <b>{quantity(l.lotQty)}</b>
                </span>
                <span>
                  GRN <b>{quantity(totalGrn(rs))}</b>
                </span>
                <span>
                  Balance <b>{quantity(balance(l, rs))}</b>
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{l.stage}</span>
                <span>ETA {dateLabel(effectiveLotEta(l))}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-[#d96d35]" style={{ width: `${grnProgress(l, rs)}%` }} />
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}
