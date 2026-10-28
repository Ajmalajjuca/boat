import { readFileSync } from 'node:fs'
import path from 'node:path'
import { apiAs, googleSignInApi, newUser } from '../support/api'
import { runDir, users } from '../support/env'
import { expect, test } from '../support/test'
import { openMenu, signInWithGoogle } from '../support/ui'

const adminPassword = () =>
  (JSON.parse(readFileSync(path.join(runDir, 'seeded.json'), 'utf8')) as { adminPassword: string })
    .adminPassword

test('FR-11.5 a user the admin added signs in with Google, and out again', async ({ page }) => {
  const user = await newUser('planner')
  await page.goto('/')
  await page.getByRole('link', { name: 'Sign in with Google' }).click()
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await openMenu(page)
  await expect(page.getByText(user.name)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
})

test('FR-11.5 someone not added sees why they cannot get in', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Sign in with Google' }).click()
  await page.getByLabel('Email', { exact: true }).fill(`stranger-${Date.now()}@e2e.test`)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(
    page.getByText("This Google account hasn't been given access. Ask your admin to add you."),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
})

test('FR-11.6 the backup admin signs in with a password', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin password sign-in' }).click()
  await page.getByLabel('Email', { exact: true }).fill(users.admin.email)
  await page.getByLabel('Password', { exact: true }).fill(adminPassword())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await openMenu(page)
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible()
})

test('offers Google only once the server says it is set up', async ({ page }) => {
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/auth/options', async (route) => {
    await waiting
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Loading sign-in options' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveCount(0)
  release()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
})

test('FR-11.6 falls back to the admin password when sign-in options cannot load', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/options', (route) => route.abort())
  await page.goto('/')
  // The query retries before giving up.
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveCount(0)
})

test('shows the server message for a wrong password', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin password sign-in' }).click()
  await page.getByLabel('Email', { exact: true }).fill(users.admin.email)
  await page.getByLabel('Password', { exact: true }).fill('not the password at all')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()
})

test('returns to sign-in when the session ends', async ({ page }) => {
  const user = await newUser('viewer')
  await signInWithGoogle(page, user.email)
  // Signing out elsewhere doesn't end this session; disabling the user does.
  const other = await googleSignInApi(user.email)
  await other.ctx.dispose()
  const admin = await apiAs('admin')
  await admin.patch(`/users/${other.me.user.id}`, { status: 'disabled' })
  await admin.dispose()
  await page.getByRole('combobox', { name: 'Sort lots' }).selectOption('qty-desc')
  await expect(page.getByText('Your session ended. Sign in again.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
})
