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
import { resolveConnectionForRuntime } from '../connections/resolve-connection-for-runtime'
import { ensureFreshCredentialToken } from '../credentials/ensure-fresh-credential-token'

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
 * Return a fresh bearer access token for a channel, refreshing lazily through the
 * connection layer (single-flight via `ensureFreshCredentialToken`). This is the
 * channel-side token-supplier seam (§4): the SDK providers (Gmail/Graph) keep owning
 * message ops but get their access token from here instead of owning OAuth refresh.
 *
 * Resolution requires the channel credential to be linked to a ConnectionDefinition
 * (the `gmail`/`outlookMail` def). Reads go ONLY through the resolver — there is no
 * stored-token fallback: an unlinked credential or a resolver failure returns null so the
 * caller fails loudly rather than silently serving a stale/unrefreshed token.
 */
export async function getChannelAccessToken(integrationId: string): Promise<string | null> {
  const [integ] = await db
    .select({
      credentialId: schema.Integration.credentialId,
      organizationId: schema.Integration.organizationId,
    })
    .from(schema.Integration)
    .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
    .limit(1)

  if (!integ?.credentialId) {
    logger.warn('Channel has no linked credential — cannot resolve access token', { integrationId })
    return null
  }

  const resolved = await resolveConnectionForRuntime({
    connectionId: integ.credentialId,
    organizationId: integ.organizationId,
    userId: 'system',
    ensureFresh: true,
  })
  if (resolved.isErr()) {
    logger.error('Failed to resolve channel access token', {
      integrationId,
      error: resolved.error.message,
    })
    return null
  }

  const conn = resolved.value.organizationConnection ?? resolved.value.userConnection
  return conn?.value ?? null
}

/**
 * Force a token refresh for a channel through the connection layer (the 401 / near-expiry retry
 * path). Unlike `getChannelAccessToken` (which only refreshes when at/near expiry), this skips the
 * expiry check — used when the live token just failed. Single-flight + persistence handled by
 * `ensureFreshCredentialToken`; the caller re-reads the rotated token afterwards.
 */
export async function forceRefreshChannelToken(integrationId: string): Promise<void> {
  const [integ] = await db
    .select({
      credentialId: schema.Integration.credentialId,
      organizationId: schema.Integration.organizationId,
    })
    .from(schema.Integration)
    .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
    .limit(1)

  if (!integ?.credentialId) return

  await ensureFreshCredentialToken({
    credentialId: integ.credentialId,
    organizationId: integ.organizationId,
    hasRefreshToken: true,
    force: true,
  })
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
