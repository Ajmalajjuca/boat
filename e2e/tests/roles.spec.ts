import { apiAs } from '../support/api'
import { authFile, pocValue } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, openLot, openShipment } from '../support/ui'

async function seedRecords() {
  const seed = await seeder()
  const zulu = await seed.product('Zulu')
  const own = await seed.lot(zulu.id, 'Z-own', { poc: pocValue })
  const other = await seed.lot(zulu.id, 'Z-other', { poc: 'Omar Other' })
  await seed.shipment('INV-Z', { items: [{ productId: zulu.id, quantity: 5 }] })
  await seed.done()
  return { own, other }
}

test.describe('a viewer', () => {
  test.use({ storageState: authFile('viewer') })

  test('browses every screen without write controls', async ({ page }) => {
    await seedRecords()
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Add Product' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add lot' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'CSV' })).toBeVisible()
    const lot = await openLot(page, 'Z-own')
    await expect(lot).toContainText("View only. Viewer users can't change this lot.")
    await expect(lot.getByRole('button', { name: 'Save lot' })).toHaveCount(0)
    await lot.getByRole('button', { name: 'Close' }).first().click()
    await goTo(page, 'Finished Goods')
    await expect(page.getByRole('button', { name: 'Add Shipment' })).toHaveCount(0)
    const shipment = await openShipment(page, 'INV-Z')
    await expect(shipment.getByRole('button', { name: 'Save shipment' })).toHaveCount(0)
    await shipment.getByRole('button', { name: 'Close' }).first().click()
    await goTo(page, 'Settings')
    await expect(
      page.getByText('Values used in forms and filters. Only admins can change them.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export all records as JSON' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Import JSON backup' })).toHaveCount(0)
  })
})

test.describe('a planner', () => {
  test.use({ storageState: authFile('planner') })

  test('edits records but cannot delete lots or change Settings', async ({ page }) => {
    const { own } = await seedRecords()
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Add Product' })).toBeVisible()
    const lot = await openLot(page, 'Z-own')
    await expect(lot.getByRole('button', { name: 'Save lot' })).toBeVisible()
    await expect(lot.getByRole('button', { name: 'Delete lot' })).toHaveCount(0)
    await lot.getByRole('button', { name: 'Close' }).first().click()
    await goTo(page, 'Settings')
    await expect(page.getByRole('button', { name: 'Export all records as JSON' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import JSON backup' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0)
    const planner = await apiAs('planner')
    await expect(planner.delete(`/lots/${own.id}`)).rejects.toThrow(/answered 403/)
    await planner.dispose()
  })
})

test.describe('a POC user', () => {
  test.use({ storageState: authFile('poc') })

  test('updates progress on their own lots only', async ({ page }) => {
    const { own, other } = await seedRecords()
    await page.goto('/')
    const mine = await openLot(page, 'Z-own')
    await expect(mine.getByLabel('Lot quantity', { exact: true })).toBeDisabled()
    await mine.getByLabel('Follow-up note', { exact: true }).fill('Line booked for Monday')
    await mine.getByRole('button', { name: 'Save & close' }).click()
    await expect(mine).toBeHidden()
    const poc = await apiAs('poc')
    expect((await poc.get(`/lots/${own.id}`)).followUpNote).toBe('Line booked for Monday')

    const theirs = await openLot(page, 'Z-other')
    await expect(theirs).toContainText(
      "View only. POC users can't change this lot because its POC is Omar Other.",
    )
    await expect(theirs.getByRole('button', { name: 'Save lot' })).toHaveCount(0)
    // The server refuses the save the screen hides.
    await expect(
      poc.patch(`/lots/${other.id}`, { followUpNote: 'forced', version: other.version }),
    ).rejects.toThrow(/answered 403/)
    await poc.dispose()
  })
})
