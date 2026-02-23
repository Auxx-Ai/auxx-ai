// packages/lib/src/providers/integration-token-accessor.ts

import { CredentialService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'

const logger = createScopedLogger('integration-token-accessor')

export interface IntegrationTokens {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
}

/**
 * Centralized utility for reading/writing encrypted integration tokens.
 * All OAuth code should use this instead of accessing token fields directly.
 */
export class IntegrationTokenAccessor {
  /**
   * Read tokens from linked WorkflowCredentials (decrypted).
   */
  static async getTokens(integrationId: string): Promise<IntegrationTokens> {
    const [row] = await db
      .select({
        credentialId: schema.Integration.credentialId,
        organizationId: schema.Integration.organizationId,
        encryptedData: schema.WorkflowCredentials.encryptedData,
        credentialOrgId: schema.WorkflowCredentials.organizationId,
        expiresAt: schema.Integration.expiresAt,
      })
      .from(schema.Integration)
      .leftJoin(
        schema.WorkflowCredentials,
        eq(schema.Integration.credentialId, schema.WorkflowCredentials.id)
      )
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!row) throw new Error(`Integration ${integrationId} not found`)

    if (!row.credentialId || !row.encryptedData) {
      return { accessToken: null, refreshToken: null, expiresAt: row.expiresAt }
    }

    if (row.credentialOrgId && row.credentialOrgId !== row.organizationId) {
      logger.error('Cross-org credential link detected', { integrationId })
      throw new Error(`Cross-org credential link blocked for integration ${integrationId}`)
    }

    const data = CredentialService.decrypt(row.encryptedData)
    return {
      accessToken: (data.accessToken as string) ?? null,
      refreshToken: (data.refreshToken as string) ?? null,
      expiresAt: row.expiresAt,
    }
  }

  /**
   * Write tokens: encrypt and store in linked WorkflowCredentials.
   * Creates the WC row + links it if one doesn't exist yet.
   */
  static async setTokens(
    integrationId: string,
    tokens: { accessToken?: string | null; refreshToken?: string | null; expiresAt?: Date | null },
    meta?: { createdById?: string }
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [integration] = await tx
        .select({
          id: schema.Integration.id,
          credentialId: schema.Integration.credentialId,
          organizationId: schema.Integration.organizationId,
          email: schema.Integration.email,
          provider: schema.Integration.provider,
        })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (!integration) throw new Error(`Integration ${integrationId} not found`)

      let credentialId = integration.credentialId

      if (credentialId) {
        // Update existing credential
        const [existing] = await tx
          .select({
            id: schema.WorkflowCredentials.id,
            organizationId: schema.WorkflowCredentials.organizationId,
            encryptedData: schema.WorkflowCredentials.encryptedData,
          })
          .from(schema.WorkflowCredentials)
          .where(eq(schema.WorkflowCredentials.id, credentialId))
          .limit(1)

        if (!existing) {
          throw new Error(`Credential ${credentialId} not found for integration ${integrationId}`)
        }
        if (existing.organizationId !== integration.organizationId) {
          throw new Error(`Cross-org credential link blocked for integration ${integrationId}`)
        }

        const currentData = CredentialService.decrypt(existing.encryptedData) as Record<
          string,
          unknown
        >
        const merged = {
          ...currentData,
          ...(tokens.accessToken !== undefined && { accessToken: tokens.accessToken }),
          ...(tokens.refreshToken !== undefined && { refreshToken: tokens.refreshToken }),
        }

        await tx
          .update(schema.WorkflowCredentials)
          .set({
            encryptedData: CredentialService.encrypt(merged),
            expiresAt: tokens.expiresAt ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(schema.WorkflowCredentials.id, credentialId))
      } else {
        // Create new credential and link it
        const encrypted = CredentialService.encrypt({
          accessToken: tokens.accessToken ?? null,
          refreshToken: tokens.refreshToken ?? null,
        })

        const [credential] = await tx
          .insert(schema.WorkflowCredentials)
          .values({
            organizationId: integration.organizationId,
            createdById: meta?.createdById ?? null,
            name: `${integration.provider} - ${integration.email ?? 'integration'}`,
            type: 'integration',
            encryptedData: encrypted,
            expiresAt: tokens.expiresAt ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning({ id: schema.WorkflowCredentials.id })

        credentialId = credential!.id

        await tx
          .update(schema.Integration)
          .set({ credentialId, updatedAt: new Date() })
          .where(
            and(
              eq(schema.Integration.id, integrationId),
              eq(schema.Integration.organizationId, integration.organizationId)
            )
          )
      }

      // Keep expiresAt on Integration for queryability
      if (tokens.expiresAt !== undefined) {
        await tx
          .update(schema.Integration)
          .set({ expiresAt: tokens.expiresAt ?? null, updatedAt: new Date() })
          .where(eq(schema.Integration.id, integrationId))
      }
    })
  }

  /**
   * Delete the linked WorkflowCredentials row (for revoke/disconnect flows).
   */
  static async deleteTokens(integrationId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [integration] = await tx
        .select({
          credentialId: schema.Integration.credentialId,
          organizationId: schema.Integration.organizationId,
        })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (!integration?.credentialId) return

      await tx
        .update(schema.Integration)
        .set({ credentialId: null, expiresAt: null, updatedAt: new Date() })
        .where(eq(schema.Integration.id, integrationId))

      await tx
        .delete(schema.WorkflowCredentials)
        .where(
          and(
            eq(schema.WorkflowCredentials.id, integration.credentialId),
            eq(schema.WorkflowCredentials.organizationId, integration.organizationId)
          )
        )
    })
  }
}
