// packages/seed/src/domains/demo-integration.domain.ts
// Creates mock Integration and ShopifyIntegration records for demo organizations

import { getDemoEmailDomain } from '@auxx/lib/demo'
import { createId } from '@paralleldrive/cuid2'

/**
 * DemoIntegrationDomain creates the integration records that other domain seeders
 * (CommerceDomain, CommunicationDomain) require in their context.
 *
 * These are DB-only records — DemoGuard blocks all real sync/send operations
 * for demo organizations.
 */
export class DemoIntegrationDomain {
  private readonly organizationId: string
  private readonly userId: string

  constructor(organizationId: string, userId: string) {
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Creates email Integration, InboxIntegration link, and ShopifyIntegration records.
   * Uses onConflictDoNothing for idempotency.
   */
  async insertDirectly(db: any): Promise<{
    integrationId: string
    shopifyIntegrationId: string
  }> {
    const { schema } = await import('@auxx/database')
    const { eq, and } = await import('drizzle-orm')

    const integrationId = createId()
    const shopifyIntegrationId = createId()
    const now = new Date()

    // Create email Integration record
    console.log('📧 Creating demo email integration...')
    await db
      .insert(schema.Integration)
      .values({
        id: integrationId,
        organizationId: this.organizationId,
        name: 'Demo Email',
        provider: 'google',
        email: `support@${getDemoEmailDomain()}`,
        enabled: false,
        authStatus: 'AUTHENTICATED',
        syncStatus: 'NOT_SYNCED',
        syncStage: 'IDLE',
        syncMode: 'auto',
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
    console.log('✅ Demo email integration created')

    // Link integration to the org's existing inbox via InboxIntegration
    const existingInbox = await db
      .select({ id: schema.InboxIntegration.id, inboxId: schema.InboxIntegration.inboxId })
      .from(schema.InboxIntegration)
      .innerJoin(
        schema.Integration,
        eq(schema.InboxIntegration.integrationId, schema.Integration.id)
      )
      .where(eq(schema.Integration.organizationId, this.organizationId))
      .limit(1)

    if (existingInbox.length === 0) {
      // Find the inbox EntityInstance (created by base org seeder)
      const { schema: dbSchema } = await import('@auxx/database')
      const inboxEntityDef = await db
        .select({ id: dbSchema.EntityDefinition.id })
        .from(dbSchema.EntityDefinition)
        .where(
          and(
            eq(dbSchema.EntityDefinition.entityType, 'inbox'),
            eq(dbSchema.EntityDefinition.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (inboxEntityDef.length > 0) {
        const inboxInstances = await db
          .select({ id: dbSchema.EntityInstance.id })
          .from(dbSchema.EntityInstance)
          .where(
            and(
              eq(dbSchema.EntityInstance.entityDefinitionId, inboxEntityDef[0]!.id),
              eq(dbSchema.EntityInstance.organizationId, this.organizationId)
            )
          )
          .limit(1)

        if (inboxInstances.length > 0) {
          console.log('📬 Linking integration to inbox...')
          await db
            .insert(schema.InboxIntegration)
            .values({
              id: createId(),
              inboxId: inboxInstances[0]!.id,
              integrationId: integrationId,
              isDefault: true,
              updatedAt: now,
              createdAt: now,
            })
            .onConflictDoNothing()
          console.log('✅ Inbox integration linked')
        }
      }
    }

    // Create ShopifyIntegration record
    console.log('🛍️  Creating demo Shopify integration...')
    await db
      .insert(schema.ShopifyIntegration)
      .values({
        id: shopifyIntegrationId,
        organizationId: this.organizationId,
        createdById: this.userId,
        shopDomain: 'demo-shop.myshopify.com',
        accessToken: 'demo-token',
        scope: 'read_products,read_orders,read_customers',
        enabled: true,
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
    console.log('✅ Demo Shopify integration created')

    return { integrationId, shopifyIntegrationId }
  }
}
