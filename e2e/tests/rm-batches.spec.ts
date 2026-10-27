import type { Locator } from '@playwright/test'
import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { choose, openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

const metric = (drawer: Locator, label: string) =>
  drawer.getByText(label, { exact: true }).locator('..')

async function addBatch(drawer: Locator, component: string, label: string, received: number) {
  await drawer.getByRole('button', { name: 'Add batch' }).click()
  const modal = drawer.page().getByRole('dialog', { name: 'Add material batch' })
  await choose(modal, 'Component', component)
  await modal.getByLabel('Batch label', { exact: true }).fill(label)
  await modal.getByLabel('Received quantity', { exact: true }).fill(String(received))
  await modal.getByRole('button', { name: 'Save batch' }).click()
  await expect(modal).toBeHidden()
}

test('FR-3.2 adds, edits and deletes batches, and RM readiness follows', async ({ page }) => {
  const seed = await seeder()
  const kilo = await seed.product('Kilo')
  await seed.lot(kilo.id, 'K-1', { rmMode: 'components', components: ['Housing', 'Battery'] })
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'K-1')
  await drawer.getByRole('tab', { name: 'RM Readiness' }).click()
  await addBatch(drawer, 'Housing', 'H-A', 60)
  await addBatch(drawer, 'Battery', 'B-A', 40)
  await expect(metric(drawer, 'Producible now')).toContainText('40')
  await expect(metric(drawer, 'Bottleneck')).toContainText('Battery')

  await drawer.getByRole('row', { name: /B-A/ }).getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit material batch' })
  await edit.getByLabel('Received quantity', { exact: true }).fill('80')
  await edit.getByRole('button', { name: 'Save batch' }).click()
  await expect(metric(drawer, 'Producible now')).toContainText('60')
  await expect(metric(drawer, 'Bottleneck')).toContainText('Housing')

  await drawer.getByRole('row', { name: /H-A/ }).getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(drawer.getByRole('row', { name: /H-A/ })).toHaveCount(0)
  await expect(metric(drawer, 'Producible now')).toContainText('0')
})

test('adds a batch to a new lot straight after ticking a component', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Kilo')
  await seed.done()
  await page.goto('/')
  await page.getByRole('group', { name: 'Kilo' }).getByRole('button', { name: 'Add lot' }).click()
  const draft = page.getByRole('dialog', { name: 'New production lot' })
  await draft.getByLabel('Lot label', { exact: true }).fill('K-9')
  await draft.getByLabel('Lot quantity', { exact: true }).fill('50')
  await draft.getByRole('tab', { name: 'RM Readiness' }).click()
  await draft.getByLabel('RM readiness mode').selectOption('components')
  await draft.getByLabel('Battery', { exact: true }).check()
  await expect(draft.getByText('Save lot changes before adding a material batch.')).toHaveCount(0)
  const add = draft.getByRole('button', { name: 'Add batch' })
  await expect(add).toBeEnabled()
  await add.click()
  // The lot is saved first, so the drawer reopens under its label with the batch form open.
  const modal = page.getByRole('dialog', { name: 'Add material batch' })
  await expect(modal).toBeVisible()
  await expect(modal.getByText('Battery')).toBeVisible()
  // The open form hides the drawer from the accessibility tree; it shows again once closed.
  await modal.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog', { name: 'K-9' })).toBeVisible()
})

test('FR-3.1 adds batches only to lots tracked by component', async ({ page }) => {
  const seed = await seeder()
  const kilo = await seed.product('Kilo')
  await seed.lot(kilo.id, 'K-2')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'K-2')
  await drawer.getByRole('tab', { name: 'RM Readiness' }).click()
  await expect(drawer.getByRole('button', { name: 'Add batch' })).toBeDisabled()
})

test('FR-3.3 shows the server refusing a component the lot no longer tracks', async ({ page }) => {
  const seed = await seeder()
  const kilo = await seed.product('Kilo')
  const lot = await seed.lot(kilo.id, 'K-3', {
    rmMode: 'components',
    components: ['Housing', 'Battery'],
  })
  await page.goto('/')
  const drawer = await openLot(page, 'K-3')
  await drawer.getByRole('tab', { name: 'RM Readiness' }).click()
  await drawer.getByRole('button', { name: 'Add batch' }).click()
  const modal = page.getByRole('dialog', { name: 'Add material batch' })
  await choose(modal, 'Component', 'Housing')
  await modal.getByLabel('Batch label', { exact: true }).fill('H-late')
  // Someone else drops Housing from the lot while this form is open.
  await seed.api.patch(`/lots/${lot.id}`, {
    componentIds: [await seed.lookup('component', 'Battery')],
    version: lot.version,
  })
  await seed.done()
  await modal.getByRole('button', { name: 'Save batch' }).click()
  await expect(
    modal.locator('[data-invalid]').filter({ hasText: 'Component' }).getByRole('alert'),
  ).toContainText('Select this component on the lot first.')
})
