// packages/e2e/tests/demo/entity-definition-video.spec.ts
//
// Playwright demo script for the Entity Definition & Custom Fields video.
// Run with screen recording software active — this script drives the browser
// at a human-readable pace with deliberate pauses between actions.
//
// Usage:
//   cd packages/e2e
//   pnpm test tests/demo/entity-definition-video.spec.ts
//   pnpm test:debug tests/demo/entity-definition-video.spec.ts   # step-by-step

import { expect, test } from '../../lib/fixtures/base'
import { EntityDefinitionPage } from '../../lib/pom/entity-definition-page'

/** Pause between actions so the viewer can follow along */
const PACE = 800
/** Longer pause after completing a section */
const SECTION_PAUSE = 400

test.describe('Entity Definition & Custom Fields — Video Demo', () => {
  let entity: EntityDefinitionPage

  test.beforeEach(async ({ page }) => {
    entity = new EntityDefinitionPage(page)
    // Use slow-mo for natural-looking interactions
    test.slow() // triples the default timeout
  })

  // ---------------------------------------------------------------------------
  // Scene 0: Cleanup — delete any demo entities from previous runs
  // ---------------------------------------------------------------------------
  test('Scene 0 — Cleanup previous demo entities', async ({ page }) => {
    await entity.cleanupDemoEntities()
  })

  // ---------------------------------------------------------------------------
  // Scene 1: Show existing system entities
  // ---------------------------------------------------------------------------
  test('Scene 1 — Browse existing entities', async ({ page, settingsSidebar }) => {
    // Navigate to settings
    await page.goto('/app/settings')
    await page.waitForURL('**/app/settings/general')
    await page.waitForTimeout(PACE)

    // Navigate to Custom Entities & Fields
    await settingsSidebar.navigateTo('Custom Entities & Fields')
    await page.waitForTimeout(SECTION_PAUSE)

    // Pause on the entity list so viewers can see Contact, Ticket, Part
    const settingsContent = page.locator('[data-slot="settings-page"]')
    await expect(settingsContent.getByText('Contact', { exact: true })).toBeVisible()
    await expect(settingsContent.getByText('Ticket', { exact: true })).toBeVisible()
    await page.waitForTimeout(SECTION_PAUSE)

    // Click into Contact to show its system fields
    await entity.openEntity('Contact')
    await entity.waitForFieldList()
    await page.waitForTimeout(SECTION_PAUSE)

    // Go back
    await entity.backToEntityList()
    await page.waitForTimeout(PACE)
  })

  // ---------------------------------------------------------------------------
  // Scene 2: Create "Company" entity with fields
  // ---------------------------------------------------------------------------
  test('Scene 2 — Create Company entity', async ({ page }) => {
    await entity.goto()
    await page.waitForTimeout(PACE)

    // Open create entity dialog
    await entity.clickCreateEntity()
    await page.waitForTimeout(PACE)

    // Fill entity details
    await entity.fillEntityPlural('Companies')
    await page.waitForTimeout(PACE)

    // Fix singular (auto-generated "Companie" from stripping "s")
    await entity.fillEntitySingular('Company')
    await page.waitForTimeout(PACE)

    await entity.waitForSlugValid()
    await page.waitForTimeout(PACE)

    // Submit
    await entity.submitCreateEntity()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 1: Company Name (Text) --
    // After entity creation, the field dialog opens automatically with type picker open
    // Default type is "Text" — just select it to close the picker
    await entity.selectFieldType('Text')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Company Name')
    await page.waitForTimeout(PACE)

    await entity.toggleRequired()
    await page.waitForTimeout(PACE / 2)

    await entity.toggleCreateMore()
    await page.waitForTimeout(PACE / 2)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 2: Website (URL) --
    await entity.selectFieldType('URL')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Website')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 3: Industry (Single Select) --
    await entity.selectFieldType('Select')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Industry')
    await page.waitForTimeout(PACE)

    await entity.addSelectOptions(['E-commerce', 'SaaS', 'Retail', 'Manufacturing', 'Wholesale'])
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 4: Annual Revenue (Currency) --
    await entity.selectFieldType('Currency')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Annual Revenue')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 5: Headquarters (Address) --
    await entity.selectFieldType('Address')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Headquarters')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 6: Notes (Rich Text) --
    await entity.selectFieldType('Rich Text Editor')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Notes')
    await page.waitForTimeout(PACE)

    // Turn off "Create more" for the last field before relationship
    await entity.toggleCreateMore()
    await page.waitForTimeout(PACE / 2)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 7: Primary Contact (Relationship → Contact) --
    // Dialog closed → we're back on entity list, re-open Company
    await entity.openEntityAndWaitForFields('Company')
    await page.waitForTimeout(PACE)

    await entity.clickAddField()
    await page.waitForTimeout(PACE)

    await entity.selectFieldType('Relationship')
    await page.waitForTimeout(PACE)

    // In relationship mode, the editor shows 3 columns
    await entity.selectRelatedResource('Contact')
    await page.waitForTimeout(PACE)

    await entity.selectRelationshipType('Belongs To')
    await page.waitForTimeout(PACE)

    await entity.fillRelationshipName('Primary Contact')
    await page.waitForTimeout(PACE)

    await entity.fillInverseName('Company')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // Pause to admire the field list
    await page.waitForTimeout(SECTION_PAUSE)
  })

  // ---------------------------------------------------------------------------
  // Scene 3: Create "Order" entity with key fields
  // ---------------------------------------------------------------------------
  test('Scene 3 — Create Order entity', async ({ page }) => {
    await entity.goto()
    await page.waitForTimeout(PACE)

    // Create the entity
    await entity.clickCreateEntity()
    await page.waitForTimeout(PACE)

    await entity.fillEntityPlural('Orders')
    await page.waitForTimeout(PACE)

    await entity.fillEntitySingular('Order')
    await page.waitForTimeout(PACE)

    await entity.waitForSlugValid()
    await entity.submitCreateEntity()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 1: Order Number (Text, unique) --
    // Field dialog auto-opens after entity creation
    await entity.selectFieldType('Text')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Order Number')
    await page.waitForTimeout(PACE)

    await entity.toggleRequired()
    await page.waitForTimeout(PACE / 2)

    await entity.toggleUnique()
    await page.waitForTimeout(PACE / 2)

    await entity.toggleCreateMore()
    await page.waitForTimeout(PACE / 2)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 2: Status (Single Select with colors) --
    await entity.selectFieldType('Select')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Status')
    await page.waitForTimeout(PACE)

    await entity.addSelectOptions([
      'Pending',
      'Processing',
      'Shipped',
      'Delivered',
      'Returned',
      'Cancelled',
    ])
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 3: Order Total (Currency) --
    await entity.selectFieldType('Currency')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Order Total')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 4: Order Date (Date & Time) --
    await entity.selectFieldType('Date & Time')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Order Date')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 5: Shipping Address (Address) --
    await entity.selectFieldType('Address')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Shipping Address')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 6: Tracking URL --
    await entity.selectFieldType('URL')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Tracking URL')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 7: Requires Follow-up (Checkbox) --
    await entity.selectFieldType('Checkbox')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Requires Follow-up')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 8: Assigned To (Actor) --
    await entity.selectFieldType('Actor')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Assigned To')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 9: Tags --
    await entity.selectFieldType('Tags')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Tags')
    await page.waitForTimeout(PACE)

    // Turn off "Create more" before last field
    await entity.toggleCreateMore()
    await page.waitForTimeout(PACE / 2)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 10: Customer (Relationship → Contact, belongs_to) --
    // Dialog closed → we're back on entity list, re-open Order
    await entity.openEntityAndWaitForFields('Order')
    await page.waitForTimeout(PACE)

    await entity.clickAddField()
    await page.waitForTimeout(PACE)

    await entity.selectFieldType('Relationship')
    await page.waitForTimeout(PACE)

    await entity.selectRelatedResource('Contact')
    await page.waitForTimeout(PACE)

    await entity.selectRelationshipType('Belongs To')
    await page.waitForTimeout(PACE)

    await entity.fillRelationshipName('Customer')
    await page.waitForTimeout(PACE)

    await entity.fillInverseName('Orders')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 11: Company (Relationship → Company, belongs_to) --
    await entity.clickAddField()
    await page.waitForTimeout(PACE)

    await entity.selectFieldType('Relationship')
    await page.waitForTimeout(PACE)

    await entity.selectRelatedResource('Company')
    await page.waitForTimeout(PACE)

    await entity.selectRelationshipType('Belongs To')
    await page.waitForTimeout(PACE)

    await entity.fillRelationshipName('Company')
    await page.waitForTimeout(PACE)

    await entity.fillInverseName('Orders')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // Pause on completed field list
    await page.waitForTimeout(SECTION_PAUSE)
  })

  // ---------------------------------------------------------------------------
  // Scene 4: Create "Return Request" entity
  // ---------------------------------------------------------------------------
  test('Scene 4 — Create Return Request entity', async ({ page }) => {
    await entity.goto()
    await page.waitForTimeout(PACE)

    // Create entity
    await entity.clickCreateEntity()
    await page.waitForTimeout(PACE)

    await entity.fillEntityPlural('Return Requests')
    await page.waitForTimeout(PACE)

    await entity.fillEntitySingular('Return Request')
    await page.waitForTimeout(PACE)

    await entity.waitForSlugValid()
    await entity.submitCreateEntity()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 1: Return ID (Text, unique) --
    // Field dialog auto-opens after entity creation
    await entity.selectFieldType('Text')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Return ID')
    await page.waitForTimeout(PACE)

    await entity.toggleRequired()
    await page.waitForTimeout(PACE / 2)

    await entity.toggleUnique()
    await page.waitForTimeout(PACE / 2)

    await entity.toggleCreateMore()
    await page.waitForTimeout(PACE / 2)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 2: Return Reason (Single Select) --
    await entity.selectFieldType('Select')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Return Reason')
    await page.waitForTimeout(PACE)

    await entity.addSelectOptions([
      'Defective',
      'Wrong Item',
      'Changed Mind',
      'Damaged in Shipping',
      'Not as Described',
    ])
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 3: Status (Single Select) --
    await entity.selectFieldType('Select')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Status')
    await page.waitForTimeout(PACE)

    await entity.addSelectOptions([
      'Requested',
      'Approved',
      'Shipped Back',
      'Received',
      'Refunded',
      'Denied',
    ])
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 4: Refund Amount (Currency) --
    await entity.selectFieldType('Currency')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Refund Amount')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 5: Date Requested (Date) --
    await entity.selectFieldType('Date')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Date Requested')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 6: Photos (File Upload) --
    await entity.selectFieldType('File Upload')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Photos')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(PACE)

    // -- Field 7: Resolution Notes (Rich Text) --
    await entity.selectFieldType('Rich Text Editor')
    await page.waitForTimeout(PACE)

    await entity.fillFieldName('Resolution Notes')
    await page.waitForTimeout(PACE)

    // Turn off create more
    await entity.toggleCreateMore()
    await page.waitForTimeout(PACE / 2)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 8: Customer (Relationship → Contact) --
    // Dialog closed → we're back on entity list, re-open Return Request
    await entity.openEntityAndWaitForFields('Return Request')
    await page.waitForTimeout(PACE)

    await entity.clickAddField()
    await page.waitForTimeout(PACE)

    await entity.selectFieldType('Relationship')
    await page.waitForTimeout(PACE)

    await entity.selectRelatedResource('Contact')
    await page.waitForTimeout(PACE)

    await entity.selectRelationshipType('Belongs To')
    await page.waitForTimeout(PACE)

    await entity.fillRelationshipName('Customer')
    await page.waitForTimeout(PACE)

    await entity.fillInverseName('Return Requests')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 9: Original Order (Relationship → Order) --
    await entity.clickAddField()
    await page.waitForTimeout(PACE)

    await entity.selectFieldType('Relationship')
    await page.waitForTimeout(PACE)

    await entity.selectRelatedResource('Order')
    await page.waitForTimeout(PACE)

    await entity.selectRelationshipType('Belongs To')
    await page.waitForTimeout(PACE)

    await entity.fillRelationshipName('Original Order')
    await page.waitForTimeout(PACE)

    await entity.fillInverseName('Return Requests')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // -- Field 10: Related Ticket (Relationship → Ticket) --
    await entity.clickAddField()
    await page.waitForTimeout(PACE)

    await entity.selectFieldType('Relationship')
    await page.waitForTimeout(PACE)

    await entity.selectRelatedResource('Ticket')
    await page.waitForTimeout(PACE)

    await entity.selectRelationshipType('Belongs To')
    await page.waitForTimeout(PACE)

    await entity.fillRelationshipName('Related Ticket')
    await page.waitForTimeout(PACE)

    await entity.fillInverseName('Return Requests')
    await page.waitForTimeout(PACE)

    await entity.submitCreateField()
    await page.waitForTimeout(SECTION_PAUSE)

    // Final pause on the completed field list
    await page.waitForTimeout(SECTION_PAUSE)
  })

  // ---------------------------------------------------------------------------
  // Scene 5: Browse sidebar & navigate between entities
  // ---------------------------------------------------------------------------
  test('Scene 5 — Browse entities in sidebar', async ({ page, sidebar }) => {
    // Start from inbox to show the sidebar
    await page.goto('/app')
    await page.waitForTimeout(SECTION_PAUSE)

    // The custom entities should now appear in the sidebar
    // Navigate to Companies
    await sidebar.goToCustomEntity('Companies')
    await page.waitForTimeout(SECTION_PAUSE)

    // Navigate to Orders
    await sidebar.goToCustomEntity('Orders')
    await page.waitForTimeout(SECTION_PAUSE)

    // Navigate to Return Requests
    await sidebar.goToCustomEntity('Return Requests')
    await page.waitForTimeout(SECTION_PAUSE)

    // Show built-in Tickets for contrast
    await sidebar.goToTickets()
    await page.waitForTimeout(SECTION_PAUSE)

    // Back to entity settings for a final overview
    await entity.goto()
    await page.waitForTimeout(SECTION_PAUSE)

    // Scroll through the entity list showing all created entities
    await page.waitForTimeout(SECTION_PAUSE)
  })
})
