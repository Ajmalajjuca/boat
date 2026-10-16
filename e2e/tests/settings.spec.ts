import { authFile } from '../support/env'
import { apiAs } from '../support/api'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-8.1 adds, renames and deletes a dropdown value', async ({ page }) => {
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Logistics modes' }).click()
  await page.getByLabel('New logistics mode', { exact: true }).fill('Hyperloop')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('main').getByText('Hyperloop', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rename Hyperloop' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename dropdown value' })
  await rename.getByLabel('Value', { exact: true }).fill('Hyperloop Freight')
  await rename.getByRole('button', { name: 'Save value' }).click()
  await expect(page.getByRole('main').getByText('Hyperloop Freight', { exact: true })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete Hyperloop Freight' }).click()
  await expect(page.getByRole('main').getByText('Hyperloop Freight', { exact: true })).toHaveCount(
    0,
  )
})

test('FR-8.3 refuses to delete a value in use', async ({ page }) => {
  const seed = await seeder()
  const uniform = await seed.product('Uniform')
  await seed.lot(uniform.id, 'U-1', { logistics: 'Barge' })
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Logistics modes' }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete Barge' }).click()
  await expect(toast(page)).toContainText('Barge is in use. Reassign those records first.')
})

test('saves the idle sign-out time', async ({ page }) => {
  await page.goto('/')
  await goTo(page, 'Settings')
  try {
    await page.getByLabel('Idle sign-out (minutes)', { exact: true }).fill('30')
    await page.getByRole('button', { name: 'Save sign-in settings' }).click()
    await expect(toast(page)).toContainText('Settings saved.')
    const admin = await apiAs('admin')
    expect((await admin.get('/settings')).idleTimeoutMinutes).toBe(30)
    await admin.dispose()
  } finally {
    const admin = await apiAs('admin')
    await admin.patch('/settings', { idleTimeoutMinutes: 15 })
    await admin.dispose()
  }
})
