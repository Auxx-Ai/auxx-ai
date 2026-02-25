// packages/e2e/lib/pom/main-page.ts
import type { Locator, Page } from '@playwright/test'

export class MainPage {
  private readonly container: Locator
  private readonly header: Locator
  private readonly subheader: Locator
  private readonly content: Locator
  private readonly sidebarTrigger: Locator

  constructor(private readonly page: Page) {
    this.container = page.locator('[data-main="main"]')
    this.header = page.locator('[data-main="header"]')
    this.subheader = page.locator('[data-main="subheader"]')
    this.content = page.locator('[data-main="content"]')
    this.sidebarTrigger = page.locator('[data-sidebar="trigger"]')
  }

  async waitForLoaded() {
    await this.container.waitFor({ state: 'visible' })
  }

  // Header
  async toggleSidebar() {
    await this.sidebarTrigger.click()
  }

  async getBreadcrumbText() {
    return this.header.locator('nav[aria-label="breadcrumb"]').textContent()
  }

  async clickBreadcrumb(name: string) {
    await this.header.getByRole('link', { name }).click()
  }

  // Content
  getContentLocator() {
    return this.content
  }

  // Subheader
  async isSubheaderVisible() {
    return this.subheader.isVisible()
  }

  getSubheaderLocator() {
    return this.subheader
  }
}
