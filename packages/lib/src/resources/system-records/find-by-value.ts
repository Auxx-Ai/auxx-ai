// packages/lib/src/resources/system-records/find-by-value.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, inArray, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { BadRequestError } from '../../errors'
import { CHUNK, systemRecordScope } from './scope'
import { systemValueJoin } from './value-join'

/**
 * The def and the field ids a value lookup is scoped by.
 *
 * A {@link import('./fields').SystemFieldContext} satisfies it; so does a module
 * that already holds its own field map (the chart of accounts).
 */
export interface SystemValueContext<A extends string> {
  defId: string
  fields: Record<A, { id: string } | null>
}

/** One equality criterion over a stored value: exactly one of `text` / `related` / `option` / `number`. */
export interface SystemValueCriterion<A extends string> {
  attribute: A
  text?: readonly string[]
  related?: readonly string[]
  option?: readonly string[]
  number?: readonly number[]
  /**
   * Compare `text` as `lower(col) = lower(val)`, and key the answer on the
   * LOWER-cased value. Never `ilike`: a stored SKU or email local part is not a
   * pattern, and `_` / `%` are ordinary characters in both.
   */
  caseInsensitive?: boolean
}

type Plan = {
  table: ReturnType<typeof alias<typeof schema.FieldValue, string>>
  fieldId: string
  predicate: SQL
  key: SQL<string | null>
}

/**
 * The inverse lookup: instances of `ctx.defId` that STORE one of these values,
 * grouped by the value they matched.
 *
 * Live-only unless `includeArchived`, scoped by {@link systemRecordScope}, and
 * chunked at {@link CHUNK} per criterion. Several criteria are ANDed by
 * intersecting one {@link systemValueJoin} each, and the answer is keyed on the
 * FIRST criterion's value — with an AND every criterion matched, so "which one
 * hit" has no answer, the tuple did.
 *
 * Ids come back in `(createdAt, id)` order within a key, so a caller taking the
 * first of an unexpected duplicate takes the same one every call.
 *
 * Equality only. A search (`ilike`) or a range stays on `systemValueJoin`.
 */
export async function findSystemRecordIdsByValue<A extends string>(
  db: Database | Transaction,
  organizationId: string,
  ctx: SystemValueContext<A>,
  where: SystemValueCriterion<NoInfer<A>> | readonly SystemValueCriterion<NoInfer<A>>[],
  options: { includeArchived?: boolean } = {}
): Promise<Map<string, string[]>> {
  const criteria = Array.isArray(where)
    ? (where as readonly SystemValueCriterion<A>[])
    : [where as SystemValueCriterion<A>]
  const out = new Map<string, Set<string>>()
  if (criteria.length === 0) return new Map()

  // Chunk every criterion: a missing field or an empty value list can match no
  // row, so the whole conjunction is empty rather than silently widened.
  const chunkedPlans: Plan[][] = []
  for (const [index, criterion] of criteria.entries()) {
    const field = ctx.fields[criterion.attribute]
    if (!field) return new Map()
    const plans = planCriterion(field.id, criterion, index)
    if (plans.length === 0) return new Map()
    chunkedPlans.push(plans)
  }

  for (const combination of combinations(chunkedPlans)) {
    let query = db
      .select({ entityId: schema.EntityInstance.id, key: combination[0]!.key })
      .from(schema.EntityInstance)
      .$dynamic()
    for (const plan of combination) {
      query = query.innerJoin(
        plan.table,
        and(systemValueJoin(plan.table, plan.fieldId), plan.predicate)
      )
    }
    const rows = await query
      .where(systemRecordScope(organizationId, ctx.defId, options))
      .orderBy(asc(schema.EntityInstance.createdAt), asc(schema.EntityInstance.id))

    for (const row of rows) {
      if (row.key == null) continue
      const key = String(row.key)
      const bucket = out.get(key)
      if (bucket) bucket.add(row.entityId)
      else out.set(key, new Set([row.entityId]))
    }
  }

  return new Map([...out].map(([key, ids]) => [key, [...ids]]))
}

/** One `Plan` per chunk of the criterion's value list. */
function planCriterion<A extends string>(
  fieldId: string,
  criterion: SystemValueCriterion<A>,
  index: number
): Plan[] {
  const table = alias(schema.FieldValue, `fbv_${index}`)
  const stated = (['text', 'related', 'option', 'number'] as const).filter(
    (name) => criterion[name] !== undefined
  )
  if (stated.length !== 1)
    throw new BadRequestError(
      `findSystemRecordIdsByValue: ${criterion.attribute} must state exactly one of text, related, option or number`
    )

  if (criterion.number) {
    const values = [...new Set(criterion.number)]
    return chunk(values).map((part) => ({
      table,
      fieldId,
      predicate: inArray(table.valueNumber, part) as SQL,
      key: table.valueNumber as unknown as SQL<string | null>,
    }))
  }

  const column =
    criterion.text !== undefined
      ? table.valueText
      : criterion.related !== undefined
        ? table.relatedEntityId
        : table.optionId
  const raw = [...new Set(criterion.text ?? criterion.related ?? criterion.option ?? [])]
  const lower = criterion.text !== undefined && criterion.caseInsensitive === true
  const values = lower ? [...new Set(raw.map((value) => value.toLowerCase()))] : raw
  const expression = lower ? sql<string | null>`lower(${column})` : (column as unknown as SQL)
  return chunk(values).map((part) => ({
    table,
    fieldId,
    predicate: inArray(expression, part) as SQL,
    key: expression as SQL<string | null>,
  }))
}

function chunk<T>(values: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK))
  return out
}

/** The cartesian product of the per-criterion chunk lists: one query per combination. */
function combinations(plans: Plan[][]): Plan[][] {
  return plans.reduce<Plan[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((plan) => [...prefix, plan])),
    [[]]
  )
}
