import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

async function completedLot() {
  const seed = await seeder()
  const mike = await seed.product('Mike')
  const lot = await seed.lot(mike.id, 'M-1', { lotQty: 50 })
  await seed.receipt(lot.id, 50, undefined, 'GRN full')
  await seed.done()
}

test('FR-4.3 deleting a receipt reopens a completed lot', async ({ page }) => {
  await completedLot()
  await page.goto('/')
  await goTo(page, 'Completed')
  const drawer = await openLot(page, 'M-1')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  await drawer.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(drawer.getByText('No GRN receipts recorded.')).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: 'Mike' })).toContainText('1 lots')
})

test('FR-4.3 lowering a receipt reopens a completed lot', async ({ page }) => {
  await completedLot()
  await page.goto('/')
  await goTo(page, 'Completed')
  const drawer = await openLot(page, 'M-1')
  await drawer.getByRole('tab', { name: 'GRN Receipts' }).click()
  await drawer.getByRole('button', { name: 'Edit', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Edit GRN receipt' })
  await modal.getByLabel('Quantity', { exact: true }).fill('45')
  await modal.getByRole('button', { name: 'Save receipt' }).click()
  await expect(drawer.getByText('Pending quantity').locator('..')).toContainText('5')
  await drawer.getByRole('button', { name: 'Close' }).first().click()
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: 'Mike' })).toContainText('1 lots')
})
