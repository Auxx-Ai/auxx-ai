// packages/e2e/lib/pom/login-page.ts
import type { Locator, Page } from '@playwright/test'

export class LoginPage {
  private readonly emailInput: Locator
  private readonly continueButton: Locator
  private readonly passwordInput: Locator
  private readonly signInButton: Locator

  constructor(private readonly page: Page) {
    this.emailInput = page.getByPlaceholder('Email or phone')
    this.continueButton = page.getByRole('button', { name: 'Continue with Email or Phone' })
    this.passwordInput = page.getByPlaceholder('Your password')
    this.signInButton = page.getByRole('button', { name: 'Sign in' })
  }

  async goto() {
    await this.page.goto('/login')
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.continueButton.click()
    await this.passwordInput.waitFor({ state: 'visible' })
    await this.passwordInput.fill(password)
    await this.signInButton.click()
  }
}
