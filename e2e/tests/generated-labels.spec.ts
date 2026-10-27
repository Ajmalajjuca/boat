import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { choose } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('creates a lot and material batch without typing labels', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Automatic references')
  await seed.lookup('component', 'Housing')
  await seed.lookup('stage', 'RM Sourcing')
  await seed.done()
  await page.goto('/')
  await page
    .getByRole('group', { name: 'Automatic references' })
    .getByRole('button', { name: 'Add lot' })
    .click()
  const draft = page.getByRole('dialog', { name: 'New production lot' })
  await expect(draft.getByLabel('Lot label', { exact: true })).not.toHaveAttribute('required')
  await draft.getByLabel('Lot quantity', { exact: true }).fill('100')
  await draft.getByRole('button', { name: 'Save lot', exact: true }).click()
  const lot = page.getByRole('dialog', { name: /^LOT-\d+/ })
  await expect(lot).toBeVisible()
  const label = await lot.getByLabel('Lot label', { exact: true }).inputValue()
  await lot.getByRole('tab', { name: 'RM Readiness' }).click()
  await lot.getByLabel('RM readiness mode', { exact: true }).selectOption('components')
  await lot.getByLabel('Housing', { exact: true }).check()
  await lot.getByRole('button', { name: 'Save lot', exact: true }).click()
  await lot.getByRole('button', { name: 'Add batch' }).click()
  const batch = page.getByRole('dialog', { name: 'Add material batch' })
  await choose(batch, 'Component', 'Housing')
  await batch.getByRole('button', { name: 'Save batch' }).click()
  await expect(batch).toBeHidden()
  await expect(lot.getByRole('row', { name: /RM-\d{6,}/ })).toBeVisible()
  // GRN receipts are hidden (FEATURE_GRN off); their generated labels are pinned by the API tests.
  await expect(lot.getByLabel('Lot label', { exact: true })).toHaveCount(0)
  await lot.getByRole('tab', { name: 'Overview', exact: true }).click()
  await expect(lot.getByLabel('Lot label', { exact: true })).toHaveValue(label)
})
