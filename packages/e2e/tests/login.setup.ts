// packages/e2e/tests/login.setup.ts
import { test as setup } from '@playwright/test'
import { LoginPage } from '../lib/pom/login-page'

const authFile = '.auth/user.json'

setup('authenticate', async ({ page }) => {
  const loginPage = new LoginPage(page)
  await loginPage.goto()
  await loginPage.login(process.env.DEFAULT_LOGIN!, process.env.DEFAULT_PASSWORD!)

  // Wait for redirect to authenticated area
  await page.waitForURL('**/app/**')

  // Save signed-in state
  await page.context().storageState({ path: authFile })
})
