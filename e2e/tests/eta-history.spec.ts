import { dateLabel } from '@boat/domain/calculations'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openShipment } from '../support/ui'

test.use({ storageState: authFile('admin') })

async function seedShipment() {
  const seed = await seeder()
  const sierra = await seed.product('Sierra')
  await seed.shipment('INV-ETA', {
    etd: day(-2),
    plannedEta: day(10),
    items: [{ productId: sierra.id, quantity: 40 }],
  })
  await seed.done()
}

test('FR-6.4 revising the ETA records the change with its reason', async ({ page }) => {
  await seedShipment()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  const drawer = await openShipment(page, 'INV-ETA')
  await drawer.getByLabel('Current revised ETA', { exact: true }).fill(day(14))
  await drawer.getByLabel('ETA change reason', { exact: true }).fill('Port congestion')
  await drawer.getByRole('button', { name: 'Save shipment' }).click()
  await expect(drawer.getByLabel('ETA change reason', { exact: true })).toHaveValue('')
  // Creating the shipment wrote no revision; this change writes exactly one.
  const history = drawer.getByRole('tab', { name: /ETA revisions & history/ })
  await expect(history).toContainText('1')
  await history.click()
  await expect(drawer.getByText(dateLabel(day(10))).first()).toBeVisible()
  await expect(drawer.getByText(dateLabel(day(14))).first()).toBeVisible()
  await expect(drawer.getByText(/Port congestion/).first()).toBeVisible()
})

test('FR-7.2 posts a shipment note and lists it', async ({ page }) => {
  await seedShipment()
  await page.goto('/')
  await goTo(page, 'Finished Goods')
  const drawer = await openShipment(page, 'INV-ETA')
  await drawer.getByRole('tab', { name: /ETA revisions & history/ }).click()
  await drawer.getByLabel('Shipment update note', { exact: true }).fill('Booked the truck')
  await drawer.getByRole('button', { name: 'Post update' }).click()
  await expect(drawer.getByText('Booked the truck')).toBeVisible()
})
