// packages/lib/src/resource-access/sweep-instances.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * How many ids go into one `IN (…)` list. The predicate inlines every id, so an
 * unbounded batch (a channel disconnect drops every thread it ever synced) would
 * build a statement with tens of thousands of parameters. Chunking is this
 * function's job, not the caller's.
 */
const SWEEP_CHUNK = 500

/** Input for {@link sweepResourceAccessForInstances}. */
export interface SweepResourceAccessForInstancesParams {
  organizationId: string
  /**
   * Ids of the things being hard-deleted — `EntityInstance.id`, `Thread.id`,
   * `Dashboard.id`, whatever the domain's own primary key is. Duplicates and
   * ids that hold no grant are tolerated.
   */
  instanceIds: readonly string[]
}

/**
 * Delete every instance-level `ResourceAccess` row pointing AT a set of ids.
 *
 * `ResourceAccess.entityInstanceId` is a bare `text()` column with **no foreign
 * key**, and it cannot have one: `entityDefinitionId` carries two disjoint
 * keyspaces (an `EntityDefinition.id`, or a reserved slug such as `'thread'` /
 * `'inbox'` / `'dashboard'`), so the column it pairs with resolves against a
 * different table per row. Nothing in the database cascades these, so every
 * delete path has to sweep them explicitly — the same rule, and the same class
 * of bug, as `TimelineEvent.entityId` (see
 * `entity-instances/delete-entity-instance.ts`).
 *
 * ⚠️ **Matched on `entityInstanceId` ALONE, never on `entityDefinitionId`.** One
 * record's rows can be written under EITHER keyspace — a contact's under the
 * `'contact'` slug, a custom record's under its def cuid — and a caller holding
 * an instance id has no way to know which. `entityInstanceId` is a cuid2 and
 * globally unique, so the id on its own is the whole answer; adding a def filter
 * can only sweep half the rows. This is the shape `inbox-service.ts` already
 * uses, and the reason `delete-entity-definition.ts` sweeps by def id instead is
 * that IT is deleting the def, not an instance.
 *
 * ⚠️ **Sweep only. Never emit.** The `emitResourceAccess*` functions exist to
 * bust the composed capability blobs when a live grant changes. A row whose
 * target no longer exists grants access to nothing, so removing it changes no
 * member's effective capability and warrants no cache bust.
 *
 * Org-scoped on its own statement, so an id from another organization deletes
 * nothing rather than deleting the wrong thing.
 *
 * Takes `Database | Transaction` rather than a bare `Transaction` because the
 * sibling sweep it runs beside (`sweepEntityFieldValues`) does, and the bulk
 * mail door (`channels/deleteChannelData`) is itself typed over that union.
 *
 * @returns how many rows were removed.
 */
export async function sweepResourceAccessForInstances(
  tx: Database | Transaction,
  params: SweepResourceAccessForInstancesParams
): Promise<number> {
  const { organizationId } = params
  const instanceIds = [...new Set(params.instanceIds)].filter((id) => id.length > 0)
  if (instanceIds.length === 0) return 0

  let deleted = 0

  for (let offset = 0; offset < instanceIds.length; offset += SWEEP_CHUNK) {
    const chunk = instanceIds.slice(offset, offset + SWEEP_CHUNK)

    const rows = await tx
      .delete(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          inArray(schema.ResourceAccess.entityInstanceId, chunk)
        )
      )
      .returning({ id: schema.ResourceAccess.id })

    deleted += rows.length
  }

  return deleted
}
