// packages/seed/src/domains/example-integration.domain.ts
// Creates a mock Gmail-style Integration record (isExample: true) for new real orgs
// so CommunicationDomain has an integration to attach threads to.

import { createId } from '@paralleldrive/cuid2'

/**
 * ExampleIntegrationDomain creates the mock integration other seed domains
 * (CommunicationDomain) require in their context.
 *
 * Unlike DemoIntegrationDomain, this does NOT create a ShopifyIntegration — real
 * accounts shouldn't see a fake Shopify row. The Integration row is flagged with
 * `isExample: true` so the UI can hide it from the "Send as" picker and block reply.
 */
export class ExampleIntegrationDomain {
  private readonly organizationId: string
  private readonly userEmail: string | undefined

  constructor(organizationId: string, userEmail?: string) {
    this.organizationId = organizationId
    this.userEmail = userEmail
  }

  /**
   * Creates a single mock email Integration + links it to the default inbox.
   * Idempotent via onConflictDoNothing on the org/email unique index.
   */
  async insertDirectly(db: any): Promise<{ integrationId: string }> {
    const { schema } = await import('@auxx/database')
    const { eq, and } = await import('drizzle-orm')

    const integrationId = createId()
    const now = new Date()

    // Derive a friendly example email that pairs with any shop domain
    const derivedShop = this.userEmail?.split('@')[1] ?? 'yourshop.com'
    const exampleEmail = `example@${derivedShop}`

    console.log('📧 Creating example email integration...')
    await db
      .insert(schema.Integration)
      .values({
        id: integrationId,
        organizationId: this.organizationId,
        name: 'Example Gmail',
        provider: 'google',
        email: exampleEmail,
        enabled: false,
        authStatus: 'AUTHENTICATED',
        syncStatus: 'NOT_SYNCED',
        syncStage: 'IDLE',
        syncMode: 'auto',
        isExample: true,
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
    console.log('✅ Example email integration created')

    // Link to the org's existing shared inbox
    const existingInbox = await db
      .select({ id: schema.InboxIntegration.id })
      .from(schema.InboxIntegration)
      .innerJoin(
        schema.Integration,
        eq(schema.InboxIntegration.integrationId, schema.Integration.id)
      )
      .where(eq(schema.Integration.organizationId, this.organizationId))
      .limit(1)

    if (existingInbox.length === 0) {
      const inboxEntityDef = await db
        .select({ id: schema.EntityDefinition.id })
        .from(schema.EntityDefinition)
        .where(
          and(
            eq(schema.EntityDefinition.entityType, 'inbox'),
            eq(schema.EntityDefinition.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (inboxEntityDef.length > 0) {
        const inboxInstances = await db
          .select({ id: schema.EntityInstance.id })
          .from(schema.EntityInstance)
          .where(
            and(
              eq(schema.EntityInstance.entityDefinitionId, inboxEntityDef[0]!.id),
              eq(schema.EntityInstance.organizationId, this.organizationId)
            )
          )
          .limit(1)

        if (inboxInstances.length > 0) {
          await db
            .insert(schema.InboxIntegration)
            .values({
              id: createId(),
              inboxId: inboxInstances[0]!.id,
              integrationId,
              isDefault: true,
              updatedAt: now,
              createdAt: now,
            })
            .onConflictDoNothing()
        }
      }
    }

    return { integrationId }
  }
}
