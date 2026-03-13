// packages/e2e/lib/pom/entity-definition-page.ts
import type { Locator, Page } from '@playwright/test'

/**
 * Page Object Model for the Custom Entities & Fields settings page
 * and associated dialogs for creating entities and fields.
 */
export class EntityDefinitionPage {
  private readonly page: Page
  private readonly content: Locator

  constructor(page: Page) {
    this.page = page
    this.content = page.locator('[data-slot="settings-page"]')
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async goto() {
    await this.page.goto('/app/settings/custom-fields')
    await this.page.waitForURL('**/app/settings/custom-fields')
    await this.content.waitFor({ state: 'visible' })
  }

  // ---------------------------------------------------------------------------
  // Cleanup — delete demo entities via tRPC so the script is re-runnable
  // ---------------------------------------------------------------------------

  /**
   * Archive and permanently delete a custom entity by slug.
   * Calls tRPC v11 (SuperJSON + httpBatchStreamLink) endpoints directly.
   * Silently skips if the entity doesn't exist.
   */
  async deleteEntityBySlug(slug: string) {
    // Find the entity ID by its slug via the getAll endpoint
    // tRPC v11 batch query format: ?batch=1&input={"0":{"json":...}}
    const id = await this.page.evaluate(async (s) => {
      const input = encodeURIComponent(JSON.stringify({ '0': { json: {} } }))
      const res = await fetch(`/api/trpc/entityDefinition.getAll?batch=1&input=${input}`, {
        credentials: 'include',
      })
      const text = await res.text()
      // Batch response is a JSON array: [{result:{data:{json:[...]}}}]
      const parsed = JSON.parse(text)
      const data = parsed[0]?.result?.data?.json ?? []
      const match = data.find((e: any) => e.apiSlug === s)
      return match?.id ?? null
    }, slug)

    if (!id) return // entity doesn't exist, nothing to clean up

    // Archive (soft delete) — slug becomes available since checkSlugExists filters by archivedAt
    await this.page.evaluate(
      async ({ id }) => {
        await fetch('/api/trpc/entityDefinition.archive?batch=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ '0': { json: { id } } }),
        })
      },
      { id }
    )
  }

  /**
   * Clean up all demo entities so the script can be re-run.
   * Call this before creating entities.
   */
  async cleanupDemoEntities() {
    // Must visit app first to have authenticated cookies
    await this.page.goto('/app/settings/custom-fields')
    await this.page.waitForURL('**/app/settings/custom-fields')

    const demoSlugs = ['companies', 'orders', 'return-requests']
    for (const slug of demoSlugs) {
      await this.deleteEntityBySlug(slug)
    }

    // Hard navigation to clear React Query / tRPC cache so slug checks are fresh
    await this.page.goto('about:blank')
    await this.page.goto('/app/settings/custom-fields')
    await this.page.waitForURL('**/app/settings/custom-fields')
    await this.content.waitFor({ state: 'visible' })
  }

  async openEntity(entityName: string) {
    await this.content.getByRole('row').filter({ hasText: entityName }).click()
  }

  // ---------------------------------------------------------------------------
  // Entity Definition Dialog
  // ---------------------------------------------------------------------------

  async clickCreateEntity() {
    await this.content.getByRole('button', { name: 'Create' }).click()
  }

  async fillEntityPlural(value: string) {
    const dialog = this.page.getByRole('dialog')
    // Placeholder is "Customers" (capital C) — use exact to avoid matching slug "customers"
    await dialog.getByPlaceholder('Customers', { exact: true }).fill(value)
  }

  async fillEntitySingular(value: string) {
    const dialog = this.page.getByRole('dialog')
    // Placeholder is "Customer" (capital C) — use exact to avoid matching slug "customers"
    await dialog.getByPlaceholder('Customer', { exact: true }).fill(value)
  }

  /** Click the icon circle to open the icon picker */
  async clickIconPicker() {
    const dialog = this.page.getByRole('dialog')
    await dialog.locator('.rounded-full').first().click()
  }

  /** Select a color in the icon picker popover */
  async selectIconColor(color: string) {
    await this.page.getByRole('button', { name: color, exact: true }).click()
  }

  /** Select an icon by its name/label in the icon picker */
  async selectIcon(iconName: string) {
    await this.page.getByRole('button', { name: iconName, exact: true }).click()
  }

  /** Fill the slug input directly (overrides auto-generated slug) */
  async fillEntitySlug(value: string) {
    const dialog = this.page.getByRole('dialog')
    await dialog.locator('[data-slot="input-group-control"]').fill(value)
  }

  /** Wait for slug validation to complete — green check visible */
  async waitForSlugValid() {
    const dialog = this.page.getByRole('dialog')
    await dialog.locator('.text-success').waitFor({ state: 'visible', timeout: 8000 })
  }

  async submitCreateEntity() {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Create Entity' }).click()
    // Wait for the entity to be created and the field dialog to auto-open
    await this.page
      .getByRole('dialog')
      .getByText('Create Field')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
  }

  async submitUpdateEntity() {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Update Entity' }).click()
  }

  // ---------------------------------------------------------------------------
  // Custom Field Dialog
  // ---------------------------------------------------------------------------

