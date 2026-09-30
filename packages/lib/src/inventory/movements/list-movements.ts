// packages/lib/src/inventory/movements/list-movements.ts

import { type Database, schema } from '@auxx/database'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { guard } from './guard'

/** One row of a part's movement list, newest `effectiveAt` first. */
export interface PartMovementListItem {
  id: string
  type: string
  /** Signed. */
  quantity: number
  reason: string | null
  reference: string | null
  /** Minor units per unit; null while the cost is pending. */
  unitCostMinor: number | null
  costBasis: string | null
  occurredAt: Date | null
  createdAt: Date
  /** `COALESCE(occurredAt, createdAt)`. */
  effectiveAt: Date
  buildId: string | null
  /** The build's `B-0001` number, for a build leg. */
  buildNumber: string | null
  reversesMovementId: string | null
  /** The movement that reverses this one, if any (at most one, by the unique index). */
  reversedById: string | null
}

export interface ListPartMovementsInput {
  partId: string
  /** The `nextCursor` of the previous page. */
  cursor?: string | null
  limit: number
}

export interface ListPartMovementsResult {
  items: PartMovementListItem[]
  nextCursor: string | null
  total: number
}

/** Keyset cursor over `(effectiveAt, id)`: `<epoch ms>:<id>`. */
function encodeCursor(item: PartMovementListItem): string {
  return `${item.effectiveAt.getTime()}:${item.id}`
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const split = cursor.indexOf(':')
  const ms = Number(cursor.slice(0, split))
  const id = cursor.slice(split + 1)
  if (split < 1 || !Number.isFinite(ms) || !id) throw new BadRequestError('Invalid cursor')
  return { at: new Date(ms), id }
}

/** A part's movements, paged by keyset, with the reversal link in both directions. */
export async function listPartMovements(
  db: Database,
  organizationId: string,
  input: ListPartMovementsInput
): Promise<Result<ListPartMovementsResult, Error>> {
  return guard(
    async () => {
      const m = schema.StockMovement
      const reversal = alias(schema.StockMovement, 'reversal')
      const scope = and(eq(m.organizationId, organizationId), eq(m.partId, input.partId))
      const after = input.cursor ? decodeCursor(input.cursor) : null

      const [rows, [totals]] = await Promise.all([
        db
          .select({
            id: m.id,
            type: m.type,
            quantity: m.quantity,
            reason: m.reason,
            reference: m.reference,
            unitCostMinor: m.unitCostMinor,
            costBasis: m.costBasis,
            occurredAt: m.occurredAt,
            createdAt: m.createdAt,
            effectiveAt: m.effectiveAt,
            buildId: m.buildId,
            buildNumber: schema.Build.number,
            reversesMovementId: m.reversesMovementId,
            reversedById: reversal.id,
          })
          .from(m)
          .leftJoin(
            reversal,
            and(
              eq(reversal.organizationId, m.organizationId),
              eq(reversal.reversesMovementId, m.id)
            )
          )
          .leftJoin(
            schema.Build,
            and(eq(schema.Build.organizationId, m.organizationId), eq(schema.Build.id, m.buildId))
          )
          .where(
            and(
              scope,
              after
                ? sql`(${m.effectiveAt}, ${m.id}) < (${after.at.toISOString()}::timestamptz, ${after.id})`
                : undefined
            )
          )
          .orderBy(desc(m.effectiveAt), desc(m.id))
          .limit(input.limit + 1),
        db.select({ total: count() }).from(m).where(scope),
      ])

      const items = rows.slice(0, input.limit)
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: rows.length > input.limit && last ? encodeCursor(last) : null,
        total: totals?.total ?? 0,
      }
    },
    'listPartMovements failed',
    { organizationId, partId: input.partId }
  )
}
