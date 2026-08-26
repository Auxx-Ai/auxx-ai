// packages/lib/src/connections/providers/ensure-platform-providers.ts
// Idempotent upsert of platform built-in ConnectionDefinition rows (owner =
// providerKey), mirroring the curated-MCP ensure pattern. Called at boot/seed.
// Platform OAuth client id/secret are read from env and ENCRYPTED into the row
// (§9.3), so the runtime path is uniform with app/mcp definitions (no env branch).

import { configService } from '@auxx/credentials'
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
 * id/secret are pulled from their named config keys and encrypted; when the key
 * resolves to nothing the column is left `undefined` so existing values are not
 * clobbered.
 *
 * Read through `configService`, not `process.env` directly: it resolves a DB
 * override first and falls back to `process.env`, so with
 * `IS_CONFIG_VARIABLES_IN_DB_ENABLED` on, rotating a platform OAuth client is an
 * edit in the admin config panel plus a reseed — no environment change, no
 * restart, no release. With the flag off this is exactly the previous behaviour.
 */
function toRowValues(def: PlatformProviderDef): Record<string, unknown> {
  const clientId = def.systemClientIdEnv
    ? configService.get<string>(def.systemClientIdEnv)
    : undefined
  const clientSecret = def.systemClientSecretEnv
    ? configService.get<string>(def.systemClientSecretEnv)
    : undefined
  // Approval gate (§3.1): the platform client is usable unless its flag is an
  // explicit 'false'. Unset → true (ops continuity), so providers without the flag
  // keep working with their platform client.
  const platformClientApproved = def.systemClientApprovedEnv
    ? configService.get<string>(def.systemClientApprovedEnv) !== 'false'
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
    oauth2OptionalScopes: def.oauth2OptionalScopes ?? [],
    oauth2TokenRequestAuthMethod: def.oauth2TokenRequestAuthMethod ?? 'request-body',
    oauth2Features: def.oauth2Features ?? {},
    platformClientApproved,
    connectionVariables: def.connectionVariables ?? [],
    authApply: def.authApply ?? null,
    baseUrlTemplate: def.baseUrlTemplate ?? null,
    // Stamped explicitly because the column has no `$onUpdate`. Without it a reseed
    // leaves no trace in the row at all, and the one question this operation exists
    // to answer — "did my new client secret actually land?" — has no answer in the
    // database. The log line below says WHICH providers got creds; this says when.
    updatedAt: new Date(),
    // Only write client creds when config resolves a value (avoid clobbering on
    // re-upsert from a process whose env carries only some of them).
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
  /** Providers whose system client id AND secret both resolved this run. */
  const credentialed: string[] = []
  /** Providers that declare a system client but whose config carried no value. */
  const skipped: string[] = []

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

    // A def that declares a system client but resolved no value is the silent
    // failure mode of this whole operation: the columns are deliberately left
    // untouched rather than nulled, so the run reports success while the row keeps
    // the PREVIOUS secret. Naming those providers is what makes a missing or
    // misspelled config key visible instead of looking like a no-op success.
    if (def.systemClientIdEnv || def.systemClientSecretEnv) {
      ;(values.oauth2ClientId && values.oauth2ClientSecret ? credentialed : skipped).push(
        def.providerKey
      )
    }

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

  logger.info('Ensured platform connection providers', {
    count: PLATFORM_PROVIDER_DEFS.length,
    credentialed,
    // Non-empty here means those providers kept whatever secret was baked before —
    // check the config keys named by their `systemClientIdEnv`/`systemClientSecretEnv`.
    skippedMissingConfig: skipped,
  })
}

/** Convenience predicate: is this a platform built-in provider key? */
export function isPlatformProviderKey(providerKey: string): boolean {
  return PLATFORM_PROVIDER_DEFS.some((d) => d.providerKey === providerKey)
}
