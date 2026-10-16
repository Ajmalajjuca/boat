import { readFileSync } from 'node:fs'
import { dateLabel } from '@boat/domain/calculations'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo } from '../support/ui'

test.use({ storageState: authFile('admin') })

// Two lots planned for today, so both fall in the current month: 150 planned, 60 received.
async function seedMonth() {
  const seed = await seeder()
  const juliet = await seed.product('Juliet')
  const j1 = await seed.lot(juliet.id, 'J-1', { lotQty: 100, plannedDate: day() })
  await seed.lot(juliet.id, 'J-2', { lotQty: 50, plannedDate: day(), revisedEta: day(20) })
  await seed.receipt(j1.id, 60)
  await seed.done()
}

test('FR-5.1 shows the month-end figures for the lots planned this month', async ({ page }) => {
  await seedMonth()
  await page.goto('/')
  await goTo(page, 'Month-end Summary')
  await expect(page.getByText('Month in progress')).toBeVisible()
  const card = (help: string) => page.getByTitle(help)
  await expect(card('Lot quantity of lots planned for this month.')).toContainText('150')
  await expect(
    card('GRN for those lots dated on or before the last day of the month.'),
  ).toContainText('60')
  await expect(card('Planned units not yet received by month end.')).toContainText('90')
  await expect(card('Received as a share of planned units.')).toContainText('40%')
  await expect(
    card('Every receipt dated this month, including lots planned for other months.'),
  ).toContainText('60')
})

test('FR-5.2 lists short lots with their current ETA and opens them', async ({ page }) => {
  await seedMonth()
  await page.goto('/')
  await goTo(page, 'Month-end Summary')
  const row = page.getByRole('row', { name: /J-2/ })
  await expect(row).toContainText(dateLabel(day(20)))
  await row.click()
  await expect(page.getByRole('dialog', { name: 'J-2' })).toBeVisible()
})

test('FR-5.2 downloads the month-end CSV', async ({ page }) => {
  await seedMonth()
  await page.goto('/')
  await goTo(page, 'Month-end Summary')
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^month-end-\d{4}-\d{2}\.csv$/)
  const csv = readFileSync(await file.path(), 'utf8')
  expect(csv).toContain('J-1')
  expect(csv).toContain('J-2')
})

test('shows an error, not an endless load, when the report fails', async ({ page }) => {
  await seedMonth()
  await page.route('**/api/v1/reports/month-end?*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  )
  await page.goto('/')
  await goTo(page, 'Month-end Summary')
  await expect(page.getByText("Couldn't reach the server — try again.")).toBeVisible()
  await page.unroute('**/api/v1/reports/month-end?*')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByTitle('Lot quantity of lots planned for this month.')).toContainText('150')
})
