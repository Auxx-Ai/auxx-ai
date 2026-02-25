// packages/e2e/lib/pom/helper/confirmation-modal.ts
import type { Locator, Page } from '@playwright/test'

export class ConfirmationModal {
  private readonly cancelButton: Locator
  private readonly confirmButton: Locator
  private readonly title: Locator
  private readonly description: Locator

  constructor(private readonly page: Page) {
    this.cancelButton = page.getByTestId('confirmation-modal-cancel-button')
    this.confirmButton = page.getByTestId('confirmation-modal-confirm-button')
    this.title = page.getByTestId('confirmation-modal-title')
    this.description = page.getByTestId('confirmation-modal-description')
  }

  async getTitle() {
    return this.title.textContent()
  }

  async getDescription() {
    return this.description.textContent()
  }

  async clickCancel() {
    await this.cancelButton.click()
  }

  async clickConfirm() {
    await this.confirmButton.click()
  }

  async waitForVisible() {
    await this.confirmButton.waitFor({ state: 'visible' })
  }

  async waitForHidden() {
    await this.confirmButton.waitFor({ state: 'hidden' })
  }
}
