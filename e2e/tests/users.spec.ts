import type { Page } from '@playwright/test'
import { acceptInvite, apiAs, newUser, signInApi } from '../support/api'
import { authFile, pocValue, users } from '../support/env'
import { emailsTo, nextEmail, tokenIn } from '../support/mail'
import { expect, test } from '../support/test'
import { choose, goTo, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

const row = (page: Page, email: string) =>
  page.getByRole('table', { name: 'Users' }).getByRole('row').filter({ hasText: email })

async function openUsers(page: Page) {
  await page.goto('/')
  await goTo(page, 'Settings')
}

test('invites a user, who shows as active once they accept', async ({ page }) => {
  const email = `invitee-${Date.now().toString(36)}@e2e.test`
  await openUsers(page)
  await page.getByRole('button', { name: 'Invite user' }).click()
  const form = page.getByRole('dialog', { name: 'Invite user' })
  await form.getByLabel('Name', { exact: true }).fill('Ivy Invitee')
  await form.getByLabel('Email', { exact: true }).fill(email)
  await form.getByLabel('Role', { exact: true }).selectOption('planner')
  await form.getByRole('button', { name: 'Send invite' }).click()
  await expect(toast(page)).toContainText(`Invite sent to ${email}.`)
  await expect(row(page, email)).toContainText('Invited')
  const { ctx } = await acceptInvite(tokenIn((await nextEmail(email, 0)).text))
  await ctx.dispose()
  // Screens aren't in the URL, so a reload starts on Production.
  await page.reload()
  await goTo(page, 'Settings')
  await expect(row(page, email)).toContainText('Active')
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

test('resends an invite', async ({ page }) => {
  const email = `resend-${Date.now().toString(36)}@e2e.test`
  const admin = await apiAs('admin')
  await admin.post('/users', { email, name: 'Rae Resend', role: 'viewer', pocId: null })
  await admin.dispose()
  await nextEmail(email, 0)
  await openUsers(page)
  await row(page, email).getByRole('button', { name: 'Resend invite' }).click()
  await expect(toast(page)).toContainText(`Invite sent to ${email}.`)
  await expect.poll(() => emailsTo(email).length).toBe(2)
})

test('disables, re-enables and deletes a user', async ({ page }) => {
  const user = await newUser('viewer')
  await openUsers(page)
  await row(page, user.email).getByRole('button', { name: 'Disable' }).click()
  await expect(row(page, user.email)).toContainText('Disabled')
  await expect(signInApi(user.email, user.password)).rejects.toThrow()
  await row(page, user.email).getByRole('button', { name: 'Enable' }).click()
  await expect(row(page, user.email)).toContainText('Active')
  await (await signInApi(user.email, user.password)).dispose()
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
