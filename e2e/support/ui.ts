import { expect, type Locator, type Page } from '@playwright/test'

// Google sign-in in the browser: the start route sends the page to @boat/oidc-stub's account
// chooser, which sends it back through the callback to the app.
export async function signInWithGoogle(page: Page, email: string) {
  await page.goto('/api/v1/auth/google/start')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
}

export async function signInWithForm(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
}

// Below the lg breakpoint the sidebar, with the profile card, is a slide-out menu.
export async function openMenu(page: Page) {
  // The workspace may still be loading; the menu button sits beside its screen title.
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  const open = page.getByRole('button', { name: 'Open navigation' })
  if (await open.isVisible()) await open.click()
}

export async function goTo(page: Page, screen: string) {
  await openMenu(page)
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: screen })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: screen })).toBeVisible()
}

// Picks an option in a SearchSelect field. Its <label> also holds the chosen value, so the field is
// found by its caption rather than by label text. The list renders inside the same dialog.
export async function choose(scope: Page | Locator, label: string, option: string) {
  const page = 'page' in scope ? scope.page() : scope
  const caption = page.locator('.field-label').getByText(label, { exact: true })
  await scope.locator('label').filter({ has: caption }).getByRole('button').first().click()
  await scope.getByRole('option', { name: option, exact: true }).click()
}

export const toast = (page: Page) => page.locator('[data-toast]')

// Searching expands the product that holds the lot. Desktop lists lots in a table, mobile in
// cards; only one of them is visible.
export async function openLot(page: Page, label: string) {
  await page.getByRole('textbox', { name: 'Search product, variant, or lot' }).fill(label)
  await page.getByRole('main').getByText(label, { exact: true }).filter({ visible: true }).click()
  const drawer = page.getByRole('dialog', { name: label })
  await expect(drawer).toBeVisible()
  return drawer
}

// Shipments show as table rows on desktop and as cards on mobile.
export async function openShipment(page: Page, number: string) {
  await page.getByRole('textbox', { name: 'Search shipments' }).fill(number)
  await page.getByRole('main').getByText(number, { exact: true }).filter({ visible: true }).click()
  const drawer = page.getByRole('dialog', { name: number })
  await expect(drawer).toBeVisible()
  return drawer
}
