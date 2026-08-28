// packages/lib/src/field-values/read-field-scalars.ts

/**
 * Read NAMED fields for MANY records, in one query per chunk.
 *
 * The read every parent-level recompute needs and nothing in this repo had: a
 * caller with a set of instance ids and a handful of field ids wanted
 * `getFieldValues` per record, which is an `await` in a loop
 * (`plans/events/08-derived-parent-reconciler-plan.md` §1). Three call sites paid
 * that before this existed — the money totals engine, its parent-relation
 * resolver, and the three-way match, which paid it TWICE per line.
 *
 * ## Why not `FieldValueService.batchGetValues`
 *
 * It is the natural fit and does collapse to a single query when every reference
 * is direct — but it validates `ResourceFieldId`s (`entity:key`), while a caller
 * holding fields from the org cache has CustomField ids. Translating one to the
 * other means going through the field key/id/systemAttribute triad for no gain.
 *
 * ## Why not `record-rules/snapshot-fetcher.ts`
 *
 * It fetches EVERY value on a record, deliberately — a rule's conditions can name
 * anything. A recompute names three fields out of forty, so it would read an
 * order of magnitude more than it uses. It also includes soft-archived rows on
 * purpose (a `deleted` rule evaluates against last-known values), which is the
 * opposite of what a recompute wants.
 *
 * ## Enforcement
 *
 * There is none here, deliberately. Every caller is a post-write recompute
 * running as the system over ids it already scoped, and the `UnifiedCrudHandler`
 * the loop used to go through was itself constructed without a `CapabilityView`.
 * A caller that needs read enforcement wants `batchGetValues`, not this.
 */

import type { Database, Transaction } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { extractFieldValueScalar } from './field-value-scalar'

/**
 * Bounded IN-list. Same 200 as `record-rules/snapshot-fetcher.ts`, and the same
 * reason: one predictable query shape rather than an id list that grows with the
 * document.
 */
const CHUNK = 200

/** `instanceId -> fieldId -> value`. A record with no stored rows is absent. */
export type FieldScalars = Map<string, Map<string, unknown>>

/**
 * Scalar values of `fieldIds` for `instanceIds`.
 *
 * A field with no row is ABSENT from the inner map rather than present as null,
 * because the two mean different things to every caller: an absent `taxable`
 * defaults to taxable, a stored `false` does not.
 */
export async function readFieldScalars(
  db: Database | Transaction | undefined,
  organizationId: string,
  instanceIds: readonly string[],
  fieldIds: readonly string[]
): Promise<FieldScalars> {
  const out: FieldScalars = new Map()
  if (instanceIds.length === 0 || fieldIds.length === 0) return out
  const conn = db ?? database

  // Whole rows, because `extractFieldValueScalar` dispatches across every value
  // column and the caller does not know which one its field uses.
  for (const chunk of chunks(instanceIds)) {
    const rows = await conn
      .select()
      .from(schema.FieldValue)
      .where(scope(organizationId, chunk, fieldIds))
    for (const row of rows) {
      put(out, row.entityId, row.fieldId, extractFieldValueScalar(row as Record<string, unknown>))
    }
  }
  return out
}

/**
 * Related instance ids of `fieldIds` for `instanceIds` — the relationship twin of
 * {@link readFieldScalars}.
 *
 * Reading `relatedEntityId` off the row is what lets a parent-resolution ladder
 * be walked for a whole batch at once; the per-record version issued one
 * `getFieldValues` per rung.
 */
export async function readFieldRelations(
  db: Database | Transaction | undefined,
  organizationId: string,
  instanceIds: readonly string[],
  fieldIds: readonly string[]
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>()
  if (instanceIds.length === 0 || fieldIds.length === 0) return out
  const conn = db ?? database

  // Three columns, not the row: a relationship's whole payload is one id, and
  // this is called with every line of a document at once.
  for (const chunk of chunks(instanceIds)) {
    const rows = await conn
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.FieldValue)
      .where(scope(organizationId, chunk, fieldIds))
    for (const row of rows) {
      if (row.relatedEntityId) put(out, row.entityId, row.fieldId, row.relatedEntityId)
    }
  }
  return out
}

/** Id chunks, deduped. One predictable query shape per chunk. */
function chunks(instanceIds: readonly string[]): string[][] {
  const ids = [...new Set(instanceIds)]
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK))
  return out
}

/** Org + these records + these fields. The whole predicate, in one place. */
function scope(organizationId: string, chunk: string[], fieldIds: readonly string[]) {
  return and(
    eq(schema.FieldValue.organizationId, organizationId),
    inArray(schema.FieldValue.entityId, chunk),
    inArray(schema.FieldValue.fieldId, [...fieldIds])
  )
}

function put<T>(out: Map<string, Map<string, T>>, entityId: string, fieldId: string, value: T) {
  let values = out.get(entityId)
  if (!values) {
    values = new Map()
    out.set(entityId, values)
  }
  values.set(fieldId, value)
}
