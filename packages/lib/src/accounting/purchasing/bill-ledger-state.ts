// packages/lib/src/accounting/purchasing/bill-ledger-state.ts
//
// What a vendor bill knows about its own entry that `GlPostingSource` cannot
// say, on `EntityInstance.metadata.ledger` beside `editOpen`:
//
//   draftGlPostingId  the draft in the outbox. `post-entry.ts` writes NO subject
//                     row for a draft - the subject row IS the claim and a draft
//                     holds none - so without this pointer a drafted entry is
//                     invisible to the bill that produced it.
//   generation        how many times the entry has been posted. A repost after
//                     Save keys on it, because the reversed original's DOCUMENT
//                     NUMBER is still in the books even though its claim is gone.
//
// Each key is merged on its own path, so the poster stamping a draft and the
// Save stamping a generation in the same transaction cannot clobber each other.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'

/** The `EntityInstance.metadata` key. */
export const BILL_LEDGER_KEY = 'ledger'

export interface BillLedgerState {
  /** The draft this bill waits on, or `null` when it waits on none. */
  draftGlPostingId: string | null
  /** 1 for the first post. Incremented by each repost that reversed a live entry. */
  generation: number
}

const EMPTY: BillLedgerState = { draftGlPostingId: null, generation: 1 }

/** The bill's ledger state, defaulted - a bill that has never posted reads `generation: 1`. */
export async function readBillLedgerState(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<BillLedgerState> {
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
  if (!metadata || typeof metadata !== 'object') return EMPTY
  const state = (metadata as Record<string, unknown>)[BILL_LEDGER_KEY]
  if (!state || typeof state !== 'object') return EMPTY
  const { draftGlPostingId, generation } = state as Record<string, unknown>
  return {
    draftGlPostingId: typeof draftGlPostingId === 'string' ? draftGlPostingId : null,
    generation:
      typeof generation === 'number' && Number.isInteger(generation) && generation >= 1
        ? generation
        : 1,
  }
}

/** Point the bill at the draft it is waiting on, or clear the pointer with `null`. */
export async function writeBillDraftPosting(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string,
  glPostingId: string | null
): Promise<void> {
  await mergeLedgerKey(db, organizationId, vendorBillInstanceId, 'draftGlPostingId', glPostingId)
}

/** Record the generation the bill's entry now stands at. */
export async function writeBillLedgerGeneration(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string,
  generation: number
): Promise<void> {
  await mergeLedgerKey(db, organizationId, vendorBillInstanceId, 'generation', generation)
}

/** One key under `metadata.ledger`, creating the object when it is the first. */
async function mergeLedgerKey(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string,
  key: 'draftGlPostingId' | 'generation',
  value: string | number | null
): Promise<void> {
  const metadata = schema.EntityInstance.metadata
  await db
    .update(schema.EntityInstance)
    .set({
      metadata: sql`jsonb_set(
        jsonb_set(coalesce(${metadata}, '{}'::jsonb), ${`{${BILL_LEDGER_KEY}}`}, coalesce(${metadata} -> ${BILL_LEDGER_KEY}, '{}'::jsonb), true),
        ${`{${BILL_LEDGER_KEY},${key}}`},
        ${JSON.stringify(value)}::jsonb,
        true
      )`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.EntityInstance.id, vendorBillInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
}
