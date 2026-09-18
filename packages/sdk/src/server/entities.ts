// packages/sdk/src/server/entities.ts

/**
 * Entity value I/O for app-owned custom fields.
 *
 * An installed app reads and writes the **values** of the custom fields it
 * owns, scoped so it can only touch its own fields (`key` — no app prefix,
 * resolved within the caller's installation). Connection-scoped fields
 * resolve against the agent-bound connection.
 *
 * All implementations are injected by the Auxx platform at runtime via the
 * `AUXX_SERVER_SDK` global (same mechanism as `@auxx/sdk/server` settings /
 * connections). The generated per-app `.auxx/app-fields.d.ts` augments
 * {@link AppOwnedFieldRegistry}, narrowing these permissive signatures to the
 * app's own field `key` union and per-field value types (Layer 2).
 */

import type { AppFieldDefinition, AppFieldValues } from '../root/fields/define-field.js'
import type { EntityRefKind } from '../root/tools/types.js'

/** Permissive write value — the route routes it to the field's typed column. */
export type FieldValueInput = string | number | boolean | Date | Record<string, unknown> | null

/** Permissive read value — narrowed per-field by the generated app types. */
export type FieldValueOut = string | number | boolean | Record<string, unknown> | null

/**
 * Per-app field registry seam (Layer 2). The base SDK ships this **empty**; the
 * generated `.auxx/app-fields.d.ts` augments it with `fields: typeof app['fields']`
 * so the value-I/O functions below narrow to the app's declared keys and value
 * types. An app that declares no fields — and the base package itself — falls
 * back to the permissive signatures.
 *
 * @see generate-app-fields-types.ts (emits the augmentation)
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation seam — populated per-app by codegen.
export interface AppOwnedFieldRegistry {}

/**
 * The app's declared `fields[]` when the registry is augmented, else `null`
 * (→ permissive fallback). An empty `fields: []` is also treated as unregistered
 * so a zero-field app keeps today's permissive behavior.
 */
type RegisteredFields = AppOwnedFieldRegistry extends {
  fields: infer F extends readonly AppFieldDefinition[]
}
  ? F extends readonly []
    ? null
    : F
  : null

/** `key → value` write map — permissive record when unregistered. */
type WriteMap = RegisteredFields extends readonly AppFieldDefinition[]
  ? Partial<AppFieldValues<RegisteredFields>>
  : Record<string, FieldValueInput>

/** Union of the app's declared field `key`s — any string when unregistered. */
type FieldKey = RegisteredFields extends readonly AppFieldDefinition[]
  ? keyof AppFieldValues<RegisteredFields> & string
  : string

/** Read value type for a single key — per-field (nullable) when registered. */
type ReadValue<K extends FieldKey> = RegisteredFields extends readonly AppFieldDefinition[]
  ? K extends keyof AppFieldValues<RegisteredFields>
    ? AppFieldValues<RegisteredFields>[K] | null
    : FieldValueOut | null
  : FieldValueOut | null

/** Read map type for a bulk read — per-field (nullable) when registered. */
type ReadValuesMap = RegisteredFields extends readonly AppFieldDefinition[]
  ? Partial<{
      [K in keyof AppFieldValues<RegisteredFields>]: AppFieldValues<RegisteredFields>[K] | null
    }>
  : Record<string, FieldValueOut | null>

/** A resolved auxx record reference + its display name. */
export interface EntityRef {
  recordId: string
  displayName: string | null
}

/**
 * Selection for {@link getRecord} / {@link getRecords}
 * (plans/apps/outbound/01-records-api.md §1/§3). Shape duplicated from
 * `@auxx/lib/resources`'s `ReadOptions` — the SDK has no dependency on
 * `@auxx/lib` (see `packages/sdk/package.json`), so this can't be a shared
 * import. One `ReadOptions` applies to every id in a call; a `fields`/
 * `include` key a record's definition doesn't have is simply absent on that
 * node, never an error.
 */
export interface ReadOptions {
  /** Field keys to project. Default: every field on the def. */
  fields?: string[]
  /** Relationship keys to expand, one level per entry. */
  include?: Record<string, ReadOptions>
}

/**
 * A whole record read back through {@link ReadOptions} — its own values plus
 * expanded relationships. Same absent-means-hidden rule as every other
 * lookup here: a record the caller's user can't see is missing from a
 * {@link getRecords} map entirely (never `null`), and {@link getRecord}
 * itself returns `null` for the same record.
 */
export interface RecordNode {
  recordId: string
  entityDefinitionId: string
  displayName: string | null
  /** Native fields are a permissive scalar/JSON projection (`FieldValueOut`); an app's own identity fields narrow via the generated `.auxx/app-fields.d.ts`. */
  values: Record<string, FieldValueOut | FieldValueOut[]>
  included: Record<string, RecordNode | RecordNode[]>
  /** Field keys and include keys the caller's scope withheld. Never a refusal — the caller decides what to do with a non-empty list. */
  redacted: string[]
}

function sdkOrThrow(): any {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    return (global as any).AUXX_SERVER_SDK
  }
  throw new Error(
    '[auxx/server] Server SDK not available. This code must run in the Auxx server environment.'
  )
}

/**
 * Write field values for one record (map form) or many records (entries form).
 * The app may only write fields it owns — a key it doesn't own fails the call.
 *
 * @example
 * ```typescript
 * import { setFieldValues } from '@auxx/sdk/server'
 *
 * await setFieldValues(recordId, { customerId: 'gid://shopify/Customer/123' })
 * await setFieldValues([
 *   { recordId: a, values: { lifetimeValue: 1200 } },
 *   { recordId: b, values: { lifetimeValue: 80 } },
 * ])
 * ```
 */
