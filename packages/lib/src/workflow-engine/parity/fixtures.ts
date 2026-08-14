// packages/lib/src/workflow-engine/parity/fixtures.ts

/**
 * Fixture org for the resolvability suite (`resolvability.test.ts` split into
 * `find.resolvability.test.ts` / `crud.resolvability.test.ts`).
 *
 * Two custom entities plus the real `thread` system resource:
 *
 * - **Vendor** (`VENDOR_DEF_ID`) — a plain, user-authored custom entity (NOT one
 *   of `ENTITY_DEFINITION_TYPES`). Per the codebase invariant confirmed by
 *   reading `resource-registry-service.ts` (`mapCustomFieldsToResourceFields`),
 *   a genuinely custom field's `key` is ALWAYS `field.id` — there is no
 *   separate `key` column on `CustomField` at all. This fixture honors that:
 *   every field's `id` and `key` are the SAME string. The strings just happen
 *   to be human-readable (`'name'`, `'region'`, …) rather than cuid-shaped —
 *   nothing in the resolution machinery cares about the string's shape, only
 *   that `id === key`.
 *   - `name` — plain STRING, no `systemAttribute`.
 *   - `code` — STRING with `systemAttribute: 'vendor_code'` (cast — no real
 *     `SystemAttribute` union member fits a fixture entity, and nothing reads
 *     the value for meaning, only for identity).
 *   - `internalNotes` — STRING with `capabilities.hidden: true`.
 *   - `region` — RELATION `belongs_to` → VendorRegion.
 * - **VendorRegion** (`REGION_DEF_ID`) — the relation target, with a
 *   SELF-referential `belongs_to` (`parentRegion`) so the declared tree reaches
 *   a genuine two-hop relation path (`region.parentRegion.name`) without a
 *   third resource — deliberately staying at the "TWO resources" the task
 *   scopes the fixture to.
 *   - `name` — plain STRING.
 *   - `parentRegion` — RELATION `belongs_to` → itself.
 * - **thread** — the real `RESOURCE_FIELD_REGISTRY.thread` fields, imported,
 *   never hand-copied.
 */

import type { TypedFieldValue } from '@auxx/types'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import type { FieldId, ResourceFieldId } from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'
import {
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_MAP,
} from '../../resources/registry/field-registry'
import type { ResourceField } from '../../resources/registry/field-types'
import type { CustomResource, Resource, SystemResource } from '../../resources/registry/types'
import { BaseType } from '../core/types'

export const ORG_ID = 'org_parity_test'
export const USER_ID = 'user_parity_test'
export const WORKFLOW_ID = 'workflow_parity_test'

// ─────────────────────────────────────────────────────────────
// Entity definition ids
// ─────────────────────────────────────────────────────────────

/** CUID2-shaped (>=20 chars, not a system TableId) so `isCustomResourceId` is true. */
export const VENDOR_DEF_ID = 'vendorentitydefcuid00001'
export const REGION_DEF_ID = 'regionentitydefcuid00001'

// ─────────────────────────────────────────────────────────────
// Vendor fields
// ─────────────────────────────────────────────────────────────

const fullCapabilities = {
  filterable: true,
  sortable: true,
  creatable: true,
  updatable: true,
  configurable: true,
}

const vendorRegionRelationship: RelationshipConfig = {
  // Points at VendorRegion's inverse field. The inverse field need not exist
  // in this fixture (nothing looks it up — only `has_many` reciprocal lookups
  // would, and neither relation here is `has_many`); only the entityDefinitionId
  // half is ever read (`getRelatedEntityDefinitionId`).
  inverseResourceFieldId: `${REGION_DEF_ID}:vendors` as ResourceFieldId,
  relationshipType: 'belongs_to',
  isInverse: false,
}

const regionParentRelationship: RelationshipConfig = {
  inverseResourceFieldId: `${REGION_DEF_ID}:childRegions` as ResourceFieldId,
  relationshipType: 'belongs_to',
  isInverse: false,
}

export const VENDOR_NAME_FIELD: ResourceField = {
  id: 'name' as FieldId,
  key: 'name',
  label: 'Name',
  type: BaseType.STRING,
  capabilities: fullCapabilities,
}

/** systemAttribute cast: no real SYSTEM_ATTRIBUTES member fits a fixture entity. */
export const VENDOR_CODE_FIELD: ResourceField = {
  id: 'code' as FieldId,
  key: 'code',
  label: 'Code',
  type: BaseType.STRING,
  systemAttribute: 'vendor_code' as ResourceField['systemAttribute'],
  capabilities: fullCapabilities,
}

