// apps/api/src/routes/entities/owned-fields.ts

/**
 * Shared ownership resolution for the app-facing entity value-I/O routes.
 *
 * An installed app may only read/write the custom fields it owns. Ownership is
 * resolved entirely from the org cache (`customFields` key carries
 * `appInstallationId` / `appFieldKey` / `connectionId`) — no DB query. A field
 * matches when it belongs to the calling installation, its key matches, and it
 * is either installation-scoped (`connectionId` null) or bound to the agent's
 * active connection. When both an installation-scoped and the bound
 * connection-scoped field share a key, the connection-scoped one wins.
 */

import type { CustomFieldEntity } from '@auxx/database/types'
import { getCachedCustomFields } from '@auxx/lib/cache'
import type { TypedFieldValue } from '@auxx/lib/field-values'

/** Parse a `<entityDefinitionId>:<entityInstanceId>` RecordId. */
export function parseRecordId(
  recordId: string
): { entityDefinitionId: string; entityId: string } | null {
  const idx = recordId.indexOf(':')
  if (idx <= 0 || idx === recordId.length - 1) return null
  return {
    entityDefinitionId: recordId.slice(0, idx),
    entityId: recordId.slice(idx + 1),
  }
}

interface OwnershipScope {
  organizationId: string
  installationId: string
  /** Agent-bound connection id, from the signed entities token (if any). */
  boundConnectionId?: string
  entityDefinitionId: string
}

function isOwnedAccessible(f: CustomFieldEntity, scope: OwnershipScope): boolean {
  if (f.appInstallationId !== scope.installationId) return false
  // Installation-scoped (null) is always accessible; connection-scoped only
  // when it matches the bound connection.
  return f.connectionId == null || f.connectionId === scope.boundConnectionId
}

/** Resolve a single owned field by `appFieldKey`. Returns null when not owned. */
export async function resolveOwnedField(
  scope: OwnershipScope,
  appFieldKey: string
): Promise<CustomFieldEntity | null> {
  const fields = await getCachedCustomFields(scope.organizationId, scope.entityDefinitionId)
  const matches = fields.filter((f) => f.appFieldKey === appFieldKey && isOwnedAccessible(f, scope))
  if (matches.length === 0) return null
  // Prefer the connection-scoped field when a bound connection exists.
  return matches.find((f) => f.connectionId === scope.boundConnectionId) ?? matches[0]!
}

/** List every field this installation owns (+ bound connection) on the entity. */
export async function listOwnedFields(scope: OwnershipScope): Promise<CustomFieldEntity[]> {
  const fields = await getCachedCustomFields(scope.organizationId, scope.entityDefinitionId)
  return fields.filter((f) => f.appFieldKey != null && isOwnedAccessible(f, scope))
}

/** Project a typed field value down to a permissive scalar/JSON for the app. */
export function projectFieldValue(
  v: TypedFieldValue | TypedFieldValue[] | null | undefined
): unknown {
  if (v == null) return null
  if (Array.isArray(v)) return v.map(projectOne)
  return projectOne(v)
}

function projectOne(v: TypedFieldValue): unknown {
  switch (v.type) {
    case 'text':
    case 'number':
    case 'boolean':
    case 'date':
    case 'json':
      return v.value
    case 'option':
      return v.optionId
    case 'relationship':
      return v.recordId
    case 'actor':
      return v.actorId
    default:
      return null
  }
}
