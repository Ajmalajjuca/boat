import { apiAs, newUser, signInApi } from '../support/api'
import { emailsTo, linkIn, nextEmail } from '../support/mail'
import { expect, test } from '../support/test'
import { openMenu, signInWithForm, toast } from '../support/ui'

test('FR-10.2 signs in with email and password, and out again', async ({ page }) => {
  const user = await newUser('planner')
  await signInWithForm(page, user.email, user.password)
  await openMenu(page)
  await expect(page.getByText(user.name)).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('FR-10.2 shows the server message for a wrong password', async ({ page }) => {
  const user = await newUser('viewer')
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('not the password at all')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()
})

test('FR-10.1 accepts an invite from the emailed link, once', async ({ page }) => {
  const admin = await apiAs('admin')
  const email = `invitee-${Date.now().toString(36)}@e2e.test`
  await admin.post('/users', { email, name: 'Ivy Invitee', role: 'viewer', pocId: null })
  await admin.dispose()
  const link = linkIn((await nextEmail(email, 0)).text)
  await page.goto(link)
  // The token leaves the address bar as soon as the page has read it.
  await expect(page).toHaveURL(/\/invite$/)
  await page.getByLabel('New password', { exact: true }).fill('a brand new password')
  await page.getByLabel('Confirm password', { exact: true }).fill('a brand new password')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)

  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill('another new password')
  await page.getByLabel('Confirm password', { exact: true }).fill('another new password')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(
    page.getByText(
      'This invite link has expired or was already used. Ask an admin to send a new one.',
    ),
  ).toBeVisible()
})

test('FR-10.2 resets a forgotten password from the emailed link', async ({ page }) => {
  const user = await newUser('viewer')
  await page.goto('/')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  const seen = emailsTo(user.email).length
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(
    page.getByText('If that email belongs to an active account, a reset link is on its way.'),
  ).toBeVisible()
  await page.goto(linkIn((await nextEmail(user.email, seen)).text))
  await expect(page).toHaveURL(/\/reset-password$/)
  await page.getByLabel('New password', { exact: true }).fill('a reset password here')
  await page.getByLabel('Confirm password', { exact: true }).fill('a reset password here')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed. Sign in with your new password.')).toBeVisible()
  await signInWithForm(page, user.email, 'a reset password here')
})

test('FR-10.2 changes your own password and keeps you signed in', async ({ page }) => {
  const user = await newUser('planner')
  await signInWithForm(page, user.email, user.password)
  await openMenu(page)
  await page.getByRole('button', { name: 'Change password' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change password' })
  await dialog.getByLabel('Current password', { exact: true }).fill('wrong current password')
  await dialog.getByLabel('New password', { exact: true }).fill('a changed password')
  await dialog.getByLabel('Confirm password', { exact: true }).fill('a changed password')
  await dialog.getByRole('button', { name: 'Save password' }).click()
  await expect(dialog.getByText('That is not your current password.')).toBeVisible()
  await dialog.getByLabel('Current password', { exact: true }).fill(user.password)
  await dialog.getByRole('button', { name: 'Save password' }).click()
  await expect(toast(page)).toContainText('Password changed.')
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await (await signInApi(user.email, 'a changed password')).dispose()
})

test('returns to sign-in when the session ends', async ({ page }) => {
  const user = await newUser('viewer')
  await signInWithForm(page, user.email, user.password)
  // Changing the password elsewhere ends the user's other sessions, including this page's.
  const other = await signInApi(user.email, user.password)
  await other.patch('/auth/me/password', {
    currentPassword: user.password,
    newPassword: 'a password set elsewhere',
  })
  await other.dispose()
  await page.getByRole('combobox', { name: 'Sort lots' }).selectOption('qty-desc')
  await expect(page.getByText('Your session ended. Sign in again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
