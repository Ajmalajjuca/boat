import { type LotFlag, lotFlagNames, type LotSort, lotSorts } from '@boat/domain/api'
import { dayOffset } from '@boat/domain/calculations'
import type { Db } from '../../core/prisma'
import { Prisma } from '../../generated/prisma/client'

export { type LotFlag, lotFlagNames, type LotSort, lotSorts }

const filterColumns = {
  productId: 'l.product_id',
  segmentId: 'p.segment_id',
  categoryId: 'l.category_id',
  emsId: 'l.ems_id',
  pocId: 'l.poc_id',
  statusId: 'l.status_id',
  stageId: 'l.stage_id',
  logisticsId: 'l.logistics_id',
  blockerId: 'l.blocker_id',
} as const
export type LotFilters = {
  view: 'active' | 'completed'
  q: string
  flags: LotFlag[]
  sort: LotSort
} & {
  [K in keyof typeof filterColumns]?: string
}

// Lots with what the filters read. Lots of a deleted product never show.
const from = Prisma.sql`
  lots l
  JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL
  JOIN lookup_values st ON st.id = l.status_id
  JOIN lookup_values cat ON cat.id = l.category_id
  LEFT JOIN lookup_values bl ON bl.id = l.blocker_id`

// rmMetrics(...).complete: "all received" mode compares the ready quantity; component mode needs
// at least one required component (the kit doesn't count) and every one fully received.
const kit = 'Kit (All Together)'
const required = Prisma.sql`
  FROM lot_components lc JOIN lookup_values c ON c.id = lc.component_id
  WHERE lc.lot_id = l.id AND lc.deleted_at IS NULL AND c.value::text <> ${kit}`
const rmComplete = Prisma.sql`(CASE
  WHEN l.rm_mode = 'all' THEN l.lot_qty > 0 AND l.ready_qty >= l.lot_qty
  ELSE l.lot_qty > 0
    AND EXISTS (SELECT 1 ${required})
    AND NOT EXISTS (
      SELECT 1 ${required}
      AND COALESCE((
        SELECT SUM(b.received_qty) FROM rm_batches b
        WHERE b.lot_id = l.id AND b.component_id = lc.component_id AND b.deleted_at IS NULL
      ), 0) < l.lot_qty)
  END)`

// lotFlags (packages/domain) plus the demo's quick filters, as SQL that is never NULL.
// System values are matched by system_key. lots-list.int.test.ts checks each against the domain.
function flagSql(flag: LotFlag, today: string): Prisma.Sql {
  const eta = Prisma.sql`COALESCE(l.revised_eta, l.planned_date)`
  const open = Prisma.sql`l.completed_on IS NULL`
  let sql: Prisma.Sql
  switch (flag) {
    case 'overdue':
      sql = Prisma.sql`${open} AND ${eta} < ${today}::date`
      break
    case 'dueSoon':
      sql = Prisma.sql`${open} AND ${eta} >= ${today}::date AND ${eta} <= ${dayOffset(today, 3)}::date`
      break
    case 'followUp':
      sql = Prisma.sql`${open} AND l.follow_up_date <= ${today}::date`
      break
    case 'blocked':
      sql = Prisma.sql`${open} AND (st.system_key IN ('delayed', 'hold')
        OR (l.blocker_id IS NOT NULL AND bl.system_key IS DISTINCT FROM 'none'))`
      break
    case 'approval':
      sql = Prisma.sql`${open} AND bl.system_key = 'approval_blocker'`
      break
    case 'rm':
      sql = Prisma.sql`NOT ${rmComplete}`
      break
    case 'npi':
      sql = Prisma.sql`cat.system_key IS DISTINCT FROM 'bau'`
      break
    case 'onTrack':
      sql = Prisma.sql`st.system_key = 'on_track'
        AND NOT ${flagSql('overdue', today)}
        AND NOT ${flagSql('dueSoon', today)}
        AND NOT ${flagSql('blocked', today)}`
      break
  }
  return Prisma.sql`COALESCE((${sql}), false)`
}

// Search text matches literally: % and _ are escaped, so "100%" finds "100%" and not "1000".
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