export async function setFieldValues(recordId: string, values: WriteMap): Promise<void>
export async function setFieldValues(
  entries: Array<{ recordId: string; values: WriteMap }>
): Promise<void>
export async function setFieldValues(
  recordIdOrEntries: string | Array<{ recordId: string; values: WriteMap }>,
  values?: WriteMap
): Promise<void> {
  return sdkOrThrow().setFieldValues(recordIdOrEntries, values)
}

/**
 * Read a single owned field's value for a record. Returns null when unset.
 *
 * @example
 * ```typescript
 * import { getFieldValue } from '@auxx/sdk/server'
 *
 * const customerId = await getFieldValue(recordId, 'customerId')
 * ```
 */
export async function getFieldValue<K extends FieldKey>(
  recordId: string,
  fieldKey: K
): Promise<ReadValue<K>> {
  return sdkOrThrow().getFieldValue(recordId, fieldKey)
}

/**
 * Read owned field values for a record as a `fieldKey → value` map. Omit
 * `fieldKeys` to read every field this installation owns on the record.
 */
export async function getFieldValues(
  recordId: string,
  fieldKeys?: FieldKey[]
): Promise<ReadValuesMap> {
  return sdkOrThrow().getFieldValues(recordId, fieldKeys)
}

/**
 * Reverse lookup: which record holds this value on an owned field? Resolves
 * within the agent-bound connection for connection-scoped fields.
 */
export async function findRecordByFieldValue(input: {
  targetEntity: EntityRefKind
  fieldKey: FieldKey
  value: string
}): Promise<EntityRef | null> {
  return sdkOrThrow().findRecordByFieldValue(input)
}

/**
 * Resolve a record by an integration's external id
 * (`refs.entity('<kind>')` resolution from an imported integration source).
 */
export async function findByIntegrationId(input: {
  kind: EntityRefKind
  source: string
  externalId: string
}): Promise<EntityRef | null> {
  return sdkOrThrow().findByIntegrationId(input)
}

/** Resolve a contact by any of its email addresses (case-insensitive). */
export async function findContactByEmail(input: { email: string }): Promise<EntityRef | null> {
  return sdkOrThrow().findContactByEmail(input)
}

/** Resolve a contact by any of its phone numbers (normalized to E.164 server-side). */
export async function findContactByPhone(input: { phone: string }): Promise<EntityRef | null> {
  return sdkOrThrow().findContactByPhone(input)
}

/**
 * Read a whole record — fields, related records, and the app's own identity
 * fields on them — under the invoking user's capabilities. `null` when that
 * user can't see the record (same non-enumeration contract the route uses:
 * a hidden record and a missing one look identical).
 *
 * User-initiated invocations only (record actions, dialogs, quick actions):
 * a server function invoked with no real user behind it has nothing to call
 * this with.
 *
 * @example
 * ```typescript
 * import { getRecord } from '@auxx/sdk/server'
 *
 * const order = await getRecord(recordId, {
 *   include: { line_items: {}, customer: {} },
 * })
 * ```
 */
export async function getRecord(recordId: string, opts?: ReadOptions): Promise<RecordNode | null> {
  return sdkOrThrow().getRecord(recordId, opts)
}

/**
 * {@link getRecord} for a batch of ids, keyed by `recordId`. A record the
 * invoking user can't see is absent from the map, not `null` — a caller
 * with a list of ids looks each one up without re-scanning.
 */
export async function getRecords(
  recordIds: string[],
  opts?: ReadOptions
): Promise<Record<string, RecordNode>> {
  return sdkOrThrow().getRecords(recordIds, opts)
}

/** One field of a {@link ResourceNode}; `key` is the key {@link RecordNode.values} uses. */
export interface ResourceFieldNode {
  id: string
  key: string
  systemAttribute?: string
  label: string
  type: string
  fieldType?: string
  options?: Record<string, unknown>
  capabilities: Record<string, boolean | undefined>
  validation?: Record<string, unknown>
  relationship?: {
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
    inverseResourceFieldId: string | null
  }
  /** Set on an app-registered field — find your own by `appSlug` + `appFieldKey`. */
  appSlug?: string
  appFieldKey?: string
  dataConnectorId?: string
}

/**
 * The schema of one resource (system or custom entity definition) — what an app can act on
 * (plans/apps/outbound/01-records-api.md §4). Same absent-means-hidden rule as records.
 */
export interface ResourceNode {
  id: string
  entityDefinitionId: string
  apiSlug: string
  entityType?: string
  type: 'system' | 'custom'
  label: string
  plural: string
  icon: string
  color: string
  dataConnectorId?: string
  fields: ResourceFieldNode[]
}

/**
 * Every resource the invoking user can see, with all fields — system, custom, app and
 * connector fields alike.
 *
 * @example
 * ```typescript
 * import { getResources } from '@auxx/sdk/server'
 *
 * const orders = (await getResources()).find((r) => r.entityType === 'order')
 * ```
 */
export async function getResources(): Promise<ResourceNode[]> {
  return sdkOrThrow().getResources()
}

/** One resource by definition id, `entityType` or `apiSlug`; `null` when missing or not visible. */
export async function getResource(idOrSlug: string): Promise<ResourceNode | null> {
  return sdkOrThrow().getResource(idOrSlug)
}
