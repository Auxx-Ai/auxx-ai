// packages/lib/src/identity/external-link.ts

import { getCredential } from '@auxx/credentials/store'
import type { Database, Transaction } from '@auxx/database'
import type { RecordIdentityEntity } from '@auxx/database/types'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { err, ok, type Result } from 'neverthrow'
import { getCachedIdentityLink, getCachedResourceFields } from '../cache'
import { readFieldRelations, readFieldScalars } from '../field-values/read-field-scalars'
import type { ResourceField } from '../resources/registry/field-types'
import { getRecordIdentitiesForRecords } from './batch'
import { interpolateLinkTemplate, type LinkVariable, parseLinkTemplate } from './link-template'

type DbHandle = Database | Transaction

/** `{connection.identity}` is sugar for the tenant handle the connect flow stamps. */
const IDENTITY_METADATA_KEY = '__identity'

export interface ResolveExternalLinkInput {
  organizationId: string
  recordId: RecordId
  source: string
  connectionId: string | null
}

/**
 * The deep link for one record in one external system, composed at read time
 * from the identity field's `link` template. `ok(null)` whenever the app
 * declares no template or any variable resolves to nothing — a half URL is
 * never returned. See plans/data-connectors/external-record-link-plan.md §5.
 */
export async function resolveExternalLink(
  db: DbHandle | undefined,
  input: ResolveExternalLinkInput
): Promise<Result<string | null, Error>> {
  const { organizationId, recordId, source, connectionId } = input
  try {
    const grouped = await getRecordIdentitiesForRecords(organizationId, [recordId], db)
    const rows = (grouped.get(recordId) ?? []).filter(
      (row) => row.source === source && (row.connectionId ?? null) === connectionId
    )

    for (const row of rows) {
      const template = await getCachedIdentityLink(organizationId, source, row.appFieldKey)
      if (!template) continue
      const values = await resolveVariables(db, input, row, parseLinkTemplate(template))
      const href = interpolateLinkTemplate(
        template,
        (variable) => values.get(key(variable)) ?? null
      )
      if (!href) return ok(null)
      return ok(isHttps(href) ? href : null)
    }
    return ok(null)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/** Resolve each distinct variable once; `null` for anything the record cannot supply. */
async function resolveVariables(
  db: DbHandle | undefined,
  input: ResolveExternalLinkInput,
  row: RecordIdentityEntity,
  variables: LinkVariable[]
): Promise<Map<string, string | null>> {
  const { organizationId, recordId, source, connectionId } = input
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const values = new Map<string, string | null>()

  let metadata: Record<string, unknown> | null | undefined
  let fields: ResourceField[] | undefined

  for (const variable of variables) {
    if (values.has(key(variable))) continue

    if (variable.kind === 'externalId') {
      values.set(key(variable), row.externalId)
      continue
    }

    if (variable.kind === 'connection') {
      if (metadata === undefined)
        metadata = await loadConnectionMetadata(organizationId, connectionId)
      const raw =
        metadata?.[variable.key === 'identity' ? IDENTITY_METADATA_KEY : variable.key] ?? null
      values.set(key(variable), scalarToString(raw))
      continue
    }

    fields ??= await getCachedResourceFields(organizationId, entityDefinitionId)

    if (variable.kind === 'field') {
      const field =
        fields.find((f) => f.appFieldKey === variable.key) ??
        fields.find((f) => f.systemAttribute === variable.key)
      if (!field) {
        values.set(key(variable), null)
        continue
      }
      const scalars = await readFieldScalars(db, organizationId, [entityInstanceId], [field.id])
      values.set(key(variable), scalarToString(scalars.get(entityInstanceId)?.get(field.id)))
      continue
    }

    const relation = fields.find((f) => f.systemAttribute === variable.relationship)
    if (!relation) {
      values.set(key(variable), null)
      continue
    }
    const relations = await readFieldRelations(
      db,
      organizationId,
      [entityInstanceId],
      [relation.id]
    )
    const parentInstanceId = relations.get(entityInstanceId)?.get(relation.id)
    if (!parentInstanceId) {
      values.set(key(variable), null)
      continue
    }
    // The def half is only this map's key — the identity lookup is by instance id.
    const parentDefId =
      relation.relationship?.inverseResourceFieldId?.split(':')[0] ?? entityDefinitionId
    const parentRecordId = toRecordId(parentDefId, parentInstanceId)
    const parentRows = await getRecordIdentitiesForRecords(organizationId, [parentRecordId], db)
    const match = (parentRows.get(parentRecordId) ?? []).find(
      (r) =>
        r.source === source &&
        (r.connectionId ?? null) === connectionId &&
        r.appFieldKey === variable.appFieldKey
    )
    values.set(key(variable), match?.externalId ?? null)
  }

  return values
}

/** Plaintext connection metadata only — the secret half never reaches a template. */
async function loadConnectionMetadata(
  organizationId: string,
  connectionId: string | null
): Promise<Record<string, unknown> | null> {
  if (!connectionId) return null
  const result = await getCredential(connectionId, organizationId)
  return result.isErr() ? null : (result.value.metadata ?? null)
}

function scalarToString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function isHttps(href: string): boolean {
  try {
    return new URL(href).protocol === 'https:'
  } catch {
    return false
  }
}

function key(variable: LinkVariable): string {
  switch (variable.kind) {
    case 'externalId':
      return 'externalId'
    case 'connection':
      return `connection.${variable.key}`
    case 'field':
      return `field.${variable.key}`
    default:
      return `via.${variable.relationship}.${variable.appFieldKey}`
  }
}
