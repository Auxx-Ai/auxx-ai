// packages/lib/src/identity/types.ts

/**
 * Fields needed to write or mirror one identity link into `RecordIdentity`.
 * Upserts on the record+kind unique key
 * `(entityInstanceId, source, connectionId, appFieldKey)` — "this record's
 * identity of this kind is X".
 */
export interface UpsertRecordIdentityInput {
  organizationId: string
  entityInstanceId: string
  entityDefinitionId: string
  source: string
  appInstallationId?: string | null
  connectionId?: string | null
  appFieldKey?: string | null
  fieldId?: string | null
  externalId: string
}

/** Identifies the mirror row to remove when an identity cell is cleared. */
export interface DeleteRecordIdentityInput {
  organizationId: string
  entityInstanceId: string
  source: string
  connectionId?: string | null
  appFieldKey?: string | null
}

export interface FindRecordByIdentityInput {
  organizationId: string
  entityDefinitionId: string
  source: string
  externalId: string
  connectionId?: string | null
  appFieldKey?: string | null
}

export interface RecordIdentityMatch {
  recordId: string
  displayName: string | null
}
