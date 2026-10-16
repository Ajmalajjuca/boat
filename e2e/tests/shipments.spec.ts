import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { choose, goTo, openShipment } from '../support/ui'

test.use({ storageState: authFile('admin') })

const shipment = (page: Page, number: string) =>
  page.getByRole('main').getByText(number, { exact: true }).filter({ visible: true })

test('FR-6.1 adds a shipment with two product lines, edits and deletes it', async ({ page }) => {
  const seed = await seeder()
  await seed.product('November')
  await seed.product('Oscar')
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await page.getByRole('button', { name: 'Add Shipment' }).click()
  const drawer = page.getByRole('dialog', { name: 'New shipment' })
  await drawer.getByLabel('Shipment / invoice number', { exact: true }).fill('INV-1')
  await drawer.getByLabel('Vessel / flight', { exact: true }).fill('MSC Aurora')
  await choose(drawer, 'Product 1', 'November')
  await drawer.getByLabel('Quantity', { exact: true }).first().fill('100')
  await drawer.getByRole('button', { name: 'Add product line' }).click()
  await choose(drawer, 'Product 2', 'Oscar')
  await drawer.getByLabel('Quantity', { exact: true }).nth(1).fill('50')
  await drawer.getByRole('button', { name: 'Save & close' }).click()
  await expect(drawer).toBeHidden()
  await expect(shipment(page, 'INV-1')).toBeVisible()
  await expect(page.getByRole('main')).toContainText('150')

  const edit = await openShipment(page, 'INV-1')
  await expect(edit.getByLabel('Quantity', { exact: true })).toHaveCount(2)
  await edit.getByLabel('Vessel / flight', { exact: true }).fill('Maersk Kobe')
  await edit.getByRole('button', { name: 'Save & close' }).click()
  await expect(page.getByRole('main')).toContainText('Maersk Kobe')

  const remove = await openShipment(page, 'INV-1')
  page.once('dialog', (d) => d.accept())
  await remove.getByRole('button', { name: 'Delete shipment' }).click()
  await expect(remove).toBeHidden()
  await page.waitForTimeout(1000)
  await expect(page.getByText('This shipment was deleted.')).toHaveCount(0)
  await expect(page.getByText('No matching shipments')).toBeVisible()
})

test('FR-6.2 shows a product deleted mid-edit under its line', async ({ page }) => {
  const seed = await seeder()
  const papa = await seed.product('Papa')
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await page.getByRole('button', { name: 'Add Shipment' }).click()
  const drawer = page.getByRole('dialog', { name: 'New shipment' })
  await drawer.getByLabel('Shipment / invoice number', { exact: true }).fill('INV-2')
  await drawer.getByLabel('Vessel / flight', { exact: true }).fill('MSC Aurora')
  await choose(drawer, 'Product 1', 'Papa')
  await seed.api.delete(`/products/${papa.id}`)
  await seed.done()
  await drawer.getByRole('button', { name: 'Save shipment' }).click()
  await expect(
    drawer.locator('[data-invalid]').filter({ hasText: 'Product 1' }).getByRole('alert'),
  ).toContainText('This product no longer exists.')
})

test('FR-6.1 shows the conflict banner when someone else saved the shipment first', async ({
  page,
}) => {
  const seed = await seeder()
  const quebec = await seed.product('Quebec')
  const saved = await seed.shipment('INV-3', { items: [{ productId: quebec.id, quantity: 10 }] })
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  const drawer = await openShipment(page, 'INV-3')
  await drawer.getByLabel('Remarks', { exact: true }).fill('Customs hold')
  await seed.api.patch(`/shipments/${saved.id}`, { vessel: 'Maersk Kobe', version: saved.version })
  await seed.done()
  await drawer.getByRole('button', { name: 'Save shipment' }).click()
  const banner = drawer
    .getByRole('alert')
    .filter({ hasText: 'Someone else changed this shipment while you were editing.' })
  await expect(banner).toBeVisible()
  await expect(drawer.getByLabel('Remarks', { exact: true })).toHaveValue('Customs hold')
  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(drawer.getByLabel('Vessel / flight', { exact: true })).toHaveValue('Maersk Kobe')
  await expect(drawer.getByLabel('Remarks', { exact: true })).toHaveValue('')
})

test('FR-6.5 filters by card and downloads the CSV of what is shown', async ({ page }) => {
  const seed = await seeder()
  const romeo = await seed.product('Romeo')
  const items = [{ productId: romeo.id, quantity: 5 }]
  await seed.shipment('INV-OPEN', { etd: day(-3), plannedEta: day(5), items })
  await seed.shipment('INV-DONE', {
    etd: day(-10),
    plannedEta: day(-2),
    actualArrival: day(-1),
    stage: 'Arrived',
    items,
  })
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await page.getByRole('button', { name: /^Arrived/ }).click()
  await expect(shipment(page, 'INV-DONE')).toBeVisible()
  await expect(shipment(page, 'INV-OPEN')).toHaveCount(0)
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^shipments-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync(await file.path(), 'utf8')
  expect(csv).toContain('INV-DONE')
  expect(csv).not.toContain('INV-OPEN')
})

test('shows an error, not an empty list, when the shipments fail to load', async ({ page }) => {
  const seed = await seeder()
  const tango = await seed.product('Tango')
  await seed.shipment('INV-ERR', { items: [{ productId: tango.id, quantity: 5 }] })
  await seed.done()
  await page.route('**/api/v1/shipments?*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  )
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await expect(page.getByText("Couldn't reach the server — try again.")).toBeVisible()
  await expect(page.getByText('No matching shipments')).toHaveCount(0)
  await page.unroute('**/api/v1/shipments?*')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(shipment(page, 'INV-ERR')).toBeVisible()
})

test('goes back a page when the last shipment of a later page is deleted', async ({ page }) => {
  const seed = await seeder()
  const uniform = await seed.product('Uniform')
  for (let i = 1; i <= 51; i++)
    await seed.shipment(`INV-${String(i).padStart(2, '0')}`, {
      items: [{ productId: uniform.id, quantity: 1 }],
    })
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  await page.getByRole('combobox', { name: 'Sort shipments' }).selectOption('number-asc')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('51–51 of 51')).toBeVisible()
  await shipment(page, 'INV-51').click()
  const drawer = page.getByRole('dialog', { name: 'INV-51' })
  page.once('dialog', (d) => d.accept())
  await drawer.getByRole('button', { name: 'Delete shipment' }).click()
  await expect(drawer).toBeHidden()
  await expect(shipment(page, 'INV-50')).toBeVisible()
})
