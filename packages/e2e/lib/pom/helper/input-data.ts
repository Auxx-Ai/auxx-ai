// packages/e2e/lib/pom/helper/input-data.ts
import type { Page } from '@playwright/test'

export class InputData {
  constructor(private readonly page: Page) {}

  async typeText(placeholder: string, value: string) {
    await this.page.getByPlaceholder(placeholder).fill(value)
  }

  async typeNumber(placeholder: string, value: string) {
    await this.page.getByPlaceholder(placeholder).fill(value)
  }

  async typeEmail(value: string) {
    await this.page.getByPlaceholder('Email').fill(value)
  }

  // TODO: Add methods per field type as tests demand:
  // - typePhone(countryCode, number)
  // - typeAddress(address1, address2, city, state, postCode, country)
  // - selectDate(value)
  // - typeCurrency(currency, amount)
  // - selectOption(value) / selectMultipleOptions(values)
  // - typeLink(url)
  // - typeJSON(placeholder, value)
  // - selectRating(rating)
  // - typeFirstName(name) / typeLastName(name)
  // - typeArrayValue(value) / clickAddItem()
}
