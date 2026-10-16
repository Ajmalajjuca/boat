import { authFile } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { choose, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

test('FR-1.1 adds, renames and deletes a product', async ({ page }) => {
  const seed = await seeder()
  await seed.lookup('segment', 'Soundbars')
  await seed.done()
  await page.goto('/')
  const list = page.getByRole('main')
  await page.getByRole('button', { name: 'Add Product' }).click()
  const add = page.getByRole('dialog', { name: 'Add product' })
  await add.getByLabel('Product name', { exact: true }).fill('CinemaBar 420')
  await add.getByLabel('Variant', { exact: true }).fill('Matte Black')
  await choose(add, 'Segment', 'Soundbars')
  await add.getByRole('button', { name: 'Save product' }).click()
  await expect(toast(page)).toContainText('Product CinemaBar 420 saved.')
  const group = list.getByRole('group', { name: 'CinemaBar 420 Matte Black' })
  await expect(group).toContainText('Soundbars · 0 lots')

  await group.getByRole('button', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit product' })
  await edit.getByLabel('Product name', { exact: true }).fill('CinemaBar 520')
  await edit.getByRole('button', { name: 'Save product' }).click()
  await expect(list.getByRole('group', { name: 'CinemaBar 520 Matte Black' })).toBeVisible()

  await list
    .getByRole('group', { name: 'CinemaBar 520 Matte Black' })
    .getByRole('button', { name: 'Edit' })
    .click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete product' }).click()
  await expect(list.getByText('No products yet')).toBeVisible()
})

test('FR-1.1 shows a duplicate product under its name', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Echo', { variant: 'Black' })
  await seed.done()
  await page.goto('/')
  await page.getByRole('button', { name: 'Add Product' }).click()
  const add = page.getByRole('dialog', { name: 'Add product' })
  await add.getByLabel('Product name', { exact: true }).fill('echo')
  await add.getByLabel('Variant', { exact: true }).fill('black')
  await add.getByRole('button', { name: 'Save product' }).click()
  await expect(add.getByRole('alert')).toContainText(
    'already exists. Use a different name or variant.',
  )
})

test('FR-1.1 shows the conflict banner when someone else saved the product first', async ({
  page,
}) => {
  const seed = await seeder()
  const product = await seed.product('Foxtrot')
  await page.goto('/')
  await page.getByRole('group', { name: 'Foxtrot' }).getByRole('button', { name: 'Edit' }).click()
  await seed.api.patch(`/products/${product.id}`, { variant: 'Blue', version: product.version })
  await seed.done()
  const edit = page.getByRole('dialog', { name: 'Edit product' })
  await edit.getByLabel('Product name', { exact: true }).fill('Foxtrot Pro')
  await edit.getByRole('button', { name: 'Save product' }).click()
  await expect(edit.getByRole('alert')).toContainText(
    'Someone else changed this product while you were editing.',
  )
  await edit.getByRole('button', { name: 'Reload' }).click()
  await expect(edit.getByLabel('Product name', { exact: true })).toHaveValue('Foxtrot')
  await expect(edit.getByLabel('Variant', { exact: true })).toHaveValue('Blue')
})
