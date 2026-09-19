// packages/lib/src/purchasing/bill-edit-flag.ts
//
// The one latch behind 73 D4's Edit button, on its own so the three readers -
// `bill-edit.ts`, the void in `expense-bill/writes.ts` and the lock in
// `field-hooks/pre/vendor-bill-lock.ts` - share it without importing each other.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'

/** The `EntityInstance.metadata` key. One key, one jsonb merge. */
export const BILL_EDIT_OPEN_KEY = 'editOpen'

/** Who opened the edit, and when. */
export interface BillEditOpen {
  /** ISO timestamp. */
  openedAt: string
  byUserId: string
}

/**
 * The edit flag on one bill, or `null` when the bill is locked.
 *
 * Kept on `EntityInstance.metadata` rather than a `vendor_bill` field: it is a
 * latch with no reporting meaning, and a field would put it on the records grid,
 * in filters and in the timeline.
 */
export async function readBillEditOpen(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<BillEditOpen | null> {
  const [row] = await db
    .select({ metadata: schema.EntityInstance.metadata })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, vendorBillInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
    .limit(1)

  const metadata = row?.metadata
  if (!metadata || typeof metadata !== 'object') return null
  const flag = (metadata as Record<string, unknown>)[BILL_EDIT_OPEN_KEY]
  if (!flag || typeof flag !== 'object') return null
  const { openedAt, byUserId } = flag as Record<string, unknown>
  return {
    openedAt: typeof openedAt === 'string' ? openedAt : new Date(0).toISOString(),
    byUserId: typeof byUserId === 'string' ? byUserId : '',
  }
}

/** Merge the one key in, leaving the rest of the instance's jsonb alone. */
export async function writeBillEditOpen(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string,
  flag: BillEditOpen
): Promise<void> {
  await db
    .update(schema.EntityInstance)
    .set({
      metadata: sql`jsonb_set(coalesce(${schema.EntityInstance.metadata}, '{}'::jsonb), ${`{${BILL_EDIT_OPEN_KEY}}`}, ${JSON.stringify(flag)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.EntityInstance.id, vendorBillInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
}

/** Drop the one key. */
export async function clearBillEditOpen(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<void> {
  await db
    .update(schema.EntityInstance)
    .set({
      metadata: sql`coalesce(${schema.EntityInstance.metadata}, '{}'::jsonb) - ${BILL_EDIT_OPEN_KEY}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.EntityInstance.id, vendorBillInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
}
