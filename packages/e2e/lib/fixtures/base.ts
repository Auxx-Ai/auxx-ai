// packages/e2e/lib/fixtures/base.ts
import { test as base } from '@playwright/test'
import { ConfirmationModal } from '../pom/helper/confirmation-modal'
import { MainPage } from '../pom/main-page'
import { SettingsPage } from '../pom/settings-page'
import { SettingsSidebar } from '../pom/settings-sidebar'
import { Sidebar } from '../pom/sidebar'

type Fixtures = {
  sidebar: Sidebar
  mainPage: MainPage
  confirmationModal: ConfirmationModal
  settingsSidebar: SettingsSidebar
  settingsPage: SettingsPage
}

export const test = base.extend<Fixtures>({
  sidebar: async ({ page }, use) => {
    await use(new Sidebar(page))
  },
  mainPage: async ({ page }, use) => {
    await use(new MainPage(page))
  },
  confirmationModal: async ({ page }, use) => {
    await use(new ConfirmationModal(page))
  },
  settingsSidebar: async ({ page }, use) => {
    await use(new SettingsSidebar(page))
  },
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page))
  },
})

export { expect } from '@playwright/test'
