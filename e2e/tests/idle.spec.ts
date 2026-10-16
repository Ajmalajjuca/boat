import { newUser } from '../support/api'
import { expect, test } from '../support/test'
import { signInWithForm } from '../support/ui'

// Each test signs in a user of its own: idle sign-out ends the session it signed in with.
test('FR-10.2 signs out after the idle timeout', async ({ page }) => {
  const user = await newUser('viewer')
  await page.clock.install()
  await signInWithForm(page, user.email, user.password)
  await page.clock.fastForward('16:00')
  await expect(page.getByText('Signed out after 15 minutes without activity.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('FR-10.2 keeps you signed in while you are active', async ({ page }) => {
  const user = await newUser('viewer')
  await page.clock.install()
  await signInWithForm(page, user.email, user.password)
  await page.clock.fastForward('10:00')
  await page.keyboard.press('Shift')
  await page.clock.fastForward('10:00')
  await expect(page.getByRole('heading', { name: 'Production Tracker' })).toBeVisible()
})
