// packages/lib/src/providers/channel-token-accessor.ts

import {
  deleteCredential,
  insertCredential,
  mergeSecrets,
  revealSecrets,
  updateCredential,
} from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'

const logger = createScopedLogger('channel-tokens')

export interface ChannelTokens {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
}

/** Secret material stored for an Integration-linked channel credential. */
interface ChannelSecrets {
  accessToken?: string | null
  refreshToken?: string | null
}

/**
 * Read the OAuth tokens for an Integration from its linked credential (decrypted via the store).
 * The store's org filter enforces the cross-org guard — a credential linked from another org
 * resolves to "not found" and throws.
 */
export async function getChannelTokens(integrationId: string): Promise<ChannelTokens> {
  const [row] = await db
    .select({
      credentialId: schema.Integration.credentialId,
      organizationId: schema.Integration.organizationId,
      expiresAt: schema.Integration.expiresAt,
    })
    .from(schema.Integration)
    .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
    .limit(1)

  if (!row) throw new Error(`Channel ${integrationId} not found`)

  if (!row.credentialId) {
    return { accessToken: null, refreshToken: null, expiresAt: row.expiresAt }
  }

  const revealed = await revealSecrets<ChannelSecrets>(row.credentialId, row.organizationId)
  if (revealed.isErr()) {
    logger.error('Failed to read channel tokens', {
      integrationId,
      error: revealed.error.message,
    })
    throw new Error(`Failed to read tokens for channel ${integrationId}`)
  }

  const { secrets } = revealed.value
  return {
    accessToken: secrets.accessToken ?? null,
    refreshToken: secrets.refreshToken ?? null,
    expiresAt: row.expiresAt,
  }
}

/**
 * Write the OAuth tokens for an Integration: merge into the linked credential, or create + link
 * a new `integration` credential if none exists yet. `expiresAt` is mirrored onto the Integration
 * for queryability. The store calls run outside the Integration-side update (same consistency as
 * the previous encrypt-then-update — fine pre-launch).
 */
export async function setChannelTokens(
  integrationId: string,
  tokens: { accessToken?: string | null; refreshToken?: string | null; expiresAt?: Date | null },
  meta?: { createdById?: string }
): Promise<void> {
  const [channel] = await db
    .select({
      id: schema.Integration.id,
      credentialId: schema.Integration.credentialId,
      organizationId: schema.Integration.organizationId,
      email: schema.Integration.email,
      provider: schema.Integration.provider,
    })
    .from(schema.Integration)
    .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
    .limit(1)

  if (!channel) throw new Error(`Channel ${integrationId} not found`)

  if (channel.credentialId) {
    // mergeSecrets keeps existing values for undefined/'' — only the supplied tokens change.
    const merged = await mergeSecrets(channel.credentialId, channel.organizationId, {
      accessToken: tokens.accessToken ?? undefined,
      refreshToken: tokens.refreshToken ?? undefined,
    })
    if (merged.isErr()) {
      throw new Error(
        `Failed to update tokens for channel ${integrationId}: ${merged.error.message}`
      )
    }
    if (tokens.expiresAt !== undefined) {
      await updateCredential(channel.credentialId, channel.organizationId, {
        expiresAt: tokens.expiresAt ?? null,
      })
    }
  } else {
    const created = await insertCredential({
      organizationId: channel.organizationId,
      createdById: meta?.createdById ?? null,
      kind: 'integration',
      type: channel.provider,
      name: `${channel.provider} - ${channel.email ?? 'channel'}`,
      secrets: {
        accessToken: tokens.accessToken ?? null,
        refreshToken: tokens.refreshToken ?? null,
      },
      expiresAt: tokens.expiresAt ?? null,
    })
    if (created.isErr()) {
      throw new Error(`Failed to create credentials for channel ${integrationId}`)
    }

    await db
      .update(schema.Integration)
      .set({ credentialId: created.value.id, updatedAt: new Date() })
      .where(
        and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, channel.organizationId)
        )
      )
  }

  // Keep expiresAt on Integration for queryability.
  if (tokens.expiresAt !== undefined) {
    await db
      .update(schema.Integration)
      .set({ expiresAt: tokens.expiresAt ?? null, updatedAt: new Date() })
      .where(eq(schema.Integration.id, integrationId))
  }
}

/** Unlink and delete the credential for an Integration (revoke/disconnect flows). */
export async function deleteChannelTokens(integrationId: string): Promise<void> {
  const [channel] = await db
    .select({
      credentialId: schema.Integration.credentialId,
      organizationId: schema.Integration.organizationId,
    })
    .from(schema.Integration)
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)

  if (!channel?.credentialId) return

  await db
    .update(schema.Integration)
    .set({ credentialId: null, expiresAt: null, updatedAt: new Date() })
    .where(eq(schema.Integration.id, integrationId))

  await deleteCredential(channel.credentialId, channel.organizationId)
}
