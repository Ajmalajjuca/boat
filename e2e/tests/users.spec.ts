import type { Page } from '@playwright/test'
import { apiAs, googleSignInApi, newUser } from '../support/api'
import { authFile, pocValue, users } from '../support/env'
import { emailsTo, nextEmail } from '../support/mail'
import { expect, test } from '../support/test'
import { choose, goTo, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

const row = (page: Page, email: string) =>
  page.getByRole('table', { name: 'Users' }).getByRole('row').filter({ hasText: email })

async function openUsers(page: Page) {
  await page.goto('/')
  await goTo(page, 'Settings')
}

test('FR-11.5 adds a user, who shows as active once they sign in with Google', async ({ page }) => {
  const email = `invitee-${Date.now().toString(36)}@e2e.test`
  await openUsers(page)
  await page.getByRole('button', { name: 'Add user' }).click()
  const form = page.getByRole('dialog', { name: 'Add user' })
  await form.getByLabel('Name', { exact: true }).fill('Ivy Invitee')
  await form.getByLabel('Email', { exact: true }).fill(email)
  await form.getByLabel('Role', { exact: true }).selectOption('planner')
  await form.getByRole('button', { name: 'Add user' }).click()
  await expect(toast(page)).toContainText('Access email sent.')
  await expect(row(page, email)).toContainText('Invited')
  const mail = await nextEmail(email, 0)
  expect(mail.subject).toBe("You've been given access to BOAT")
  expect(mail.text).not.toContain('#token=')
  const { ctx } = await googleSignInApi(email)
  await ctx.dispose()
  // Screens aren't in the URL, so a reload starts on Production.
  await page.reload()
  await goTo(page, 'Settings')
  await expect(row(page, email)).toContainText('Active')
})

test('refuses an address outside the company domain', async ({ page }) => {
  await openUsers(page)
  await page.getByRole('button', { name: 'Add user' }).click()
  const form = page.getByRole('dialog', { name: 'Add user' })
  await form.getByLabel('Name', { exact: true }).fill('Out Side')
  await form.getByLabel('Email', { exact: true }).fill(`outside-${Date.now()}@gmail.com`)
  await form.getByRole('button', { name: 'Add user' }).click()
  await expect(form).toContainText('Use a company email address (e2e.test).')
})

test('edits a role and POC link', async ({ page }) => {
  const user = await newUser('viewer')
  await openUsers(page)
  await row(page, user.email).getByRole('button', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit user' })
  await form.getByLabel('Role', { exact: true }).selectOption('poc')
  await choose(form, 'Point of contact', pocValue)
  await form.getByRole('button', { name: 'Save user' }).click()
  await expect(row(page, user.email)).toContainText('POC')
  await expect(row(page, user.email)).toContainText(pocValue)
})

test('resends the access email', async ({ page }) => {
  const email = `resend-${Date.now().toString(36)}@e2e.test`
  const admin = await apiAs('admin')
  await admin.post('/users', { email, name: 'Rae Resend', role: 'viewer', pocId: null })
  await admin.dispose()
  await nextEmail(email, 0)
  await openUsers(page)
  await row(page, email).getByRole('button', { name: 'Resend access email' }).click()
  await expect(toast(page)).toContainText('Access email sent.')
  await expect.poll(() => emailsTo(email).length).toBe(2)
})

test('disables, re-enables and deletes a user', async ({ page }) => {
  const user = await newUser('viewer')
  await (await googleSignInApi(user.email)).ctx.dispose()
  await openUsers(page)
  await row(page, user.email).getByRole('button', { name: 'Disable' }).click()
  await expect(row(page, user.email)).toContainText('Disabled')
  await expect(googleSignInApi(user.email)).rejects.toThrow()
  await row(page, user.email).getByRole('button', { name: 'Enable' }).click()
  await expect(row(page, user.email)).toContainText('Active')
  await (await googleSignInApi(user.email)).ctx.dispose()
  await row(page, user.email).getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(row(page, user.email)).toHaveCount(0)
})

test('keeps the last admin', async ({ page }) => {
  await openUsers(page)
  await row(page, users.admin.email).getByRole('button', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit user' })
  await form.getByLabel('Role', { exact: true }).selectOption('planner')
  await form.getByRole('button', { name: 'Save user' }).click()
  await expect(form).toContainText(
    `${users.admin.name} is the last active admin. Make someone else an admin first.`,
  )
  const admin = await apiAs('admin')
  expect((await admin.get('/auth/me')).user.role).toBe('admin')
  await admin.dispose()
})