function whereSql(f: LotFilters, today: string) {
  const parts = [
    Prisma.sql`l.deleted_at IS NULL`,
    f.view === 'completed'
      ? Prisma.sql`l.completed_on IS NOT NULL`
      : Prisma.sql`l.completed_on IS NULL`,
  ]
  for (const [key, column] of Object.entries(filterColumns)) {
    const id = f[key as keyof typeof filterColumns]
    if (id) parts.push(Prisma.sql`${Prisma.raw(column)} = ${id}::uuid`)
  }
  const q = f.q.trim()
  if (q)
    parts.push(
      Prisma.sql`(p.name || ' ' || p.variant || ' ' || l.label) ILIKE ${likePattern(q)} ESCAPE '\\'`,
    )
  for (const flag of f.flags) parts.push(flagSql(flag, today))
  return Prisma.join(parts, ' AND ')
}

// The demo's sorts. A lot with no ETA sorts as 9999-12-31: last going up, first going down.
const order: Record<LotSort, Prisma.Sql> = {
  'eta-asc': Prisma.sql`COALESCE(l.revised_eta, l.planned_date, DATE '9999-12-31') ASC`,
  'eta-desc': Prisma.sql`COALESCE(l.revised_eta, l.planned_date, DATE '9999-12-31') DESC`,
  'qty-desc': Prisma.sql`l.lot_qty DESC`,
  'balance-desc': Prisma.sql`(l.lot_qty - l.grn_total) DESC`,
  'product-asc': Prisma.sql`p.name ASC`,
  'label-asc': Prisma.sql`l.label ASC`,
}

// Matching lot ids in display order; the id breaks ties so pages never overlap.
export async function findLotIds(
  db: Db,
  f: LotFilters,
  today: string,
  page?: { skip: number; take: number },
) {
  const limit = page ? Prisma.sql`LIMIT ${page.take} OFFSET ${page.skip}` : Prisma.empty
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM ${from} WHERE ${whereSql(f, today)} ORDER BY ${order[f.sort]}, l.id ${limit}`
  return rows.map((r) => r.id)
}

export async function countLots(db: Db, f: LotFilters, today: string) {
  const [row] = await db.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM ${from} WHERE ${whereSql(f, today)}`
  return row.count
}

// The demo's summary cards, over every active lot.
const cards = [
  'overdue',
  'dueSoon',
  'onTrack',
  'blocked',
  'approval',
  'followUp',
  'rm',
  'npi',
] as const
export async function lotCardCounts(db: Db, today: string) {
  const columns = Prisma.join(
    cards.map(
      (c) =>
        Prisma.sql`(COUNT(*) FILTER (WHERE ${flagSql(c, today)}))::int AS ${Prisma.raw(`"${c}"`)}`,
    ),
  )
  const [row] = await db.$queryRaw<Record<(typeof cards)[number], number>[]>`
    SELECT ${columns} FROM ${from} WHERE l.deleted_at IS NULL AND l.completed_on IS NULL`
  return row
}

export type LotGroupRow = {
  productId: string
  lots: number
  delayed: number
  lotQty: number
  produced: number
  grnTotal: number
  balance: number
}

// The matching lots per product, products in the order of their first lot. grn_total is kept by
// refreshCompletion, so balance is the domain's lotQty - totalGrn. Sums are float8 so that large
// totals arrive as numbers rather than BigInts.
export async function lotGroupRows(db: Db, f: LotFilters, today: string) {
  return db.$queryRaw<LotGroupRow[]>`
    WITH matching AS (
      SELECT l.id, l.product_id, ROW_NUMBER() OVER (ORDER BY ${order[f.sort]}, l.id) AS pos
      FROM ${from} WHERE ${whereSql(f, today)})
    SELECT m.product_id AS "productId",
      COUNT(*)::int AS lots,
      (COUNT(*) FILTER (WHERE s.system_key = 'delayed'))::int AS delayed,
      SUM(x.lot_qty)::float8 AS "lotQty",
      SUM(x.fresh_production_qty)::float8 AS produced,
      SUM(x.grn_total)::float8 AS "grnTotal",
      SUM(x.lot_qty - x.grn_total)::float8 AS balance
    FROM matching m
    JOIN lots x ON x.id = m.id
    JOIN lookup_values s ON s.id = x.status_id
    GROUP BY m.product_id
    ORDER BY MIN(m.pos)`
}
