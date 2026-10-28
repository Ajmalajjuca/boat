import { authFile } from '../support/env'
import { expect, test } from '../support/test'
import { goTo, openMenu } from '../support/ui'

test('password visibility preserves the value and sign-in shows progress', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Boat OS/)
  await expect(page.getByRole('img', { name: 'boAt' })).toBeVisible()
  // Google is the default; the password form is the backup admin's.
  await page.getByRole('button', { name: 'Admin password sign-in' }).click()
  const password = page.getByLabel('Password', { exact: true })
  await password.fill('a private password')
  await page.getByRole('button', { name: 'Show password', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('a private password')
  await page.getByRole('button', { name: 'Hide password', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByLabel('Email', { exact: true }).fill('missing@e2e.test')
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/auth/login', async (route) => {
    await waiting
    await route.fulfill({
      status: 401,
      json: { error: 'invalid_credentials', message: 'Email or password is incorrect.' },
    })
  })
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
  release()
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.')
})

test.describe('workspace feedback', () => {
  test.use({ storageState: authFile('admin') })

  test('shows a loading skeleton while lots are fetched', async ({ page }) => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/lots/groups?*', async (route) => {
      await waiting
      await route.continue()
    })
    await page.goto('/')
    await expect(page.getByRole('status', { name: 'Loading lots' })).toBeVisible()
    release()
    await expect(page.getByRole('status', { name: 'Loading lots' })).toHaveCount(0)
  })

  test('users have their own table and delete can be cancelled', async ({ page }) => {
    await page.goto('/')
    await goTo(page, 'Settings')
    const table = page.getByRole('table', { name: 'Users' })
    await expect(table.getByRole('columnheader', { name: 'Role', exact: true })).toBeVisible()
    // The last-admin rule still belongs to the server; cancelling must never reach it.
    const first = table.getByRole('row').nth(1)
    const name = await first.getByRole('cell').first().textContent()
    await first.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toContainText('They will no longer be able to sign in.')
    await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(first.getByRole('button', { name: 'Delete', exact: true })).toBeFocused()
    await expect(first).toContainText(name!)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.getByRole('region', { name: 'User accounts' }).evaluate((element) => {
      element.scrollLeft = 0
    })
    await page.screenshot({
      path: `/tmp/boat-os-settings-${test.info().project.name}.png`,
      fullPage: true,
    })
  })

  test('each change-password field can be revealed independently', async ({ page }) => {
    await page.goto('/')
    await openMenu(page)
    await page.getByRole('button', { name: 'Change password', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Change password' })
    const current = dialog.getByLabel('Current password', { exact: true })
    await current.fill('private current value')
    await dialog.getByRole('button', { name: 'Show current password', exact: true }).click()
    await expect(current).toHaveAttribute('type', 'text')
    await expect(dialog.getByLabel('New password', { exact: true })).toHaveAttribute(
      'type',
      'password',
    )
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await openMenu(page)
    await page.getByRole('button', { name: 'Change password', exact: true }).click()
    await expect(page.getByLabel('Current password', { exact: true })).toHaveAttribute(
      'type',
      'password',
    )
  })

  test('discard confirmation keeps edits on cancel and discards them on confirm', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add Product', exact: true }).click()
    const product = page.getByRole('dialog', { name: 'Add product', exact: true })
    await product.getByLabel('Product name', { exact: true }).fill('Unsaved product')
    await product.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(product.getByLabel('Product name', { exact: true })).toHaveValue('Unsaved product')
    await expect(product.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click()
    await expect(product).toHaveCount(0)
  })
})
