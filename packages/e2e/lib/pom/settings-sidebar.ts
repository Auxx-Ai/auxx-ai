// packages/e2e/lib/pom/settings-sidebar.ts
import type { Locator, Page } from '@playwright/test'

/**
 * All navigable settings pages derived from SETTINGS_MENU.
 * Keys match the sidebar link labels exactly.
 */
export const SETTINGS_PAGES = {
  // Settings section
  General: 'general',
  Organization: 'organization',
  Snippets: 'snippets',
  Signatures: 'signatures',
  'API Keys': 'apiKeys',
  // Channels section (admin)
  Channels: 'channels',
  Apps: 'apps',
  Webhooks: 'webhooks',
  Shopify: 'shopify',
  // Admin section
  Members: 'members',
  Groups: 'groups',
  Inboxes: 'inbox',
  'AI Models': 'aiModels',
  'Custom Entities & Fields': 'custom-fields',
  Tags: 'tags',
  'Import History': 'import-history',
  'Plans & Billing': 'plans',
} as const

export type SettingsPageLabel = keyof typeof SETTINGS_PAGES

export class SettingsSidebar {
  private readonly container: Locator

  constructor(private readonly page: Page) {
    this.container = page.locator('#dropdown')
  }

  /** Get a link locator by label. Uses the inner span text to avoid SVG title conflicts. */
  private getLink(label: SettingsPageLabel) {
    return this.container
      .getByRole('link')
      .filter({ has: this.page.locator(`span:text-is("${label}")`) })
  }

  async goto() {
    await this.page.goto('/app/settings')
  }

  async navigateTo(label: SettingsPageLabel) {
    await this.getLink(label).click()
    await this.page.waitForURL(`**/app/settings/${SETTINGS_PAGES[label]}**`)
  }

  async isLinkVisible(label: SettingsPageLabel) {
    return this.getLink(label).isVisible()
  }

  async isLinkActive(label: SettingsPageLabel) {
    const link = this.getLink(label)
    return (await link.getAttribute('data-active')) === 'true'
  }

  async getVisibleLinks(): Promise<string[]> {
    const links = this.container.getByRole('link')
    return links.allTextContents()
  }
}
