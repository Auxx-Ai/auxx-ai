// packages/credentials/src/store/list-credentials.ts

import { database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { fromDb, toRecord } from './internal'
import type {
  CredentialKind,
  CredentialRecord,
  CredentialRecordWithCreator,
  CredentialStoreError,
} from './types'

export interface ListCredentialsInput {
  organizationId: string
  /** A single family or a set of families (matched with `IN`). */
  kind?: CredentialKind | CredentialKind[]
  type?: string
  appId?: string
  appInstallationId?: string
  /** `null` → org-scoped rows only; string → that user; omitted → don't filter. */
  userId?: string | null
  /**
   * Member visibility: return this user's own rows **plus** org-scoped (global)
   * rows — `OR(userId = X, userId IS NULL)`. Used by the Connections page so a
   * non-admin sees their personal connections and shared ones, never another
   * member's personal connection. Ignored when `userId` is set.
   */
  ownedByOrOrgScoped?: string
  /** Join the creator's name (for the credentials UI list). */
  withCreatedBy?: boolean
}

/**
 * List credentials for an org (newest first), filtered by the given criteria. No secrets.
 * With `withCreatedBy`, each record carries the creator's display name.
 */
export async function listCredentials(
  input: ListCredentialsInput & { withCreatedBy: true }
): Promise<Result<CredentialRecordWithCreator[], CredentialStoreError>>
export async function listCredentials(
  input: ListCredentialsInput
): Promise<Result<CredentialRecord[], CredentialStoreError>>
export async function listCredentials(
  input: ListCredentialsInput
): Promise<Result<CredentialRecord[] | CredentialRecordWithCreator[], CredentialStoreError>> {
  const conditions: SQL[] = [eq(schema.Credential.organizationId, input.organizationId)]
  if (Array.isArray(input.kind)) conditions.push(inArray(schema.Credential.kind, input.kind))
  else if (input.kind !== undefined) conditions.push(eq(schema.Credential.kind, input.kind))
  if (input.type !== undefined) conditions.push(eq(schema.Credential.type, input.type))
  if (input.appId !== undefined) conditions.push(eq(schema.Credential.appId, input.appId))
  if (input.appInstallationId !== undefined)
    conditions.push(eq(schema.Credential.appInstallationId, input.appInstallationId))
  if ('userId' in input) {
    conditions.push(
      input.userId === null
        ? isNull(schema.Credential.userId)
        : eq(schema.Credential.userId, input.userId as string)
    )
  } else if (input.ownedByOrOrgScoped !== undefined) {
    const ownOrShared = or(
      eq(schema.Credential.userId, input.ownedByOrOrgScoped),
      isNull(schema.Credential.userId)
    )
    if (ownOrShared) conditions.push(ownOrShared)
  }

  if (input.withCreatedBy) {
    const rowsResult = await fromDb(
      database
        .select({ credential: schema.Credential, createdByName: schema.User.name })
        .from(schema.Credential)
        .leftJoin(schema.User, eq(schema.Credential.createdById, schema.User.id))
        .where(and(...conditions))
        .orderBy(desc(schema.Credential.createdAt)),
      'list-credentials-with-creator'
    )
    if (rowsResult.isErr()) return err(rowsResult.error)
    return ok(
      rowsResult.value.map((r) => ({
        ...toRecord(r.credential as never),
        createdByName: r.createdByName,
      }))
    )
  }

  const rowsResult = await fromDb(
    database
      .select()
      .from(schema.Credential)
      .where(and(...conditions))
      .orderBy(desc(schema.Credential.createdAt)),
    'list-credentials'
  )
  if (rowsResult.isErr()) return err(rowsResult.error)
  return ok(rowsResult.value.map((row) => toRecord(row as never)))
}
