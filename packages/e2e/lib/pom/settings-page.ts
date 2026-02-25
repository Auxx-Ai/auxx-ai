// packages/e2e/lib/pom/settings-page.ts
import type { Locator, Page } from '@playwright/test'

export class SettingsPage {
  private readonly container: Locator

  constructor(private readonly page: Page) {
    this.container = page.locator('[data-slot="settings-page"]')
  }

  async waitForLoaded() {
    await this.container.waitFor({ state: 'visible' })
  }

  async getTitle() {
    return this.container.locator('.h3').first().textContent()
  }

  async getDescription() {
    return this.container.locator('.text-muted-foreground').first().textContent()
  }

  getContent() {
    return this.container
  }
}