export const VENDOR_NOTES_FIELD: ResourceField = {
  id: 'internalNotes' as FieldId,
  key: 'internalNotes',
  label: 'Internal Notes',
  type: BaseType.STRING,
  capabilities: { ...fullCapabilities, hidden: true },
}

export const VENDOR_REGION_FIELD: ResourceField = {
  id: 'region' as FieldId,
  key: 'region',
  label: 'Region',
  type: BaseType.RELATION,
  relationship: vendorRegionRelationship,
  options: { relationship: vendorRegionRelationship },
  capabilities: fullCapabilities,
}

export const VENDOR_FIELDS: ResourceField[] = [
  VENDOR_NAME_FIELD,
  VENDOR_CODE_FIELD,
  VENDOR_NOTES_FIELD,
  VENDOR_REGION_FIELD,
]

// ─────────────────────────────────────────────────────────────
// VendorRegion fields
// ─────────────────────────────────────────────────────────────

export const REGION_NAME_FIELD: ResourceField = {
  id: 'name' as FieldId,
  key: 'name',
  label: 'Name',
  type: BaseType.STRING,
  capabilities: fullCapabilities,
}

export const REGION_PARENT_FIELD: ResourceField = {
  id: 'parentRegion' as FieldId,
  key: 'parentRegion',
  label: 'Parent Region',
  type: BaseType.RELATION,
  relationship: regionParentRelationship,
  options: { relationship: regionParentRelationship },
  capabilities: fullCapabilities,
}

export const REGION_FIELDS: ResourceField[] = [REGION_NAME_FIELD, REGION_PARENT_FIELD]

// ─────────────────────────────────────────────────────────────
// Resource objects (as returned by `findCachedResource`/`getCachedResource`/
// `getCachedResources`, and as `OutputContext.resource`/`allResources`)
// ─────────────────────────────────────────────────────────────

const commonCustomDisplay = {
  primaryDisplayField: null,
  secondaryDisplayField: null,
  avatarField: null,
  defaultSortField: 'updatedAt' as const,
  defaultSortDirection: 'desc' as const,
  orgScopingStrategy: 'direct' as const,
}

export const VENDOR_RESOURCE: CustomResource = {
  id: VENDOR_DEF_ID,
  label: 'Vendor',
  plural: 'Vendors',
  icon: 'truck',
  color: 'blue',
  fields: VENDOR_FIELDS,
  isVisible: true,
  type: 'custom',
  apiSlug: 'vendors',
  entityDefinitionId: VENDOR_DEF_ID,
  organizationId: ORG_ID,
  display: commonCustomDisplay,
}

export const REGION_RESOURCE: CustomResource = {
  id: REGION_DEF_ID,
  label: 'Vendor Region',
  plural: 'Vendor Regions',
  icon: 'globe',
  color: 'green',
  fields: REGION_FIELDS,
  isVisible: true,
  type: 'custom',
  apiSlug: 'vendor-regions',
  entityDefinitionId: REGION_DEF_ID,
  organizationId: ORG_ID,
  display: commonCustomDisplay,
}

/** Tier A: the REAL thread fields, never hand-copied. */
export const THREAD_FIELDS: ResourceField[] = Object.values(RESOURCE_FIELD_REGISTRY.thread ?? {})

export const THREAD_RESOURCE: SystemResource = {
  id: 'thread',
  label: RESOURCE_TABLE_MAP.thread.label,
  plural: RESOURCE_TABLE_MAP.thread.plural,
  icon: RESOURCE_TABLE_MAP.thread.icon,
  color: RESOURCE_TABLE_MAP.thread.color,
  fields: THREAD_FIELDS,
  entityType: 'thread',
  isVisible: true,
  type: 'system',
  apiSlug: RESOURCE_TABLE_MAP.thread.apiSlug,
  entityDefinitionId: 'thread',
  dbName: RESOURCE_TABLE_MAP.thread.dbName,
  display: {
    identifierField: 'id',
    primaryDisplayField: null,
    secondaryDisplayField: null,
    avatarField: null,
    searchFields: ['subject'],
    orgScopingStrategy: 'direct',
  },
}

export const ALL_RESOURCES: Resource[] = [VENDOR_RESOURCE, REGION_RESOURCE, THREAD_RESOURCE]

/**
 * A custom entity with ZERO visible fields — declaration-only fixture (never
 * added to `ALL_RESOURCES`/executed against; nothing backs a query for it).
 * Exists solely to pin the "empty-fields status variables disappeared again"
 * regression class named in the suite's self-check: both
 * `generateFindNodeVariablesFromFields` and `generateCrudNodeVariablesFromFields`
 * special-case `fields.length === 0` to skip ONLY the main record-shaped
 * variable, while the unconditional status block (`count`/`query_info` for
 * find; `success`/`operation`/`resourceType`/`error`/`errorDetails` for crud)
 * must still be declared. See `declaration-only.resolvability.test.ts`.
 */
