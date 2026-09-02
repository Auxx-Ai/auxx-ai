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
