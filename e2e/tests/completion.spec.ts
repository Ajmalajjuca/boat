import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-11.3 entering the actual date moves the lot to Completed, clearing it brings it back', async ({
  page,
}) => {
  const seed = await seeder()
  const mike = await seed.product('Mike')
  await seed.lot(mike.id, 'M-1')
  await seed.done()
  await page.goto('/')
  let drawer = await openLot(page, 'M-1')
  await drawer.getByLabel('Actual date', { exact: true }).fill(day())
  await drawer.getByRole('button', { name: 'Save & close' }).click()
  await expect(drawer).toBeHidden()
  await goTo(page, 'Completed')
  await expect(page.getByRole('group', { name: 'Mike' })).toBeVisible()
  drawer = await openLot(page, 'M-1')
  await drawer.getByLabel('Actual date', { exact: true }).fill('')
  await drawer.getByRole('button', { name: 'Save & close' }).click()
  await expect(drawer).toBeHidden()
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: 'Mike' })).toContainText('1 lots')
})

test('shows no GRN, rework or fresh production on a lot', async ({ page }) => {
  const seed = await seeder()
  const mike = await seed.product('Mike')
  await seed.lot(mike.id, 'M-2')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'M-2')
  await expect(drawer.getByRole('tab', { name: 'GRN Receipts' })).toHaveCount(0)
  await expect(drawer.getByText(/rework|fresh produc|GRN/i)).toHaveCount(0)
  await drawer.getByRole('tab', { name: 'RM Readiness' }).click()
  await expect(drawer.getByText(/rework|fresh produc|GRN/i)).toHaveCount(0)
})