export const EMPTY_FIELDS_DEF_ID = 'emptyentitydefcuid000001'

export const EMPTY_FIELDS_RESOURCE: CustomResource = {
  id: EMPTY_FIELDS_DEF_ID,
  label: 'Empty',
  plural: 'Empties',
  icon: 'circle',
  color: 'gray',
  fields: [],
  isVisible: true,
  type: 'custom',
  apiSlug: 'empties',
  entityDefinitionId: EMPTY_FIELDS_DEF_ID,
  organizationId: ORG_ID,
  display: commonCustomDisplay,
}

/** Matches `findCachedResource`/`getCachedResource`'s id-or-entityType-or-apiSlug lookup. */
export function findFixtureResource(key: string): Resource | undefined {
  return ALL_RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key)
}

// ─────────────────────────────────────────────────────────────
// Entity instance fixtures (record ids + raw field-value rows for the
// `getEntityInstance` mock — the real DB/service edge `fetchResourceById`
// sits behind)
// ─────────────────────────────────────────────────────────────

export const VENDOR_HIT_INSTANCE_ID = 'vendor_inst_hit'
export const VENDOR_CREATE_INSTANCE_ID = 'vendor_inst_created'
export const VENDOR_UPDATE_INSTANCE_ID = 'vendor_inst_updated'
export const VENDOR_DELETE_INSTANCE_ID = 'vendor_inst_deleted'
export const REGION_INSTANCE_ID = 'region_inst_hit'

export const VENDOR_HIT_RECORD_ID = toRecordId(VENDOR_DEF_ID, VENDOR_HIT_INSTANCE_ID)
export const REGION_RECORD_ID = toRecordId(REGION_DEF_ID, REGION_INSTANCE_ID)

/** One raw `FieldValue`-shaped row, as `getEntityInstance`'s `values` relation returns. */
interface FixtureValueRow {
  field: { id: string; systemAttribute?: string }
  valueText?: string | null
  relatedEntityId?: string | null
  /** Not part of the real row shape — carried here only for `resolveFixtureFieldPath`'s own hop-walking. */
  relatedEntityDefinitionId?: string
}

/** `extractFieldValueScalar`-compatible row for a TEXT field. */
function textRow(
  fieldId: string,
  systemAttribute: string | undefined,
  value: string
): FixtureValueRow {
  return { field: { id: fieldId, systemAttribute }, valueText: value }
}

/** `extractFieldValueScalar`-compatible row for a RELATIONSHIP field. */
function relationRow(
  fieldId: string,
  relatedEntityId: string,
  relatedEntityDefinitionId: string
): FixtureValueRow {
  return { field: { id: fieldId }, relatedEntityId, relatedEntityDefinitionId }
}

/** Vendor instance data keyed by instance id, for the `getEntityInstance` mock. */
export const VENDOR_INSTANCES: Record<
  string,
  {
    id: string
    entityDefinitionId: string
    createdAt: Date
    updatedAt: Date
    values: FixtureValueRow[]
  }
> = {
  [VENDOR_HIT_INSTANCE_ID]: {
    id: VENDOR_HIT_INSTANCE_ID,
    entityDefinitionId: VENDOR_DEF_ID,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    values: [
      textRow('name', undefined, 'Acme Supplies'),
      textRow('code', 'vendor_code', 'V-042'),
      // `internalNotes` deliberately omitted — hidden fields are never
      // declared, so there's nothing to assert resolvable for it.
      relationRow('region', REGION_INSTANCE_ID, REGION_DEF_ID),
    ],
  },
  [VENDOR_CREATE_INSTANCE_ID]: {
    id: VENDOR_CREATE_INSTANCE_ID,
    entityDefinitionId: VENDOR_DEF_ID,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    values: [textRow('name', undefined, 'Globex Parts'), textRow('code', 'vendor_code', 'V-100')],
  },
  [VENDOR_UPDATE_INSTANCE_ID]: {
    id: VENDOR_UPDATE_INSTANCE_ID,
    entityDefinitionId: VENDOR_DEF_ID,
    createdAt: new Date('2026-01-15T00:00:00Z'),
    updatedAt: new Date('2026-02-15T00:00:00Z'),
    values: [textRow('name', undefined, 'Initech Supply'), textRow('code', 'vendor_code', 'V-200')],
  },
}

