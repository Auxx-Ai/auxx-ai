// packages/credentials/scripts/backfill-credential-v2.ts
//
// One-time, idempotent backfill to crypto v2. Migrates four ciphertext homes:
//   1. Credential.encryptedSecrets — re-encrypt v2 + split secrets/metadata + set real `kind`.
//   2. ApiKey.encryptedSecret      — re-encrypt v2 (pure secret, no split).
//   3. ProviderConfiguration.credentials._encrypted — re-encrypt v2.
//   4. KeyValuePair encrypted config values — re-encrypt v2.
//
// The `v2:` ciphertext prefix is the self-describing migration marker — no progress table.
// Every write is a compare-and-set (WHERE … still-legacy) so a row the live app rewrote to v2
// between read and write is left alone. Per-row failures are collected, never fatal.
//
// Run from packages/credentials with BOTH keys in env:
//   npx dotenv -- npx tsx scripts/backfill-credential-v2.ts --dry-run    # default, writes nothing
//   npx dotenv -- npx tsx scripts/backfill-credential-v2.ts --execute
//
// Phase 6 (after all kind-filter swaps are live): normalize legacy `type` values —
// NULL for app/mcp (owner FK identifies the target), Integration.provider for integration rows:
//   npx dotenv -- npx tsx scripts/backfill-credential-v2.ts --normalize-types

