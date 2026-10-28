import { authFile } from '../support/env'
import { day, seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { openLot } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-2.1 adds a lot to a product, then edits and deletes it', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Golf')
  // A new lot takes the first stage; on a fresh database no other spec has created one yet.
  await seed.lookup('stage', 'RM Sourcing')
  await seed.done()
  await page.goto('/')
  const golf = page.getByRole('group', { name: 'Golf' })
  await golf.getByRole('button', { name: 'Add lot' }).click()
  const added = page.getByRole('dialog', { name: 'New production lot' })
  await added.getByLabel('Lot label', { exact: true }).fill('G-100')
  await added.getByLabel('Lot quantity', { exact: true }).fill('250')
  await added.getByRole('button', { name: 'Save lot' }).click()
  // A saved lot reopens by id, so the drawer now carries its label.
  const saved = page.getByRole('dialog', { name: 'G-100' })
  await expect(saved).toBeVisible()
  await saved.getByRole('button', { name: 'Close' }).first().click()
  await expect(golf).toContainText('1 lot')

  const edit = await openLot(page, 'G-100')
  await edit.getByLabel('Lot quantity', { exact: true }).fill('300')
  await edit.getByRole('button', { name: 'Save & close' }).click()
  await expect(edit).toBeHidden()
  await expect(golf).toContainText(/Qty\s*300/)

  const remove = await openLot(page, 'G-100')
  await remove.getByRole('button', { name: 'Delete lot' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(remove).toBeHidden()
  // That message is for a lot someone else deleted.
  await page.waitForTimeout(1000)
  await expect(page.getByText('This lot was deleted.')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill('')
  await expect(golf).toContainText('0 lots')
})

test('FR-2.3 shows validation messages under their fields', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  await drawer.getByLabel('Lot quantity', { exact: true }).fill('2.5')
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  await expect(
    drawer.locator('[data-invalid]').filter({ hasText: 'Lot quantity' }).getByRole('alert'),
  ).toHaveText('Lot quantity must be a whole number, zero or more.')
})

test('FR-2.1 shows a duplicate lot label under the label field', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  await page.getByRole('group', { name: 'Golf' }).getByRole('button', { name: 'Add lot' }).click()
  const drawer = page.getByRole('dialog', { name: 'New production lot' })
  await drawer.getByLabel('Lot label', { exact: true }).fill('g-1')
  await drawer.getByLabel('Lot quantity', { exact: true }).fill('10')
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  // Only the server knows the other lots, so this message comes from a 422 on `label`, and it
  // must land in the Lot label field rather than the form-level error.
  await expect(
    drawer.locator('[data-invalid]').filter({ hasText: 'Lot label' }).getByRole('alert'),
  ).toContainText('This product already has a lot labelled')
})

test('FR-7.2 posts a note and lists it in the history', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  await drawer.getByRole('tab', { name: 'Updates & History' }).click()
  await drawer.getByLabel('Update note', { exact: true }).fill('EMS confirmed the line slot')
  await drawer.getByRole('button', { name: 'Post update' }).click()
  await expect(drawer.getByText('EMS confirmed the line slot')).toBeVisible()
  await expect(drawer.getByText(/Ada Admin/).first()).toBeVisible()
  await expect(drawer.getByLabel('Update note', { exact: true })).toHaveValue('')
})

test('FR-11.1 shows the date errors next to the fields', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  await drawer.getByLabel('Actual date', { exact: true }).fill(day(1))
  await drawer.getByLabel('Current revised ETA', { exact: true }).fill(day(-1))
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  await expect(
    drawer.locator('[data-invalid]').filter({ hasText: 'Actual date' }).getByRole('alert'),
  ).toHaveText('Actual date cannot be in the future.')
  await expect(
    drawer.locator('[data-invalid]').filter({ hasText: 'Current revised ETA' }).getByRole('alert'),
  ).toHaveText('Current revised ETA cannot be before today.')
})

test('FR-11.1 greys out the dates the rules refuse in the date pickers', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  const date = (label: string) => drawer.getByLabel(label, { exact: true })
  await expect(date('RM ready date at factory')).toHaveAttribute('min', day(0))
  await expect(date('Planned completion / WH receipt')).toHaveAttribute('min', day(0))
  await expect(date('Current revised ETA')).toHaveAttribute('min', day(0))
  await expect(date('Actual date')).toHaveAttribute('max', day(0))
  // Forecast dates can't be before the RM ready date either.
  await date('RM ready date at factory').fill(day(5))
  await expect(date('Planned completion / WH receipt')).toHaveAttribute('min', day(5))
  await expect(date('Current revised ETA')).toHaveAttribute('min', day(5))
})

test('closes the drawer when someone else deleted the lot', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  const lot = await seed.lot(golf.id, 'G-1')
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  await seed.api.delete(`/lots/${lot.id}`)
  await seed.done()
  await drawer.getByLabel('Lot quantity', { exact: true }).fill('120')
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByText('This lot was deleted.')).toBeVisible()
})

test('keeps what is typed while a save is still on its way', async ({ page }) => {
  const seed = await seeder()
  const golf = await seed.product('Golf')
  await seed.lot(golf.id, 'G-1')
  await seed.done()
  await page.goto('/')
  const drawer = await openLot(page, 'G-1')
  // Hold the save for a second, as a slow connection would.
  await page.route('**/api/v1/lots/*', async (route) => {
    if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1000))
    await route.continue()
  })
  await drawer.getByLabel('Follow-up note', { exact: true }).fill('Call the EMS')
  await drawer.getByRole('button', { name: 'Save lot' }).click()
  await drawer.getByLabel('Blocker description', { exact: true }).fill('Typed during the save')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await expect(drawer.getByLabel('Blocker description', { exact: true })).toHaveValue(
    'Typed during the save',
  )
  await expect(drawer.getByLabel('Follow-up note', { exact: true })).toHaveValue('Call the EMS')
})
