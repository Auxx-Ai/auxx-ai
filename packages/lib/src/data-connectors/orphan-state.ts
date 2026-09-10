// packages/lib/src/data-connectors/orphan-state.ts
// Crawl-reconciliation bookkeeping (v12.1 Phases 3 + 4): the two archive-cap keys on
// `DataConnector.state`, and the "did this connector mint these instances" read that
// lets a def-keyed shared instance resolve to `archive` from every binding.
//
// `DataConnector.state` is a SHARED jsonb: the sync cursor lives in it (the slice
// orchestrator reads `connector.state` as `cursorBefore`) and so does the backfill
// latch. Every write here therefore merges or removes exactly ONE key with jsonb
// operators and never replaces the column. `set({ state: {...} })` would wipe the
// cursor mid-backfill.

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { ArchiveCapOverride, ArchiveCapTripped } from './types'

/**
 * Stamp that the archive cap refused a reconcile pass (Phase 3a). The connector detail
 * page reads this to show "needs attention" with the reason, and the confirm action
 * refuses unless it is set. Overwrites an earlier stamp: the newest refusal is the one a
 * human should read.
 */
export async function setArchiveCapTripped(
  db: Database,
  dataConnectorId: string,
  tripped: ArchiveCapTripped
): Promise<void> {
  const T = schema.DataConnector
  await db
    .update(T)
    .set({
      state: sql`jsonb_set(coalesce(${T.state}, '{}'::jsonb), '{archiveCapTripped}', ${JSON.stringify(tripped)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(eq(T.id, dataConnectorId))
}

/**
 * Drop the stamp after a pass that did not trip (Phase 3a). Every clean pass calls
 * this, including one with zero orphans, so the WHERE guards on the key being present
 * and a connector that was never tripped is not rewritten on every sync.
 */
export async function clearArchiveCapTripped(db: Database, dataConnectorId: string): Promise<void> {
  const T = schema.DataConnector
  await db
    .update(T)
    .set({
      state: sql`coalesce(${T.state}, '{}'::jsonb) - 'archiveCapTripped'`,
      updatedAt: new Date(),
    })
    .where(and(eq(T.id, dataConnectorId), sql`jsonb_exists(${T.state}, 'archiveCapTripped')`))
}

/**
 * Consume the one-shot human confirmation (Phase 3b): read it and remove it in ONE
 * `UPDATE ... WHERE jsonb_exists(state, 'archiveCapOverride') RETURNING <old value>`, so
 * two finalizes racing on the same connector cannot both lift the cap. The RETURNING
 * sub-select reads the row through the statement's own snapshot, which is the
 * pre-update version; the loser's WHERE is re-evaluated against the winner's committed
 * row, finds no key, and returns nothing. `null` when there was nothing to consume.
 */
export async function takeArchiveCapOverride(
  db: Database,
  dataConnectorId: string
): Promise<ArchiveCapOverride | null> {
  const T = schema.DataConnector
  const [row] = await db
    .update(T)
    .set({
      state: sql`coalesce(${T.state}, '{}'::jsonb) - 'archiveCapOverride'`,
      updatedAt: new Date(),
    })
    .where(and(eq(T.id, dataConnectorId), sql`jsonb_exists(${T.state}, 'archiveCapOverride')`))
    .returning({
      override: sql<ArchiveCapOverride | null>`(select o.state -> 'archiveCapOverride' from ${T} o where o.id = ${T.id})`,
    })
  return row?.override ?? null
}

/**
 * Instance ids among `instanceIds` that ANY binding of this connector minted (Phase 4).
 *
 * "Minted" is a property of the record, but the sink stores it on the binding that did
 * the creating: under def-keyed reuse a second mapping binds the same instance with
 * `mintedInstance: false` on its own row, and judged alone that binding degrades to
 * `mark_deleted` and blocks the sharing guard from ever archiving the record. Reading
 * across the connector's bindings restores the record-level answer. A binding whose
 * link was cleared by a `rebind` edit keeps the fact in `mintedInstanceId`, so that
 * column counts too: the connector created the record either way.
 */
export async function listMintedInstanceIds(
  db: Database,
  dataConnectorId: string,
  instanceIds: readonly string[]
): Promise<Set<string>> {
  if (instanceIds.length === 0) return new Set()
  const I = schema.DataConnectorItem
  const ids = [...instanceIds]
  const rows = await db
    .select({
      bound: I.entityInstanceId,
      boundMinted: I.mintedInstance,
      minted: I.mintedInstanceId,
    })
    .from(I)
    .where(
      and(
        eq(I.dataConnectorId, dataConnectorId),
        or(
          and(eq(I.mintedInstance, true), inArray(I.entityInstanceId, ids)),
          inArray(I.mintedInstanceId, ids)
        )
      )
    )
  const wanted = new Set(ids)
  const minted = new Set<string>()
  for (const row of rows) {
    if (row.minted && wanted.has(row.minted)) minted.add(row.minted)
    // A row can match on `mintedInstanceId` alone; its CURRENT binding is minted only
    // when the flag says so.
    if (row.boundMinted && row.bound && wanted.has(row.bound)) minted.add(row.bound)
  }
  return minted
}
