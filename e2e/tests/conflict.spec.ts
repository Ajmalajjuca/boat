import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-2.1 a second editor sees the conflict banner, keeps editing, then reloads', async ({
  page,
  browser,
}) => {
  const seed = await seeder()
  const hotel = await seed.product('Hotel')
  const lot = await seed.lot(hotel.id, 'H-1', { lotQty: 100 })
  const other = await browser.newContext({
    storageState: authFile('planner'),
    viewport: page.viewportSize(),
  })
  const second = await other.newPage()
  await page.goto('/')
  await second.goto('/')

  // The first editor has unsaved changes before the second one saves.
  const mine = await openLot(page, 'H-1')
  await mine.getByLabel('Follow-up note', { exact: true }).fill('Call the EMS')
  const theirs = await openLot(second, 'H-1')
  await theirs.getByLabel('Lot quantity', { exact: true }).fill('120')
  await theirs.getByRole('button', { name: 'Save lot' }).click()
  await expect.poll(async () => (await seed.api.get(`/lots/${lot.id}`)).lotQty).toBe(120)

  await mine.getByRole('button', { name: 'Save lot' }).click()
  const banner = mine
    .getByRole('alert')
    .filter({ hasText: 'Someone else changed this lot while you were editing.' })
  await expect(banner).toBeVisible()
  await expect(mine.getByLabel('Follow-up note', { exact: true })).toHaveValue('Call the EMS')

  // Keeping the edits doesn't make the stale version saveable.
  await banner.getByRole('button', { name: 'Keep editing' }).click()
  await expect(banner).toHaveCount(0)
  await mine.getByRole('button', { name: 'Save lot' }).click()
  await expect(banner).toBeVisible()

  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(mine.getByLabel('Lot quantity', { exact: true })).toHaveValue('120')
  await expect(mine.getByLabel('Follow-up note', { exact: true })).toHaveValue('')
  await mine.getByLabel('Follow-up note', { exact: true }).fill('Call the EMS')
  await mine.getByRole('button', { name: 'Save lot' }).click()
  await expect
    .poll(async () => (await seed.api.get(`/lots/${lot.id}`)).followUpNote)
    .toBe('Call the EMS')
  await other.close()
  await seed.done()
})
