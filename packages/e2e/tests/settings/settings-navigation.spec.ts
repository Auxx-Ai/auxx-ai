// packages/e2e/tests/settings/settings-navigation.spec.ts
import { expect, test } from '../../lib/fixtures/base'
import { SETTINGS_PAGES, type SettingsPageLabel } from '../../lib/pom/settings-sidebar'

test.describe('Settings Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/settings')
    // /settings redirects to /settings/general — wait for it
    await page.waitForURL('**/app/settings/general')
  })

  test('redirects /settings to /settings/general', async ({ page }) => {
    await expect(page).toHaveURL(/\/app\/settings\/general/)
  })

  test('settings sidebar is visible with all sections', async ({ settingsSidebar }) => {
    const links = await settingsSidebar.getVisibleLinks()

    // Core settings links should always be visible
    expect(links).toContain('General')
    expect(links).toContain('Organization')
    expect(links).toContain('Snippets')
    expect(links).toContain('Signatures')
    expect(links).toContain('API Keys')
  })

  test('General page loads with correct title', async ({ settingsPage }) => {
    await settingsPage.waitForLoaded()
    const title = await settingsPage.getTitle()
    expect(title).toBe('General')
  })

  test('active link is highlighted for current page', async ({ settingsSidebar }) => {
    const isActive = await settingsSidebar.isLinkActive('General')
    expect(isActive).toBe(true)
  })

  // Navigate to each settings page and verify it loads
  const settingsPages: { label: SettingsPageLabel; title: string }[] = [
    { label: 'General', title: 'General' },
    { label: 'Organization', title: 'Organization' },
    { label: 'Snippets', title: 'Snippets' },
    { label: 'Signatures', title: 'Email Signatures' },
    { label: 'API Keys', title: 'API Keys' },
  ]

  for (const { label, title } of settingsPages) {
    test(`navigates to ${label} page`, async ({ settingsSidebar, settingsPage, page }) => {
      await settingsSidebar.navigateTo(label)
      await settingsPage.waitForLoaded()

      const pageTitle = await settingsPage.getTitle()
      expect(pageTitle).toBe(title)
      await expect(page).toHaveURL(new RegExp(`/app/settings/${SETTINGS_PAGES[label]}`))
    })
  }
})

test.describe('Settings Navigation - Admin pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/settings')
    await page.waitForURL('**/app/settings/general')
  })

  const adminPages: { label: SettingsPageLabel; title: string }[] = [
    { label: 'Members', title: 'Members' },
    { label: 'Groups', title: 'Member groups' },
    { label: 'Inboxes', title: 'Inboxes' },
    { label: 'AI Models', title: 'AI Models' },
    { label: 'Custom Entities & Fields', title: 'Custom Entities & Fields' },
    { label: 'Tags', title: 'Company Tags' },
    { label: 'Import History', title: 'Import History' },
  ]

  for (const { label, title } of adminPages) {
    test(`navigates to admin ${label} page`, async ({ settingsSidebar, settingsPage, page }) => {
      await settingsSidebar.navigateTo(label)
      await settingsPage.waitForLoaded()

      const pageTitle = await settingsPage.getTitle()
      expect(pageTitle).toBe(title)
      await expect(page).toHaveURL(new RegExp(`/app/settings/${SETTINGS_PAGES[label]}`))
    })
  }

  const integrationPages: { label: SettingsPageLabel; title: string }[] = [
    { label: 'Integrations', title: 'Integrations' },
    { label: 'Apps', title: 'Marketplace' },
    { label: 'Webhooks', title: 'Webhooks' },
    { label: 'Shopify', title: 'Shopify Integration' },
  ]

  for (const { label, title } of integrationPages) {
    test(`navigates to integration ${label} page`, async ({
      settingsSidebar,
      settingsPage,
      page,
    }) => {
      await settingsSidebar.navigateTo(label)
      await settingsPage.waitForLoaded()

      const pageTitle = await settingsPage.getTitle()
      expect(pageTitle).toBe(title)
      await expect(page).toHaveURL(new RegExp(`/app/settings/${SETTINGS_PAGES[label]}`))
    })
  }
})
