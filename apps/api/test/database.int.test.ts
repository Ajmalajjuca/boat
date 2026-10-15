import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { pino } from 'pino'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { createPrisma, databaseCheck } from '../src/core/prisma'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const suffix = () => randomUUID().slice(0, 8)

let container: StartedPostgreSqlContainer
let ownerUrl: string
let appUrl: string
let owner: Client
let app: Client

// Runs the Prisma CLI against the container as the owner, like the Render pre-deploy step.
function prismaCli(args: string[]) {
  return execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: apiRoot,
    env: { ...process.env, DIRECT_URL: ownerUrl },
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

async function lookup(kind: string, value = `${kind} ${suffix()}`) {
  const { rows } = await app.query<{ id: string }>(
    'INSERT INTO lookup_values (id, kind, value, updated_at) VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id',
    [kind, value],
  )
  return rows[0].id
}

async function product(name: string, variant: string, segmentId: string) {
  const { rows } = await app.query<{ id: string }>(
    'INSERT INTO products (id, name, variant, segment_id, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, now()) RETURNING id',
    [name, variant, segmentId],
  )
  return rows[0].id
}

async function lot(fields: { lotQty: number; grnTotal?: number; fresh?: number; rework?: number }) {
  const productId = await product(`Product ${suffix()}`, '', await lookup('segment'))
  const { rows } = await app.query<{ id: string }>(
    `INSERT INTO lots (id, product_id, label, category_id, status_id, stage_id,
       lot_qty, grn_total, fresh_production_qty, rework_qty, updated_at)
     VALUES (gen_random_uuid(), $1, 'Lot 1', $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
    [
      productId,
      await lookup('category'),
      await lookup('status'),
      await lookup('stage'),
      fields.lotQty,
      fields.grnTotal ?? 0,
      fields.fresh ?? 0,
      fields.rework ?? 0,
    ],
  )
  return rows[0].id
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start()
  ownerUrl = container.getConnectionUri()
  owner = new Client({ connectionString: ownerUrl })
  await owner.connect()
  await owner.query("CREATE ROLE boat_app LOGIN PASSWORD 'boat_app'")
  prismaCli(['migrate', 'deploy'])
  prismaCli(['db', 'execute', '--file', 'prisma/grants.sql'])
  const url = new URL(ownerUrl)
  url.username = 'boat_app'
  url.password = 'boat_app'
  appUrl = url.toString()
  app = new Client({ connectionString: appUrl })
  await app.connect()
})

afterAll(async () => {
  await app?.end()
  await owner?.end()
  await container?.stop()
})

describe('migrations', () => {
  it('match schema.prisma exactly', () => {
    expect(() =>
      prismaCli([
        'migrate',
        'diff',
        '--exit-code',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
      ]),
    ).not.toThrow()
  })
})

describe('app role privileges', () => {
  it('can insert and update but never delete', async () => {
    const id = await lookup('segment')
    await expect(
      app.query('UPDATE lookup_values SET sort = 1 WHERE id = $1', [id]),
    ).resolves.toBeDefined()
    await expect(app.query('DELETE FROM lookup_values WHERE id = $1', [id])).rejects.toMatchObject({
      code: '42501',
    })
  })
  it('can add history but not rewrite it', async () => {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO activity_logs (id, entity_type, entity_id, kind, message)
       VALUES (gen_random_uuid(), 'lot', gen_random_uuid(), 'note', 'hello') RETURNING id`,
    )
    await expect(
      app.query('UPDATE activity_logs SET message = $2 WHERE id = $1', [rows[0].id, 'edited']),
    ).rejects.toMatchObject({ code: '42501' })
  })
  it('cannot read migration bookkeeping', async () => {
    await expect(app.query('SELECT * FROM _prisma_migrations')).rejects.toMatchObject({
      code: '42501',
    })
  })
})

describe('constraints', () => {
  it('keeps product name and variant unique among active rows, ignoring case', async () => {
    const segment = await lookup('segment')
    const name = `Inverter ${suffix()}`
    const first = await product(name, '5 kW', segment)
    await expect(product(name.toUpperCase(), '5 KW', segment)).rejects.toMatchObject({
      code: '23505',
    })
    await app.query('UPDATE products SET deleted_at = now() WHERE id = $1', [first])
    await expect(product(name, '5 kW', segment)).resolves.toBeTruthy()
  })
  it('refuses a lot that has received more than its quantity', async () => {
    await expect(lot({ lotQty: 10, grnTotal: 11 })).rejects.toMatchObject({ code: '23514' })
  })
  it('refuses rework above fresh production', async () => {
    await expect(lot({ lotQty: 10, fresh: 3, rework: 5 })).rejects.toMatchObject({ code: '23514' })
  })
  it('refuses a receipt with zero quantity', async () => {
    const lotId = await lot({ lotQty: 10 })
    await expect(
      app.query(
        `INSERT INTO grn_receipts (id, lot_id, label, date, quantity, updated_at)
         VALUES (gen_random_uuid(), $1, 'GRN 1', '2026-10-01', 0, now())`,
        [lotId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
  it('refuses a shipment ETA before ETD', async () => {
    await expect(
      app.query(
        `INSERT INTO shipments (id, number, vessel, etd, planned_eta, updated_at)
         VALUES (gen_random_uuid(), $1, 'MSC Aurora', '2026-10-10', '2026-10-01', now())`,
        [`INV-${suffix()}`],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('readiness', () => {
  it('reports ready when connected as the app role', async () => {
    const db = createPrisma(appUrl)
    try {
      const server = createApp({
        logger: pino({ level: 'silent' }),
        checkDatabase: databaseCheck(db),
      })
      const res = await request(server).get('/api/v1/health/ready')
      expect(res.status).toBe(200)
    } finally {
      await db.$disconnect()
    }
  })
})

describe('grants.sql', () => {
  it('refuses to finish when a membership gives the app role DELETE', async () => {
    await owner.query('GRANT pg_write_all_data TO boat_app')
    try {
      expect(() => prismaCli(['db', 'execute', '--file', 'prisma/grants.sql'])).toThrow()
    } finally {
      await owner.query('REVOKE pg_write_all_data FROM boat_app')
    }
  })
})
