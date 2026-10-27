import type { Page } from '@playwright/test'
import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot, openShipment } from '../support/ui'

test.use({ storageState: authFile('admin') })

const screens = [
  'Production Tracker',
  'Completed',
  'Month-end Summary',
  'Finished Goods',
  'Settings',
]
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function seedSome() {
  const seed = await seeder()
  const alpha = await seed.product('Alpha Long Product Name', { variant: 'Midnight Black' })
  const lot = await seed.lot(alpha.id, 'A-1', { plannedDate: day(), lotQty: 1200 })
  await seed.shipment('INV-MOBILE-0001', { items: [{ productId: alpha.id, quantity: 900 }] })
  await seed.done()
  return lot
}

test('no screen scrolls sideways', async ({ page }) => {
  await seedSome()
  await page.goto('/')
  for (const screen of screens) {
    await goTo(page, screen)
    expect(await noSideScroll(page), screen).toBe(true)
  }
})

test('the menu, drawers and forms are usable', async ({ page }) => {
  await seedSome()
  await page.goto('/')
  const lot = await openLot(page, 'A-1')
  const width = page.viewportSize()!.width
  expect((await lot.boundingBox())!.width).toBeLessThanOrEqual(width)
  await lot.getByLabel('Follow-up note', { exact: true }).fill('Checked on a phone')
  await lot.getByRole('button', { name: 'Save & close' }).click()
  await expect(lot).toBeHidden()
  await goTo(page, 'Finished Goods')
  const shipment = await openShipment(page, 'INV-MOBILE-0001')
  expect((await shipment.boundingBox())!.width).toBeLessThanOrEqual(width)
  await shipment.getByLabel('Remarks', { exact: true }).fill('Checked on a phone')
  await shipment.getByRole('button', { name: 'Save & close' }).click()
  await expect(shipment).toBeHidden()
  expect(await noSideScroll(page)).toBe(true)
})
