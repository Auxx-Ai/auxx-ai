// packages/lib/src/accounting/documents/document-ledger-state.ts
//
// What a posting document knows about its own entry that `GlPostingSource` cannot
// say, on `EntityInstance.metadata.ledger`: `generation`, because a repost after
// Save cannot reuse the reversed original's document number.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'

/** The `EntityInstance.metadata` key. */
export const DOCUMENT_LEDGER_KEY = 'ledger'

export interface DocumentLedgerState {
  /** 1 for the first post. Incremented by each repost that reversed a live entry. */
  generation: number
}

const EMPTY: DocumentLedgerState = { generation: 1 }

/** The document's ledger state, defaulted - one that has never posted reads `generation: 1`. */
export async function readDocumentLedgerState(
  db: Database,
  organizationId: string,
  entityInstanceId: string
): Promise<DocumentLedgerState> {
  const [row] = await db
    .select({ metadata: schema.EntityInstance.metadata })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, entityInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
    .limit(1)

  const metadata = row?.metadata
  if (!metadata || typeof metadata !== 'object') return EMPTY
  const state = (metadata as Record<string, unknown>)[DOCUMENT_LEDGER_KEY]
  if (!state || typeof state !== 'object') return EMPTY
  const { generation } = state as Record<string, unknown>
  return {
    generation:
      typeof generation === 'number' && Number.isInteger(generation) && generation >= 1
        ? generation
        : 1,
  }
}

/** Record the generation the document's entry now stands at. */
export async function writeDocumentLedgerGeneration(
  db: Database,
  organizationId: string,
  entityInstanceId: string,
  generation: number
): Promise<void> {
  const metadata = schema.EntityInstance.metadata
  await db
    .update(schema.EntityInstance)
    .set({
      metadata: sql`jsonb_set(
        jsonb_set(coalesce(${metadata}, '{}'::jsonb), ${`{${DOCUMENT_LEDGER_KEY}}`}, coalesce(${metadata} -> ${DOCUMENT_LEDGER_KEY}, '{}'::jsonb), true),
        ${`{${DOCUMENT_LEDGER_KEY},generation}`},
        ${JSON.stringify(generation)}::jsonb,
        true
      )`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.EntityInstance.id, entityInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
}

/** One row of a document's ledger postings. `status` is `posted | reversed`. */
export interface DocumentPosting {
  glPostingId: string
  docNumber: string
  status: string
  postingType: string
}
