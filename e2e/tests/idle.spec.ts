import { newUser } from '../support/api'
import { expect, test } from '../support/test'
import { signInWithGoogle } from '../support/ui'

// Each test signs in a user of its own: idle sign-out ends the session it signed in with.
test('FR-10.2 signs out after the idle timeout', async ({ page }) => {
  const user = await newUser('viewer')
  await page.clock.install()
  await signInWithGoogle(page, user.email)
  await page.clock.fastForward('16:00')
  await expect(page.getByText('Signed out after 15 minutes without activity.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible()
})

test('FR-10.2 keeps you signed in while you are active', async ({ page }) => {
  const user = await newUser('viewer')
  await page.clock.install()
  await signInWithGoogle(page, user.email)
  await page.clock.fastForward('10:00')
  await page.keyboard.press('Shift')
  await page.clock.fastForward('10:00')
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
})

test('FR-10.2 activity in another tab keeps every tab signed in', async ({ browser }) => {
  const user = await newUser('viewer')
  const context = await browser.newContext()
  await context.clock.install()
  const first = await context.newPage()
  await signInWithGoogle(first, user.email)
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await context.clock.fastForward('10:00')
  await second.keyboard.press('Shift')
  await context.clock.fastForward('10:00')
  // Let the first tab's idle check run a few more times and finish any sign-out it starts.
  await context.clock.runFor(60_000)
  await first.waitForTimeout(500)
  await expect(first.getByText(/Signed out after/)).toHaveCount(0)
  // Reloading needs the shared session, so this fails if the first tab ended it.
  await second.reload()
  await expect(second.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
  await context.close()
})
