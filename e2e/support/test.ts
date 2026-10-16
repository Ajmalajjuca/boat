import { test as base } from '@playwright/test'
import { resetData } from './api'

// Every test starts with no records. Users, dropdown values and settings stay.
export const test = base.extend<{ freshData: void }>({
  freshData: [
    async ({}, use) => {
      await resetData()
      await use()
    },
    { auto: true },
  ],
})
export { expect } from '@playwright/test'
