// packages/e2e/lib/pom/sidebar.ts
import type { Locator, Page } from '@playwright/test'

export class Sidebar {
  private readonly header: Locator
  private readonly content: Locator
  private readonly footer: Locator

  constructor(private readonly page: Page) {
    this.header = page.locator('[data-sidebar="header"]')
    this.content = page.locator('[data-sidebar="content"]')
    this.footer = page.locator('[data-sidebar="footer"]')
  }

  // User menu actions
  async openUserMenu() {
    await this.header.getByRole('button').click()
  }

  async signOut() {
    await this.openUserMenu()
    await this.page.getByRole('menuitem', { name: 'Sign Out' }).click()
  }

  async switchOrganization(orgName: string) {
    await this.openUserMenu()
    await this.page.getByText('Switch Organization').click()
    await this.page.getByText(orgName).click()
  }

  // Mail navigation
  async goToInbox() {
    await this.content.getByRole('link', { name: 'Inbox' }).click()
  }

  async goToDrafts() {
    await this.content.getByRole('link', { name: 'Drafts' }).click()
  }

  async goToSent() {
    await this.content.getByRole('link', { name: 'Sent' }).click()
  }

  // Configurations
  async goToWorkflows() {
    await this.content.getByRole('link', { name: 'Workflows' }).click()
  }

  async goToTasks() {
    await this.content.getByRole('link', { name: 'Tasks' }).click()
  }

  // Shopify sub-menu (may need section expansion)
  async goToShopifyCustomers() {
    await this.content.getByRole('link', { name: 'Customers' }).click()
  }

  async goToShopifyOrders() {
    await this.content.getByRole('link', { name: 'Orders' }).click()
  }

  async goToShopifyProducts() {
    await this.content.getByRole('link', { name: 'Products' }).click()
  }

  // Resources sub-menu (may need section expansion)
  async goToDatasets() {
    await this.content.getByRole('link', { name: 'Datasets' }).click()
  }

  async goToKnowledgeBase() {
    await this.content.getByRole('link', { name: 'Knowledge Base' }).click()
  }

  async goToFiles() {
    await this.content.getByRole('link', { name: 'Files' }).click()
  }

  // Entities
  async goToTickets() {
    await this.content.getByRole('link', { name: 'Tickets' }).click()
  }

  async goToCustomEntity(entityName: string) {
    await this.content.getByRole('link', { name: entityName }).click()
  }

  // Footer
  async goToSettings() {
    await this.footer.getByRole('link', { name: 'Settings' }).click()
  }

  async openHelpMenu() {
    await this.footer.getByText('Help and resources').click()
  }

  // Collapsible section helpers
  async expandSection(sectionName: string) {
    const groupLabel = this.content
      .locator('[data-sidebar="group-label"]')
      .filter({ hasText: sectionName })
    const group = groupLabel.locator('..')
    const isCollapsed = await group.getAttribute('data-state')
    if (isCollapsed === 'closed') {
      await groupLabel.click()
    }
  }
}