import { database as db, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { decryptSecrets, encryptSecrets, isV2Payload } from '../src/crypto'
import { splitSensitiveFields } from '../src/store/split-sensitive-fields'

const EXECUTE = process.argv.includes('--execute')
const NORMALIZE_TYPES = process.argv.includes('--normalize-types')
const MODE = EXECUTE ? 'EXECUTE' : 'DRY-RUN'

/** OAuth-shaped credentials store exactly these secret keys; everything else is metadata. */
const OAUTH_SECRET_KEYS = ['accessToken', 'refreshToken', 'secret']

/** KeyValuePair filter for encrypted config values (mirrors config-storage's read path). */
const KVP_FILTER = "type = 'CONFIG_VARIABLE' AND isEncrypted = 'true'"

interface TableSummary {
  table: string
  scanned: number
  migrated: number
  alreadyV2: number
  failed: number
}

const failures: { table: string; id: string; org?: string; error: string }[] = []

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Map a legacy `type` to the real `kind`. */
function kindFromType(type: string | null): 'app' | 'mcp' | 'integration' | 'workflow' {
  switch (type) {
    case 'app-connection':
      return 'app'
    case 'mcp-connection':
      return 'mcp'
    case 'integration':
    case 'imap': // IMAP rows are saved workflow-style but linked via Integration.credentialId
      return 'integration'
    default:
      return 'workflow'
  }
}

/**
 * Split a decrypted credential blob into secrets + metadata.
 * OAuth-shaped (app/mcp/integration, except IMAP) uses the fixed secret-key set; IMAP and
 * workflow use {@link splitSensitiveFields} (object-valued fields → secrets wholesale).
 * `expiresAt` never lands in metadata — the column is its only home.
 */
function splitCredential(
  type: string | null,
  kind: string,
  blob: Record<string, unknown>,
  existingMetadata: Record<string, unknown>,
  hasSecretConnVars: boolean
): { secrets: Record<string, unknown>; metadata: Record<string, unknown> } {
  const isOAuthShaped =
    (kind === 'app' || kind === 'mcp' || kind === 'integration') && type !== 'imap'

  if (isOAuthShaped) {
    const secrets: Record<string, unknown> = {}
    // The OAuth blob nests its non-secret companion data under a `metadata` key — spread that
    // bag to the top level of the new metadata column (README: "old metadata bag spread to top
    // level"). connectionVariables are usually URL interpolation values (shop subdomain, etc.).
    const nested = isPlainObject(blob.metadata) ? { ...blob.metadata } : {}
    // If the ConnectionDefinition marks ANY connectionVariable secret, the whole
    // connectionVariables object is a secret (object-valued → secrets wholesale; splitting it
    // would clobber under the shallow `{ ...metadata, ...secrets }` merge — README decision 3).
    if (hasSecretConnVars && isPlainObject(nested.connectionVariables)) {
      secrets.connectionVariables = nested.connectionVariables
      delete nested.connectionVariables
    }
    const metadata: Record<string, unknown> = { ...existingMetadata, ...nested }
    for (const [key, value] of Object.entries(blob)) {
      if (OAUTH_SECRET_KEYS.includes(key)) {
        if (value !== undefined && value !== null) secrets[key] = value
      } else if (key !== 'metadata' && key !== 'expiresAt') {
        metadata[key] = value // other non-secret top-level leftovers (scopes, provider, …)
      }
    }
    return { secrets, metadata }
  }

  // IMAP + workflow: pattern/object-based split.
  const { secrets, metadata } = splitSensitiveFields(blob)
  delete metadata.expiresAt
  return { secrets, metadata: { ...existingMetadata, ...metadata } }
}

/**
 * Owners (appId / mcpServerId) whose ConnectionDefinition marks at least one connectionVariable
 * `secret: true`. For these, the whole connectionVariables object is treated as a secret.
 */
async function loadSecretConnVarOwners(): Promise<Set<string>> {
  const owners = new Set<string>()
  const defs = await db
    .select({
      appId: schema.ConnectionDefinition.appId,
      mcpServerId: schema.ConnectionDefinition.mcpServerId,
      oauth2Features: schema.ConnectionDefinition.oauth2Features,
    })
    .from(schema.ConnectionDefinition)

  for (const d of defs) {
    const vars = (d.oauth2Features as { connectionVariables?: { secret?: boolean }[] } | null)
      ?.connectionVariables
    if (vars?.some((v) => v.secret)) {
      const owner = d.appId ?? d.mcpServerId
      if (owner) owners.add(owner)
    }
  }
  return owners
}

async function backfillCredentials(): Promise<TableSummary> {
  const summary: TableSummary = {
    table: 'Credential',
    scanned: 0,
    migrated: 0,
    alreadyV2: 0,
    failed: 0,
  }
  // Build owner → secret-flagged connectionVariable keys from ConnectionDefinitions, so a
  // secret connection variable (Shopify-style) is never spread into plaintext metadata.
  const secretConnVarOwners = await loadSecretConnVarOwners()

  const rows = await db.select().from(schema.Credential)
  const kindCounts: Record<string, number> = {}
  let printedSample = false

  for (const row of rows) {
    summary.scanned++
    if (isV2Payload(row.encryptedSecrets)) {
      summary.alreadyV2++
      continue
    }
    try {
      const blob = decryptSecrets(row.encryptedSecrets)
      const kind = kindFromType(row.type)
      const existingMetadata = (row.metadata ?? {}) as Record<string, unknown>
      const owner = row.appId ?? row.mcpServerId
      const hasSecretConnVars = owner ? secretConnVarOwners.has(owner) : false
      const { secrets, metadata } = splitCredential(
        row.type,
        kind,
        blob,
        existingMetadata,
        hasSecretConnVars
      )
      kindCounts[kind] = (kindCounts[kind] ?? 0) + 1

      if (!printedSample) {
        printedSample = true
        console.log(
          `  sample: id=${row.id} type=${row.type} → kind=${kind} ` +
            `secretKeys=[${Object.keys(secrets).join(',')}] metadataKeys=[${Object.keys(metadata).join(',')}]`
        )
      }

      if (EXECUTE) {
        const updated = await db
          .update(schema.Credential)
          .set({ kind, encryptedSecrets: encryptSecrets(secrets), metadata, updatedAt: new Date() })
          .where(
            and(
              eq(schema.Credential.id, row.id),
              sql`${schema.Credential.encryptedSecrets} NOT LIKE 'v2:%'`
            )
          )
          .returning({ id: schema.Credential.id })
        if (updated.length === 0) {
          summary.alreadyV2++ // app rewrote it to v2 between read and write
          continue
        }
      }
      summary.migrated++
    } catch (error) {
      summary.failed++
      failures.push({
        table: 'Credential',
        id: row.id,
        org: row.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  console.log(`  kind distribution (migrated this run): ${JSON.stringify(kindCounts)}`)
  return summary
}

async function backfillApiKeys(): Promise<TableSummary> {
  const summary: TableSummary = {
    table: 'ApiKey',
    scanned: 0,
    migrated: 0,
    alreadyV2: 0,
    failed: 0,
  }
  const rows = await db
    .select({ id: schema.ApiKey.id, encryptedSecret: schema.ApiKey.encryptedSecret })
    .from(schema.ApiKey)

  for (const row of rows) {
    if (!row.encryptedSecret) continue // nullable — skip NULLs (not counted as scanned)
    summary.scanned++
    if (isV2Payload(row.encryptedSecret)) {
      summary.alreadyV2++
      continue
    }
    try {
      const v2 = encryptSecrets(decryptSecrets(row.encryptedSecret))
      if (EXECUTE) {
        const updated = await db
          .update(schema.ApiKey)
          .set({ encryptedSecret: v2 })
          .where(
            and(eq(schema.ApiKey.id, row.id), sql`${schema.ApiKey.encryptedSecret} NOT LIKE 'v2:%'`)
          )
          .returning({ id: schema.ApiKey.id })
        if (updated.length === 0) {
          summary.alreadyV2++
          continue
        }
      }
      summary.migrated++
    } catch (error) {
      summary.failed++
      failures.push({
        table: 'ApiKey',
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return summary
}

async function backfillProviderConfigurations(): Promise<TableSummary> {
  const summary: TableSummary = {
    table: 'ProviderConfiguration',
    scanned: 0,
    migrated: 0,
    alreadyV2: 0,
    failed: 0,
  }
  const rows = await db
    .select({
      id: schema.ProviderConfiguration.id,
      credentials: schema.ProviderConfiguration.credentials,
    })
    .from(schema.ProviderConfiguration)

  for (const row of rows) {
    const creds = (row.credentials ?? {}) as Record<string, unknown>
    const encrypted = creds._encrypted
    if (typeof encrypted !== 'string') continue // no encrypted payload — skip
    summary.scanned++
    if (isV2Payload(encrypted)) {
      summary.alreadyV2++
      continue
    }
    try {
      const v2 = encryptSecrets(decryptSecrets(encrypted))
      if (EXECUTE) {
        const updated = await db
          .update(schema.ProviderConfiguration)
          .set({ credentials: { ...creds, _encrypted: v2 } })
          .where(
            and(
              eq(schema.ProviderConfiguration.id, row.id),
              sql`${schema.ProviderConfiguration.credentials}->>'_encrypted' NOT LIKE 'v2:%'`
            )
          )
          .returning({ id: schema.ProviderConfiguration.id })
        if (updated.length === 0) {
          summary.alreadyV2++
          continue
        }
      }
      summary.migrated++
    } catch (error) {
      summary.failed++
      failures.push({
        table: 'ProviderConfiguration',
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return summary
}

async function backfillKeyValuePairs(): Promise<TableSummary> {
  const summary: TableSummary = {
    table: 'KeyValuePair',
    scanned: 0,
    migrated: 0,
    alreadyV2: 0,
    failed: 0,
  }
  // Same selection config-storage uses for reads: encrypted config variables.
  const rows = await db
    .select()
    .from(schema.KeyValuePair)
    .where(
      and(
        eq(schema.KeyValuePair.type, 'CONFIG_VARIABLE'),
        eq(schema.KeyValuePair.isEncrypted, 'true')
      )
    )

  for (const row of rows) {
    const value = row.value
    if (typeof value !== 'string') continue // encrypted config values are stored as a JSON string
    summary.scanned++
    if (isV2Payload(value)) {
      summary.alreadyV2++
      continue
    }
    try {
      const v2 = encryptSecrets(decryptSecrets(value))
      if (EXECUTE) {
        const updated = await db
          .update(schema.KeyValuePair)
          .set({ value: v2, updatedAt: new Date() })
          .where(
            and(
              eq(schema.KeyValuePair.id, row.id),
              sql`${schema.KeyValuePair.value}::text NOT LIKE '"v2:%'`
            )
          )
          .returning({ id: schema.KeyValuePair.id })
        if (updated.length === 0) {
          summary.alreadyV2++
          continue
        }
      }
      summary.migrated++
    } catch (error) {
      summary.failed++
      failures.push({
        table: 'KeyValuePair',
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return summary
}

/**
 * Phase-6 `type` normalization (idempotent, always writes — run after the grep
 * gates confirm no code matches on the legacy strings):
 *   - kind 'app'/'mcp' → type NULL (the owner FK identifies the target)
 *   - kind 'integration' → type = linked Integration.provider ('gmail', 'imap', …)
 */
async function normalizeTypes(): Promise<void> {
  console.log('\n=== Credential `type` normalization ===')

  const nulled = await db
    .update(schema.Credential)
    .set({ type: null })
    .where(and(sql`${schema.Credential.kind} IN ('app','mcp')`, sql`type IS NOT NULL`))
    .returning({ id: schema.Credential.id })
  console.log(`  app/mcp rows set to type=NULL: ${nulled.length}`)

  // Integration.provider is the "IntegrationProviderType" enum — cast to text.
  const integrationResult = await db.execute(sql`
    UPDATE "Credential" c
    SET type = i.provider::text
    FROM "Integration" i
    WHERE i."credentialId" = c.id
      AND c.kind = 'integration'
      AND c.type IS DISTINCT FROM i.provider::text
  `)
  console.log(`  integration rows set to Integration.provider: ${integrationResult.rowCount ?? 0}`)

  const leftovers = await db
    .select({
      id: schema.Credential.id,
      kind: schema.Credential.kind,
      type: schema.Credential.type,
    })
    .from(schema.Credential)
    .where(sql`type IN ('app-connection','mcp-connection','integration')`)
  if (leftovers.length > 0) {
    console.log(`  ⚠️  rows still carrying legacy type values: ${JSON.stringify(leftovers)}`)
    process.exit(1)
  }
  console.log('  no legacy type values remain ✅')
  process.exit(0)
}

async function main() {
  if (NORMALIZE_TYPES) {
    await normalizeTypes()
    return
  }

  console.log(`\n=== Credential v2 backfill — ${MODE} ===`)
  console.log(`KeyValuePair filter: ${KVP_FILTER}\n`)

  console.log('Credential:')
  const credential = await backfillCredentials()
  console.log('ApiKey:')
  const apiKey = await backfillApiKeys()
  console.log('ProviderConfiguration:')
  const providerConfig = await backfillProviderConfigurations()
  console.log('KeyValuePair:')
  const keyValuePair = await backfillKeyValuePairs()

  const summaries = [credential, apiKey, providerConfig, keyValuePair]
  console.log(`\n=== Summary (${MODE}) ===`)
  for (const s of summaries) {
    console.log(
      `  ${s.table.padEnd(22)} scanned=${s.scanned} migrated=${s.migrated} alreadyV2=${s.alreadyV2} failed=${s.failed}`
    )
  }

  if (failures.length > 0) {
    console.log(`\n=== Failures (${failures.length}) ===`)
    for (const f of failures) {
      console.log(`  [${f.table}] id=${f.id}${f.org ? ` org=${f.org}` : ''}: ${f.error}`)
    }
  }

  if (!EXECUTE) {
    console.log('\nDry run — nothing written. Re-run with --execute to apply.')
  }

  const totalFailed = summaries.reduce((n, s) => n + s.failed, 0)
  process.exit(totalFailed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('Backfill crashed:', error)
  process.exit(1)
})