  /** Click "Add" button in the field list header or "Create Field" in empty state */
  async clickAddField() {
    // Wait for any open dialog to close first
    const dialog = this.page.getByRole('dialog')
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})

    // Wait for "Add" button to appear in the field list
    const addBtn = this.page.getByRole('button', { name: 'Add' })
    await addBtn.waitFor({ state: 'visible', timeout: 5000 })
    await addBtn.click()
  }

  /** Open the field type picker and select a type */
  async selectFieldType(typeName: string) {
    const dialog = this.page.getByRole('dialog')
    const option = this.page.getByRole('option', { name: typeName, exact: true })

    // If picker is already open (option visible), select directly
    if (await option.isVisible().catch(() => false)) {
      await option.click()
      return
    }

    // Click the type trigger button (full-width outline button with justify-between)
    await dialog.locator('button.justify-between').click()

    // Wait for option and click it
    await option.waitFor({ state: 'visible', timeout: 5000 })
    await option.click()
  }

  /** Fill the field name input */
  async fillFieldName(value: string) {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByPlaceholder('e.g., Work Phone').fill(value)
  }

  /** Fill the field description input */
  async fillFieldDescription(value: string) {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByPlaceholder('Description or help text for this field').fill(value)
  }

  /** Toggle the required field switch */
  async toggleRequired() {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByText('Required Field').click()
  }

  /** Toggle the unique value switch */
  async toggleUnique() {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByText('Unique Value').click()
  }

  /** Toggle the "Create more" switch to keep dialog open */
  async toggleCreateMore() {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByText('Create more').click()
  }

  async submitCreateField() {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Create Field' }).click()

    // Button changes to "Creating..." (disabled) while mutation runs.
    // 1. Wait for button to become disabled (mutation started)
    await this.page
      .waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"]')
          if (!dialog) return true // dialog already closed
          const btns = dialog.querySelectorAll('button[disabled]')
          return btns.length > 0
        },
        { timeout: 5000 }
      )
      .catch(() => {}) // might already be done

    // 2. Wait for mutation to complete: dialog closes or no more disabled buttons
    await this.page.waitForFunction(
      () => {
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) return true // dialog closed
        const disabledBtns = dialog.querySelectorAll('button[disabled]')
        return disabledBtns.length === 0
      },
      { timeout: 15000 }
    )
  }

  // ---------------------------------------------------------------------------
  // Select Options (for Single Select / Multi Select fields)
  // ---------------------------------------------------------------------------

  /** Click the "Add Option" button to add a new select option */
  async clickAddOption() {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Add Option' }).click()
  }

  /** Fill the Nth option label (0-indexed) */
  async fillOptionLabel(index: number, value: string) {
    const dialog = this.page.getByRole('dialog')
    const inputs = dialog.getByPlaceholder('Option')
    await inputs.nth(index).fill(value)
  }

  /** Add multiple select options in sequence */
  async addSelectOptions(options: string[]) {
    for (let i = 0; i < options.length; i++) {
      await this.clickAddOption()
      await this.fillOptionLabel(i, options[i])
    }
  }

  // ---------------------------------------------------------------------------
  // Relationship Field Editor
  // ---------------------------------------------------------------------------

  /** Fill the left-side field name (current entity's attribute name) */
  async fillRelationshipName(value: string) {
    const dialog = this.page.getByRole('dialog')
    const cards = dialog.locator('[class*="card"]')
    const leftCard = cards.first()
    await leftCard.getByRole('textbox').fill(value)
  }

  /** Select the relationship type (Belongs To, Has One, Has Many, Many To Many) */
  async selectRelationshipType(type: string) {
    const dialog = this.page.getByRole('dialog')
    // The middle column has a select with relationship types
    await dialog
      .locator('button')
      .filter({ hasText: /Belongs To|Has One|Has Many|Many To Many/i })
      .click()
    // Radix Select renders options in a portal outside the dialog
    const option = this.page.getByRole('option').filter({ hasText: type })
    await option.waitFor({ state: 'visible', timeout: 5000 })
    await option.click()
  }

  /** Select the related resource in the right card */
  async selectRelatedResource(resourceName: string) {
    const dialog = this.page.getByRole('dialog')
    // The right card has the resource selector — it's the last combobox in the dialog
    // (left card has no combobox, middle has the relationship type combobox, right has the resource combobox)
    const comboboxes = dialog.getByRole('combobox')
    const resourceTrigger = comboboxes.last()
    await resourceTrigger.waitFor({ state: 'visible', timeout: 5000 })
    await resourceTrigger.click()
    // Radix Select renders options in a portal — find by role + text
    const option = this.page.locator('[role="option"]').filter({ hasText: resourceName })
    await option.waitFor({ state: 'visible', timeout: 5000 })
    await option.click()
  }

  /** Fill the inverse field name (right card) */
  async fillInverseName(value: string) {
    const dialog = this.page.getByRole('dialog')
    const cards = dialog.locator('[class*="card"]')
    const rightCard = cards.last()
    await rightCard.getByRole('textbox').fill(value)
  }

  // ---------------------------------------------------------------------------
  // Field List
  // ---------------------------------------------------------------------------

  /** Wait for the field list to be visible */
  async waitForFieldList() {
    await this.page.waitForURL('**/app/settings/custom-fields/**')
    await this.content.waitFor({ state: 'visible' })
  }

  /** Check if a field is visible in the list */
  async isFieldVisible(fieldName: string) {
    return this.content.getByText(fieldName).isVisible()
  }

  /** Open an entity and wait for its field list to load */
  async openEntityAndWaitForFields(entityName: string) {
    await this.openEntity(entityName)
    await this.waitForFieldList()
  }

  /** Navigate back to entity list from field list */
  async backToEntityList() {
    await this.page.goto('/app/settings/custom-fields')
    await this.page.waitForURL('**/app/settings/custom-fields')
    await this.content.waitFor({ state: 'visible' })
  }
}
