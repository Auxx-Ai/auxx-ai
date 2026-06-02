// packages/sdk/src/server/entities.ts

/**
 * Entity value I/O for app-owned custom fields.
 *
 * An installed app reads and writes the **values** of the custom fields it
 * owns, scoped so it can only touch its own fields (`appFieldKey` — no app
 * prefix, resolved within the caller's installation). Connection-scoped fields
 * resolve against the agent-bound connection.
 *
 * All implementations are injected by the Auxx platform at runtime via the
 * `AUXX_SERVER_SDK` global (same mechanism as `@auxx/sdk/server` settings /
 * connections). The generated per-app `auxx-env.d.ts` narrows these permissive
 * signatures to the app's own `appFieldKey` union and per-field value types.
 */

import type { EntityRefKind } from '../root/tools/types.js'

/** Permissive write value — the route routes it to the field's typed column. */
export type FieldValueInput = string | number | boolean | Date | Record<string, unknown> | null

/** Permissive read value — narrowed per-field by the generated app types. */
export type FieldValueOut = string | number | boolean | Record<string, unknown> | null

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
export async function setFieldValues(
  recordId: string,
  values: Record<string, FieldValueInput>
): Promise<void>
export async function setFieldValues(
  entries: Array<{ recordId: string; values: Record<string, FieldValueInput> }>
): Promise<void>
export async function setFieldValues(
  recordIdOrEntries: string | Array<{ recordId: string; values: Record<string, FieldValueInput> }>,
  values?: Record<string, FieldValueInput>
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
export async function getFieldValue(
  recordId: string,
  fieldKey: string
): Promise<FieldValueOut | null> {
  return sdkOrThrow().getFieldValue(recordId, fieldKey)
}

/**
 * Read owned field values for a record as a `fieldKey → value` map. Omit
 * `fieldKeys` to read every field this installation owns on the record.
 */
export async function getFieldValues(
  recordId: string,
  fieldKeys?: string[]
): Promise<Record<string, FieldValueOut | null>> {
  return sdkOrThrow().getFieldValues(recordId, fieldKeys)
}

/**
 * Reverse lookup: which record holds this value on an owned field? Resolves
 * within the agent-bound connection for connection-scoped fields.
 */
export async function findRecordByFieldValue(input: {
  targetEntity: EntityRefKind
  fieldKey: string
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

/** Resolve a contact by its primary email. */
export async function findContactByEmail(input: { email: string }): Promise<EntityRef | null> {
  return sdkOrThrow().findContactByEmail(input)
}

/** Resolve a contact by its primary phone (normalized to E.164 server-side). */
export async function findContactByPhone(input: { phone: string }): Promise<EntityRef | null> {
  return sdkOrThrow().findContactByPhone(input)
}
