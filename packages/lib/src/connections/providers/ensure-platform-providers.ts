// packages/lib/src/connections/providers/ensure-platform-providers.ts
// Idempotent upsert of platform built-in ConnectionDefinition rows (owner =
// providerKey), mirroring the curated-MCP ensure pattern. Called at boot/seed.
// Platform OAuth client id/secret are read from env and ENCRYPTED into the row
// (§9.3), so the runtime path is uniform with app/mcp definitions (no env branch).

import { encryptValue } from '@auxx/credentials/crypto'
import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { PLATFORM_PROVIDER_DEFS } from './defs'
import type { PlatformProviderDef } from './types'

const logger = createScopedLogger('ensure-platform-providers')

const PLATFORM_MAJOR = 1

/**
 * Build the ConnectionDefinition column values for a provider def. OAuth client
 * id/secret are pulled from their named env vars and encrypted; when the env var
 * is unset the column is left `undefined` so existing values are not clobbered.
 */
function toRowValues(def: PlatformProviderDef): Record<string, unknown> {
  const clientId = def.systemClientIdEnv ? process.env[def.systemClientIdEnv] : undefined
  const clientSecret = def.systemClientSecretEnv
    ? process.env[def.systemClientSecretEnv]
    : undefined
  // Approval gate (§3.1): the platform client is usable unless its env flag is an
  // explicit 'false'. Unset → true (ops continuity), so providers without the flag
  // keep working with their platform client.
  const platformClientApproved = def.systemClientApprovedEnv
    ? process.env[def.systemClientApprovedEnv] !== 'false'
    : true

  return {
    providerKey: def.providerKey,
    major: PLATFORM_MAJOR,
    connectionType: def.connectionType,
    label: def.label,
    description: def.description ?? null,
    global: def.global ?? false,
    oauth2AuthorizeUrl: def.oauth2AuthorizeUrl ?? null,
    oauth2AccessTokenUrl: def.oauth2AccessTokenUrl ?? null,
    oauth2RefreshUrl: def.oauth2RefreshUrl ?? null,
    oauth2Scopes: def.oauth2Scopes ?? [],
    oauth2TokenRequestAuthMethod: def.oauth2TokenRequestAuthMethod ?? 'request-body',
    oauth2Features: def.oauth2Features ?? {},
    platformClientApproved,
    connectionVariables: def.connectionVariables ?? [],
    authApply: def.authApply ?? null,
    baseUrlTemplate: def.baseUrlTemplate ?? null,
    // Only write client creds when the env var is set (avoid clobbering on re-upsert).
    ...(clientId ? { oauth2ClientId: encryptValue(clientId) } : {}),
    ...(clientSecret ? { oauth2ClientSecret: encryptValue(clientSecret) } : {}),
  }
}

/**
 * Upsert every platform provider definition. Idempotent: SELECT by
 * (providerKey, major) and UPDATE in place to keep the row id stable so any
 * Credential.connectionDefinitionId FKs survive re-seeds.
 */
export async function ensurePlatformProviders(db: Database = defaultDb): Promise<void> {
  for (const def of PLATFORM_PROVIDER_DEFS) {
    const existing = await db
      .select({ id: schema.ConnectionDefinition.id })
      .from(schema.ConnectionDefinition)
      .where(
        and(
          eq(schema.ConnectionDefinition.providerKey, def.providerKey),
          eq(schema.ConnectionDefinition.major, PLATFORM_MAJOR)
        )
      )
      .limit(1)

    const values = toRowValues(def)

    if (existing.length > 0) {
      await db
        .update(schema.ConnectionDefinition)
        .set(values)
        .where(eq(schema.ConnectionDefinition.id, existing[0]!.id))
    } else {
      await db.insert(schema.ConnectionDefinition).values({
        ...values,
        // Platform rows are catalog-authored, not user-authored.
        createdById: 'system',
      } as typeof schema.ConnectionDefinition.$inferInsert)
    }
  }

  logger.info({ count: PLATFORM_PROVIDER_DEFS.length }, 'Ensured platform connection providers')
}

/** Convenience predicate: is this a platform built-in provider key? */
export function isPlatformProviderKey(providerKey: string): boolean {
  return PLATFORM_PROVIDER_DEFS.some((d) => d.providerKey === providerKey)
}