export const REGION_INSTANCES: Record<
  string,
  {
    id: string
    entityDefinitionId: string
    createdAt: Date
    updatedAt: Date
    values: FixtureValueRow[]
  }
> = {
  [REGION_INSTANCE_ID]: {
    id: REGION_INSTANCE_ID,
    entityDefinitionId: REGION_DEF_ID,
    createdAt: new Date('2025-06-01T00:00:00Z'),
    updatedAt: new Date('2025-06-02T00:00:00Z'),
    values: [
      textRow('name', undefined, 'EMEA'),
      // `parentRegion` deliberately unset — §3.4's hop-two bug means this
      // record is never even fetched, so its own data is moot.
    ],
  },
}

/** Look up one fixture instance by (entityDefinitionId, instanceId) — the two entities this suite has. */
export function findFixtureInstance(entityDefinitionId: string, instanceId: string) {
  if (entityDefinitionId === VENDOR_DEF_ID) return VENDOR_INSTANCES[instanceId]
  if (entityDefinitionId === REGION_DEF_ID) return REGION_INSTANCES[instanceId]
  return undefined
}

/** Convert one fixture row into a `TypedFieldValue` — text or relationship, the only two shapes this suite needs. */
export function buildTypedFieldValue(row: FixtureValueRow, instanceId: string): TypedFieldValue {
  const base = {
    id: `${instanceId}:${row.field.id}`,
    entityId: instanceId,
    fieldId: row.field.id,
    sortKey: 'a0',
    createdAt: '',
    updatedAt: '',
  }
  if (row.relatedEntityId && row.relatedEntityDefinitionId) {
    return {
      ...base,
      type: 'relationship',
      recordId: toRecordId(row.relatedEntityDefinitionId, row.relatedEntityId),
    } as TypedFieldValue
  }
  return { ...base, type: 'text', value: row.valueText ?? '' } as TypedFieldValue
}

/**
 * Walk a `FieldReference` (a single `ResourceFieldId`, or a 2-element
 * `FieldPath` for one relationship hop) starting from `recordId`, resolving
 * each hop against the fixture instance data — the same data
 * `getEntityInstance`'s mock serves, so both lanes agree by construction.
 * Returns `null` when a segment or its relationship target isn't found —
 * `batchGetValues`'s own "no value" answer.
 */
export function resolveFixtureFieldPath(
  segments: string[],
  startRecordId: string
): TypedFieldValue | null {
  let currentInstanceId = startRecordId.split(':').slice(1).join(':')
  let currentDefId = startRecordId.split(':')[0]!

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!
    const colonIndex = segment.indexOf(':')
    const fieldId = colonIndex === -1 ? segment : segment.slice(colonIndex + 1)
    const instance = findFixtureInstance(currentDefId, currentInstanceId)
    const row = instance?.values.find((v) => v.field.id === fieldId)
    if (!row) return null

    if (i === segments.length - 1) {
      return buildTypedFieldValue(row, currentInstanceId)
    }
    if (!row.relatedEntityId || !row.relatedEntityDefinitionId) return null
    currentDefId = row.relatedEntityDefinitionId
    currentInstanceId = row.relatedEntityId
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Tier A (thread) raw Drizzle-row fixture
// ─────────────────────────────────────────────────────────────

export const THREAD_HIT_ID = 'thr_parity_hit'

/**
 * Realistic raw `schema.Thread` row — camelCase columns, exactly what
 * `database.select().from(schema.Thread)` returns. Deliberately diverges from
 * the picker's `systemAttribute` vocabulary the way real rows do: `status`'s
 * systemAttribute is `thread_status` but the column is `status`; `assignee`'s
 * is `assignee_id` but the column is `assigneeId`; `messageCount`'s is
 * `message_count` but the column is `messageCount`. Only `id`/`subject`
 * coincidentally match. This is the fixture that pins §3.2.
 */
export const THREAD_ROW = {
  id: THREAD_HIT_ID,
  externalId: null,
  subject: 'Order #4521 delayed',
  organizationId: ORG_ID,
  integrationId: 'int_parity',
  assigneeId: 'usr_parity_assignee',
  status: 'OPEN',
  messageCount: 3,
  firstMessageAt: new Date('2026-08-01T09:00:00Z'),
  lastMessageAt: new Date('2026-08-12T10:00:00Z'),
  closedAt: null,
  createdAt: new Date('2026-08-01T09:00:00Z'),
}

export const THREAD_ROW_2 = {
  ...THREAD_ROW,
  id: 'thr_parity_hit_2',
  subject: 'Return request',
}
