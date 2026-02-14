// filepath: /Users/mklooth/Sites/auxx-ai/packages/lib/src/providers/openphone/openphone-service.ts
/**
 * OpenPhoneService handles OpenPhone integration logic for an organization.
 *
 * @file packages/lib/src/providers/openphone/openphone-service.ts
 */
import { type Database, schema } from '@auxx/database'
import type { MessageType } from '@auxx/database/types'
import { and, eq, sql } from 'drizzle-orm'
/**
 * Metadata for OpenPhone integration.
 */
export interface OpenPhoneIntegrationMetadata {
  phoneNumberId: string
  phoneNumber: string
  webhookSigningSecret: string
}
/**
 * Service for managing OpenPhone integrations.
 */
export class OpenPhoneService {
  private db: Database
  private organizationId: string
  private userId: string
  /**
   * Create a new OpenPhoneService instance.
   * @param db Database client instance
   * @param organizationId Organization ID
   * @param userId User ID
   */
  constructor(db: Database, organizationId: string, userId: string) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
  }
  /**
   * Adds a new OpenPhone integration for the organization.
   * Throws if an integration for the phone number already exists.
   * @param input Integration input (apiKey, phoneNumberId, phoneNumber, webhookSigningSecret)
   */
  async addIntegration(input: {
    apiKey: string
    phoneNumberId: string
    phoneNumber: string
    webhookSigningSecret: string
  }) {
    // Prepare metadata
    const metadata: OpenPhoneIntegrationMetadata = {
      phoneNumberId: input.phoneNumberId,
      phoneNumber: input.phoneNumber,
      webhookSigningSecret: input.webhookSigningSecret,
    }
    // Check if integration for this phone number already exists
    const [existing] = await this.db
      .select()
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, this.organizationId),
          eq(schema.Integration.provider, 'openphone'),
          // Note: JSON path queries may need to be handled differently in Drizzle
          // This is a simplified approach - adjust based on your schema
          sql`${schema.Integration.metadata}->>'phoneNumberId' = ${input.phoneNumberId}`
        )
      )
      .limit(1)
    if (existing) {
      throw new Error(
        `OpenPhone integration already exists for phone number ID ${input.phoneNumberId}.`
      )
    }
    // Create the integration
    const [integration] = await this.db
      .insert(schema.Integration)
      .values({
        organizationId: this.organizationId,
        provider: 'openphone',
        accessToken: input.apiKey,
        refreshToken: null,
        expiresAt: null,
        enabled: true,
        metadata: metadata as any,
        messageType: 'SMS' as MessageType,
        settings: {
          recordCreation: {
            mode: 'selective', // Default to selective mode
          },
        },
        updatedAt: new Date(),
      })
      .returning({ id: schema.Integration.id })
    // Optionally: setup webhook here
    // await this.setupWebhook(integration, input)
    return { success: true, integrationId: integration.id }
  }
}
