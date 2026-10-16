import type { Locator } from '@playwright/test'
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

async function openReceipt(drawer: Locator, label: string, quantity: number) {
  await drawer.getByRole('button', { name: 'Add receipt' }).click()
  const modal = drawer.page().getByRole('dialog', { name: 'Add GRN receipt' })
  await modal.getByLabel('Receipt label', { exact: true }).fill(label)
  await modal.getByLabel('Quantity', { exact: true }).fill(String(quantity))
  return modal
}

test('FR-4.1 takes partial receipts and completes the lot at full GRN', async ({ page }) => {
  const seed = await seeder()
  const lima = await seed.product('Lima')
  await seed.lot(lima.id, 'L-1', { lotQty: 100 })
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'L-1')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  await (
    await openReceipt(drawer, 'GRN 1', 40)
  )
    .getByRole('button', { name: 'Save receipt' })
    .click()
  await expect(drawer.getByText('Pending quantity').locator('..')).toContainText('60')
  await (
    await openReceipt(drawer, 'GRN 2', 60)
  )
    .getByRole('button', { name: 'Save receipt' })
    .click()
  await expect(drawer.getByText('Pending quantity').locator('..')).toContainText('0')
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('')
  await expect(page.getByRole('group', { name: 'Lima' })).toContainText('0 lots')
  await goTo(page, 'Completed')
  await expect(page.getByRole('group', { name: 'Lima' })).toContainText('1 lots · completed')
})

test('FR-4.2 refuses more than the lot has left, in the form and on the server', async ({
  page,
}) => {
  const seed = await seeder()
  const lima = await seed.product('Lima')
  const lot = await seed.lot(lima.id, 'L-2', { lotQty: 100 })
  await seed.receipt(lot.id, 80)
  await page.goto('/')
  const drawer = await openLot(page, 'L-2')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  const modal = await openReceipt(drawer, 'GRN late', 30)
  await modal.getByRole('button', { name: 'Save receipt' }).click()
  await expect(modal).toContainText('Only 20 units are left to receive on this lot.')
  // Another receipt arrives while the form is open; only the server can catch this one.
  await seed.receipt(lot.id, 15)
  await seed.done()
  await modal.getByLabel('Quantity', { exact: true }).fill('20')
  await modal.getByRole('button', { name: 'Save receipt' }).click()
  await expect(
    modal.locator('[data-invalid]').filter({ hasText: 'Quantity' }).getByRole('alert'),
  ).toContainText('Only 5 units are left to receive on this lot.')
})
