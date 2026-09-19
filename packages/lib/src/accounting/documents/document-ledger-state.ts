// packages/lib/src/accounting/documents/document-ledger-state.ts
//
// What a posting document knows about its own entry that `GlPostingSource` cannot
// say, on `EntityInstance.metadata.ledger`: `draftGlPostingId`, because a draft
// writes no subject row and would otherwise be invisible to the record that made
// it, and `generation`, because a repost after Save cannot reuse the reversed
// original's document number.
//
// Each key is merged on its own path, so the poster stamping a draft and a Save
// stamping a generation in the same transaction cannot clobber each other.

import { type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'

/** The `EntityInstance.metadata` key. */
export const DOCUMENT_LEDGER_KEY = 'ledger'

export interface DocumentLedgerState {
  /** The draft this document waits on, or `null` when it waits on none. */
  draftGlPostingId: string | null
  /** 1 for the first post. Incremented by each repost that reversed a live entry. */
  generation: number
}

const EMPTY: DocumentLedgerState = { draftGlPostingId: null, generation: 1 }

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
  const { draftGlPostingId, generation } = state as Record<string, unknown>
  return {
    draftGlPostingId: typeof draftGlPostingId === 'string' ? draftGlPostingId : null,
    generation:
      typeof generation === 'number' && Number.isInteger(generation) && generation >= 1
        ? generation
        : 1,
  }
}

/** Point the document at the draft it is waiting on, or clear the pointer with `null`. */
export async function writeDocumentDraftPosting(
  db: Database,
  organizationId: string,
  entityInstanceId: string,
  glPostingId: string | null
): Promise<void> {
  await mergeLedgerKey(db, organizationId, entityInstanceId, 'draftGlPostingId', glPostingId)
}

/** Record the generation the document's entry now stands at. */
export async function writeDocumentLedgerGeneration(
  db: Database,
  organizationId: string,
  entityInstanceId: string,
  generation: number
): Promise<void> {
  await mergeLedgerKey(db, organizationId, entityInstanceId, 'generation', generation)
}

/** One row of a document's ledger postings. `status` is `draft | posted | reversed`. */
export interface DocumentPosting {
  glPostingId: string
  docNumber: string
  status: string
  postingType: string
}

/**
 * Add the document's DRAFT entry to the postings `GlPostingSource` can see.
 *
 * 🛑 A draft holds no subject claim, so a read built on `GlPostingSource` misses
 * it entirely — and Save would then draft a second one. The pointer is cleared
 * when the draft has since been promoted and the subject row says so.
 */
export async function foldDraftPosting(
  db: Database,
  organizationId: string,
  entityInstanceId: string,
  claimed: DocumentPosting[]
): Promise<DocumentPosting[]> {
  const { draftGlPostingId } = await readDocumentLedgerState(db, organizationId, entityInstanceId)
  if (!draftGlPostingId) return claimed
  if (claimed.some((posting) => posting.glPostingId === draftGlPostingId)) {
    await writeDocumentDraftPosting(db, organizationId, entityInstanceId, null)
    return claimed
  }

  const [row] = await db
    .select({
      id: schema.GlPosting.id,
      docNumber: schema.GlPosting.docNumber,
      status: schema.GlPosting.status,
      postingType: schema.GlPosting.postingType,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.id, draftGlPostingId),
        eq(schema.GlPosting.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) return claimed
  return [
    {
      glPostingId: row.id,
      // A draft holds no claim, so it carries no document number yet.
      docNumber: row.docNumber ?? '',
      status: row.status,
      postingType: row.postingType,
    },
    ...claimed,
  ]
}

/** One key under `metadata.ledger`, creating the object when it is the first. */
async function mergeLedgerKey(
  db: Database,
  organizationId: string,
  entityInstanceId: string,
  key: 'draftGlPostingId' | 'generation',
  value: string | number | null
): Promise<void> {
  const metadata = schema.EntityInstance.metadata
  await db
    .update(schema.EntityInstance)
    .set({
      metadata: sql`jsonb_set(
        jsonb_set(coalesce(${metadata}, '{}'::jsonb), ${`{${DOCUMENT_LEDGER_KEY}}`}, coalesce(${metadata} -> ${DOCUMENT_LEDGER_KEY}, '{}'::jsonb), true),
        ${`{${DOCUMENT_LEDGER_KEY},${key}}`},
        ${JSON.stringify(value)}::jsonb,
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
