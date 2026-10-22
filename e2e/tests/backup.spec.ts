import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { authFile, repo } from '../support/env'
import { seeder } from '../support/seed'
import { expect, test } from '../support/test'
import { goTo, toast } from '../support/ui'

test.use({ storageState: authFile('admin') })

const sample = path.join(repo, 'docs/sample-test-backup.json')

async function openImport(page: Page) {
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Import JSON backup' }).click()
  return page.getByRole('dialog', { name: 'Import JSON backup' })
}

test('FR-9.1 exports every record as a JSON backup', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Victor')
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Settings')
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export all records as JSON' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^boat-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const backup = JSON.parse(readFileSync(await file.path(), 'utf8'))
  expect(backup.data.products.map((p: { name: string }) => p.name)).toContain('Victor')
})

test('FR-9.3 merges the sample backup into the current records', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Whiskey')
  await seed.done()
  const dialog = await openImport(page)
  await dialog.getByLabel('Backup file', { exact: true }).setInputFiles(sample)
  await expect(dialog).toContainText('sample-test-backup.json')
  await dialog.getByRole('button', { name: 'Import records' }).click()
  await expect(toast(page)).toContainText('Merged 4 products, 4 lots, and 3 shipments.')
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: /^Test EchoPods Lite/ })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Whiskey' })).toBeVisible()
})

test('FR-9.3 replaces the current records with the sample backup', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Xray')
  await seed.done()
  const dialog = await openImport(page)
  await dialog.getByLabel('Backup file', { exact: true }).setInputFiles(sample)
  await dialog.getByRole('radio', { name: /^Replace/ }).check()
  await dialog.getByRole('button', { name: 'Import records' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(toast(page)).toContainText('Replaced 4 products, 4 lots, and 3 shipments.')
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: /^Test EchoPods Lite/ })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Xray' })).toHaveCount(0)
})

test('FR-9.3 checks a backup in the browser before uploading it', async ({ page }) => {
  const dialog = await openImport(page)
  await dialog.getByLabel('Backup file', { exact: true }).setInputFiles({
    name: 'not-a-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"app":"Something else"}'),
  })
  await expect(dialog).toContainText('Unsupported JSON backup or schema version.')
  await expect(dialog.getByRole('button', { name: 'Import records' })).toBeDisabled()
})

test('FR-9.2 resets the records after the typed phrase', async ({ page }) => {
  const seed = await seeder()
  await seed.product('Yankee')
  await seed.done()
  await page.goto('/')
  await goTo(page, 'Settings')
  await page.getByRole('button', { name: 'Reset all application data' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reset all data' })
  const confirm = dialog.getByRole('button', { name: 'Reset all data' })
  await dialog.getByLabel('Type RESET ALL DATA to confirm', { exact: true }).fill('reset')
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Type RESET ALL DATA to confirm', { exact: true }).fill('RESET ALL DATA')
  await confirm.click()
  await expect(toast(page)).toContainText('Deleted 1 products, 0 lots and 0 shipments.')
  await goTo(page, 'Production Tracker')
  await expect(page.getByRole('group', { name: 'Yankee' })).toHaveCount(0)
})
