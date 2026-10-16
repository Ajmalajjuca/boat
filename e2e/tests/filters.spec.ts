import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo } from '../support/ui'

test.use({ storageState: authFile('admin') })

// Lot labels render in a table on desktop and in cards on mobile; only one of them is visible.
const lot = (page: Page, label: string) =>
  page.getByRole('main').getByText(label, { exact: true }).filter({ visible: true })

async function seedThree() {
  const seed = await seeder()
  const alpha = await seed.product('Alpha')
  const bravo = await seed.product('Bravo', { segment: 'Soundbars' })
  await seed.product('Charlie')
  await seed.lot(alpha.id, 'A-overdue', { plannedDate: day(-2) })
  await seed.lot(alpha.id, 'A-delayed', { status: 'Delayed', plannedDate: day(10) })
  const soon = await seed.lot(bravo.id, 'B-soon', { plannedDate: day(1), lotQty: 200 })
  await seed.receipt(soon.id, 50)
  await seed.done()
}

test('FR-2.5 groups lots under their products with totals', async ({ page }) => {
  await seedThree()
  await page.goto('/')
  const alpha = page.getByRole('group', { name: 'Alpha' })
  await expect(alpha).toContainText('2 lots · 1 delayed')
  await expect(page.getByRole('group', { name: 'Bravo' })).toContainText(/Qty\s*200/)
  await expect(page.getByRole('group', { name: 'Bravo' })).toContainText(/GRN\s*50/)
  await expect(page.getByRole('group', { name: 'Bravo' })).toContainText(/Balance\s*150/)
  await expect(page.getByRole('group', { name: 'Charlie' })).toContainText('0 lots')
  await alpha.getByRole('button', { expanded: false }).click()
  await expect(lot(page, 'A-overdue')).toBeVisible()
  await expect(lot(page, 'A-delayed')).toBeVisible()
})

test('FR-2.6 cards count active lots and filter the list', async ({ page }) => {
  await seedThree()
  await page.goto('/')
  const overdue = page.getByRole('button', { name: /^Overdue/ })
  await expect(overdue).toContainText('1')
  await expect(page.getByRole('button', { name: /^Due Soon/ })).toContainText('1')
  await overdue.click()
  await expect(lot(page, 'A-overdue')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Bravo' })).toHaveCount(0)
  await overdue.click()
  await expect(page.getByRole('group', { name: 'Bravo' })).toBeVisible()
})

test('FR-2.5 filters by status, searches, and clears', async ({ page }) => {
  await seedThree()
  await page.goto('/')
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: 'Delayed' })
  await expect(lot(page, 'A-delayed')).toBeVisible()
  await expect(lot(page, 'A-overdue')).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Charlie' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('brav')
  await expect(page.getByRole('group', { name: 'Bravo' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Alpha' })).toHaveCount(0)
})

test('FR-2.5 the flat view pages, and a new filter returns to the first page', async ({ page }) => {
  const seed = await seeder()
  const delta = await seed.product('Delta')
  for (let i = 1; i <= 55; i++)
    await seed.lot(delta.id, `L${String(i).padStart(2, '0')}`, { plannedDate: day(5) })
  await seed.done()
  await page.goto('/')
  await page.getByRole('button', { name: 'Grouped by product' }).click()
  await page.getByRole('combobox', { name: 'Sort lots' }).selectOption('label-asc')
  await expect(page.getByText('1–50 of 55')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('51–55 of 55')).toBeVisible()
  await expect(lot(page, 'L55')).toBeVisible()
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('L5')
  // Back on page 1 of the six matches (L50–L55), not on an empty page 2.
  await expect(lot(page, 'L50')).toBeVisible()
  await expect(lot(page, 'L49')).toHaveCount(0)
})

test('FR-2.5 downloads the CSV of the current view, and says when it is empty', async ({
  page,
}) => {
  await seedThree()
  await page.goto('/')
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: 'Delayed' })
  await expect(lot(page, 'A-overdue')).toHaveCount(0)
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^active-lots-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync(await file.path(), 'utf8')
  expect(csv).toContain('A-delayed')
  expect(csv).not.toContain('B-soon')
  await page
    .getByRole('textbox', { name: 'Search product, variant, or lot' })
    .fill('nothing like this')
  await expect(page.getByText('No matching lots')).toBeVisible()
  await page.getByRole('button', { name: 'CSV' }).click()
  await expect(page.getByText('Nothing to export: the current view has no rows.')).toBeVisible()
})

test('FR-2.5 lists fully received lots under Completed', async ({ page }) => {
  const seed = await seeder()
  const echo = await seed.product('Echo')
  const done = await seed.lot(echo.id, 'E-done', { lotQty: 30, plannedDate: day(-5) })
  await seed.receipt(done.id, 30)
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Completed')
  await expect(page.getByRole('group', { name: 'Echo' })).toContainText('1 lots · completed')
})

test('FR-2.5 goes back a page when the last row of a later page is deleted', async ({ page }) => {
  const seed = await seeder()
  const delta = await seed.product('Delta')
  for (let i = 1; i <= 51; i++)
    await seed.lot(delta.id, `L${String(i).padStart(2, '0')}`, { plannedDate: day(5) })
  await seed.done()
  await page.goto('/')
  await page.getByRole('button', { name: 'Grouped by product' }).click()
  await page.getByRole('combobox', { name: 'Sort lots' }).selectOption('label-asc')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('51–51 of 51')).toBeVisible()
  await lot(page, 'L51').click()
  const drawer = page.getByRole('dialog', { name: 'L51' })
  page.once('dialog', (d) => d.accept())
  await drawer.getByRole('button', { name: 'Delete lot' }).click()
  await expect(drawer).toBeHidden()
  await expect(lot(page, 'L50')).toBeVisible()
})
