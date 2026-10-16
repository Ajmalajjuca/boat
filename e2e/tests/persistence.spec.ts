import { authFile } from '../support/env'
import { expect, test } from '../support/test'

test.use({ storageState: authFile('admin') })

test('a refresh, and another user, see the same records', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Product' }).click()
  const add = page.getByRole('dialog', { name: 'Add product' })
  await add.getByLabel('Product name', { exact: true }).fill('Kept Product')
  await add.getByRole('button', { name: 'Save product' }).click()
  await expect(page.getByRole('group', { name: 'Kept Product' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Kept Product' })).toBeVisible()

  const other = await browser.newContext({
    storageState: authFile('viewer'),
    viewport: page.viewportSize(),
  })
  const viewer = await other.newPage()
  await viewer.goto('/')
  await expect(viewer.getByRole('group', { name: 'Kept Product' })).toBeVisible()
  await other.close()
})
