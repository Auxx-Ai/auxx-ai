// packages/lib/src/connections/credential-reads.ts
// The metadata-only, no-decrypt read of a `Credential`'s app binding. Callers that only
// need "which app/installation owns this credential" (never the secret) belong here
// instead of writing `schema.Credential` joins by hand — see `resolveConnectionForRuntime`
// for the one that also decrypts.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull, type SQL } from 'drizzle-orm'

/** A credential's non-secret app binding. Never carries `encryptedSecrets`. */
export interface AppCredential {
  id: string
  appId: string | null
  /** From the joined `App`; null if the app row is gone. */
  appSlug: string | null
  /**
   * The credential's LIVE installation — only set when the joined `AppInstallation`
   * matches this org/app and isn't uninstalled. Null distinguishes "app uninstalled"
   * from "never connected", which callers such as `book-connections` branch on.
   */
  appInstallationId: string | null
  kind: string
  userId: string | null
  label: string | null
  name: string
  metadata: Record<string, unknown>
}

const APP_CREDENTIAL_COLUMNS = {
  id: schema.Credential.id,
  appId: schema.Credential.appId,
  appSlug: schema.App.slug,
  appInstallationId: schema.AppInstallation.id,
  kind: schema.Credential.kind,
  userId: schema.Credential.userId,
  label: schema.Credential.label,
  name: schema.Credential.name,
  metadata: schema.Credential.metadata,
}

/** LEFT join condition for "this credential's app is currently installed for this org". */
function liveInstallationJoin(organizationId: string): SQL {
  return and(
    eq(schema.AppInstallation.id, schema.Credential.appInstallationId),
    eq(schema.AppInstallation.organizationId, organizationId),
    eq(schema.AppInstallation.appId, schema.Credential.appId),
    isNull(schema.AppInstallation.uninstalledAt)
  ) as SQL
}

/**
 * One credential's app/installation identity by id — LEFT joins so a missing App or an
 * uninstalled app stay distinguishable from a credential that never existed.
 */
export async function readAppCredential(
  db: Database | Transaction,
  organizationId: string,
  credentialId: string
): Promise<AppCredential | null> {
  const [row] = await db
    .select(APP_CREDENTIAL_COLUMNS)
    .from(schema.Credential)
    .leftJoin(schema.App, eq(schema.App.id, schema.Credential.appId))
    .leftJoin(schema.AppInstallation, liveInstallationJoin(organizationId))
    .where(
      and(
        eq(schema.Credential.organizationId, organizationId),
        eq(schema.Credential.id, credentialId)
      )
    )
    .limit(1)
  return row ?? null
}

export interface ListAppCredentialsFilter {
  appSlug?: string
  /** Widened for `disconnectAccountingInstallationInTx` — a caller with an installation, not a slug. */
  appInstallationId?: string
  orgScopedOnly?: boolean
}

/** The org's app credentials with a live installation, kind `'app'` only. */
export async function listAppCredentials(
  db: Database | Transaction,
  organizationId: string,
  filter: ListAppCredentialsFilter
): Promise<AppCredential[]> {
  const conditions = [
    eq(schema.Credential.organizationId, organizationId),
    eq(schema.Credential.kind, 'app'),
  ]
  if (filter.orgScopedOnly) conditions.push(isNull(schema.Credential.userId))
  if (filter.appSlug) conditions.push(eq(schema.App.slug, filter.appSlug))
  if (filter.appInstallationId)
    conditions.push(eq(schema.Credential.appInstallationId, filter.appInstallationId))
  return db
    .select(APP_CREDENTIAL_COLUMNS)
    .from(schema.Credential)
    .innerJoin(schema.App, eq(schema.App.id, schema.Credential.appId))
    .innerJoin(schema.AppInstallation, liveInstallationJoin(organizationId))
    .where(and(...conditions))
}
