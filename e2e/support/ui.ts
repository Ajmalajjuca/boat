import { expect, type Locator, type Page } from '@playwright/test'

export async function signInWithForm(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
}

// Below the lg breakpoint the sidebar, with the profile card, is a slide-out menu.
export async function openMenu(page: Page) {
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

// Picks an option in a SearchSelect field. Its list renders inside the same dialog.
export async function choose(scope: Page | Locator, label: string, option: string) {
  await scope.getByLabel(label, { exact: true }).click()
  await scope.getByRole('option', { name: option, exact: true }).click()
}

export const toast = (page: Page) => page.locator('[data-toast]')
