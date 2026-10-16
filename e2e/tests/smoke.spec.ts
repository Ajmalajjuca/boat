import { apiAs } from '../support/api'
import { roleNames } from '../support/env'
import { expect, test } from '../support/test'

test('the API serves the web app, and each seeded user is signed in', async ({ request }) => {
  const page = await request.get('/')
  expect(page.ok()).toBe(true)
  expect(await page.text()).toContain('<div id="root"></div>')
  for (const role of roleNames) {
    const api = await apiAs(role)
    expect(api.me.user.role).toBe(role)
    await api.dispose()
  }
})
