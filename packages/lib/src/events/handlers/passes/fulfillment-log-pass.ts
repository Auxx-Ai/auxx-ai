// packages/lib/src/events/handlers/passes/fulfillment-log-pass.ts
//
// Pass 6 of `events/handlers/finalize-integrity-passes.ts`: decide whether a
// connector sync brought in fulfillment records, and if so hand off to the
// automatic posting run.
//
// `plans/money/tasks/55-shipment-lines.md` §1, §6.
//
// WHAT THIS USED TO BE, AND WHY IT SHRANK
//
// Before entity migration 153, `order_fulfillments` was a JSON cell and
// nothing native said an imported order had shipped - Shopify's per-line
// fulfillment facts arrived on `line_item`, and this pass reconstructed a
// shipment log from them (`money/fulfillment-posting/derive-log.ts`, now
// deleted). That reconstruction carried two defects that only existed because
// there was something to reconstruct:
//
//  - a line that shipped in more than one dispatch held out the WHOLE order,
//    silently, so a made-to-order merchant who ships as units come off the
//    line got no revenue posted for most of their orders (55 §1.2-1.3), and
//  - two dispatches landing on the same calendar day merged into one entry,
//    losing the distinction 53's per-package tracking needs (55 §1.4).
//
// `fulfillment` and `fulfillment_line` are now real entities and the Shopify
// connector writes them directly, one row per dispatch and one row per line
// within it (auxxai-apps#82). The records ARE the log. There is nothing left
// for this pass to derive, so it no longer reads a single `FieldValue`,
// resolves a field context, or writes anything at all.
//
// WHAT IS LEFT TO DO
//
// One thing: `finalize-integrity-passes.ts`'s pass 7 used to read the SIZE of
// this pass's return value to decide whether to enqueue the automatic
// fulfillment posting run (`money/fulfillment-posting/auto.ts`) - gated so an
// idle re-sync (nothing new to post) enqueues nothing. That signal still has
// to come from somewhere, and the cheapest correct source is the sync
// manifest itself: a `fulfillment` record can only exist because the
// connector's relationship mapping wrote it, and every field it writes -
// including on create - calls `recordTouched` (`field-values/create-values.ts`,
// `field-value-mutations.ts`), so a newly arrived fulfillment appears in
// `manifest.touched`.
//
// 🛑 But `touched` is NOT the guarantee to lean on alone, and this scans
// `createdRecordIds` as well. The two tiers make different promises:
// `sync-manifest-types.ts` documents `createdRecordIds` as "UNCONDITIONAL
// membership: every created record, not only lifecycle-ruled defs", while
// `runIntegrityPasses`'s own early-return comment hedges on the other one - "a
// create NORMALLY also lands in `touched` (creates record their written keys),
// so the third arm is a guard against a writer that only reports the lifecycle
// array, not a live path." Pass 5 reads `createdRecordIds` for exactly that
// reason.
//
// A fulfillment arriving from a connector is a CREATE, so the unconditional
// array is the right tier for it. Leaning on `touched` alone would make the
// trigger depend on `recordTouched` firing, which is an implementation detail
// of the write path rather than a contract - and the failure is SILENT: no
// enqueue, no error, no posting run, and nothing on any screen saying so.
// Scanning both costs one more loop over ids already in memory and no database
// read.
//
// That answers "did anything arrive" with ZERO database reads - manifest
// membership plus the cached def resolver `finalize-integrity-passes.ts`
// already built. Pass 6 and the old pass 7 collapse into one pass as a
// result: there is no longer a derivation step whose success pass 7 must not
// be blamed for (the reason the two were split originally), so one function
// checks arrival and enqueues.
//
// Keep top-level imports to types and the logger, and lazy-import the queue
// module - the same rule `finalize-integrity-passes.ts` states in its own
// header, for the same reason (the events to money/cache boundaries break
// `vi.mock` otherwise).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'
import type { FulfillmentLineToRelieve } from '../../../relief'

const logger = createScopedLogger('finalize-integrity')

/**
 * The slice of the manifest resolver this pass needs.
 *
 * Structurally narrower than `finalize-integrity-passes.ts`'s own
 * `DefFieldResolver` so the two modules do not import each other's types in a
 * cycle; the real resolver is assignable to it.
 */
export type DefEntityTypeResolver = (
  rawDefId: string
) => Promise<{ entityType: string | null } | null>

/**
 * Whether this sync's manifest shows at least one `fulfillment` record
 * created or touched.
 *
 * Membership only - no field values are read. WHICH keys changed does not
 * matter, because the question is only "did the connector write a fulfillment
 * this run", never "did a specific attribute of it change".
 *
 * 🛑 BOTH tiers are scanned, and `createdRecordIds` is the load-bearing one.
 * See this file's header: a connector-written fulfillment is a CREATE, and
 * `createdRecordIds` is the tier documented as unconditional for every created
 * record, where `touched` is only documented as what a create NORMALLY also
 * lands in. A trigger that missed would be silent - no enqueue, no error.
 */
export async function fulfillmentsArrivedThisSync(
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver
): Promise<boolean> {
  const seenDefs = new Map<string, boolean>()
  const isFulfillment = async (rid: RecordId): Promise<boolean> => {
    const { entityDefinitionId: rawDefId } = parseRecordId(rid)
    const cached = seenDefs.get(rawDefId)
    if (cached !== undefined) return cached
    const def = await resolveDef(rawDefId)
    const answer = def?.entityType === 'fulfillment'
    seenDefs.set(rawDefId, answer)
    return answer
  }

  for (const rid of manifest.createdRecordIds ?? []) {
    if (await isFulfillment(rid)) return true
  }
  for (const rid of Object.keys(manifest.touched)) {
    if (await isFulfillment(rid as RecordId)) return true
  }
  return false
}

/**
 * Every entityInstanceId of `wantedType` this sync's manifest shows created or
 * touched - the id-COLLECTING sibling of {@link fulfillmentsArrivedThisSync}.
 *
 * Deliberately a separate function rather than a refactor of that one: its
 * membership contract is pinned by `__tests__/fulfillment-posting-trigger.test.ts`
 * (including a "resolves each def at most once" case), and this brief's own
 * §2.6 rule - "if a test needs editing, the refactor changed behaviour and is
 * wrong" - applies just as well to a hand-tested pass as to the ledger writer
 * it names. A few duplicated lines cost far less than putting that pin at risk.
 */
async function collectArrivedInstanceIds(
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver,
  wantedType: string
): Promise<string[]> {
  const seenDefs = new Map<string, boolean>()
  const isWanted = async (rid: RecordId): Promise<boolean> => {
    const { entityDefinitionId: rawDefId } = parseRecordId(rid)
    const cached = seenDefs.get(rawDefId)
    if (cached !== undefined) return cached
    const def = await resolveDef(rawDefId)
    const answer = def?.entityType === wantedType
    seenDefs.set(rawDefId, answer)
    return answer
  }

  const ids = new Set<string>()
  for (const rid of manifest.createdRecordIds ?? []) {
    if (await isWanted(rid)) ids.add(parseRecordId(rid).entityInstanceId)
  }
  for (const rid of Object.keys(manifest.touched)) {
    if (await isWanted(rid as RecordId)) ids.add(parseRecordId(rid as RecordId).entityInstanceId)
  }
  return [...ids]
}

/**
 * Inventory relief (`plans/money/tasks/50-batch-inventory-relief.md` §1.4):
 * the sync door. Hangs off the SAME arrival signal as the posting trigger,
 * but is gated on NEITHER `isAccountingEnabled` NOR
 * `accounting.fulfillmentPosting` - on-hand is an inventory fact, not an
 * accounting one, so an accounting-off org still gets a correct shelf.
 *
 * A `fulfillment` OR a `fulfillment_line` arriving both count: a connector
 * update that only touches a line (a tracking correction lands on the
 * fulfillment, but a Shopify edit could in principle touch just a line) must
 * not be missed just because the PARENT record was not itself in this sync's
 * manifest.
 *
 * From either kind of id this resolves to the owning ORDER
 * (`fulfillment_line_fulfillment` then `fulfillment_order`, via the same
 * `resolveParentsByRelation` pass 4's order-demand pass uses) and re-reads
 * EVERY fulfillment of that order through `readFulfillmentsForOrders` - the
 * one place that owns the `fulfillment`/`fulfillment_line` join shape
 * (`money/fulfillments/reads.ts`'s own header). This is deliberately broader
 * than "only the lines that arrived": relief's own delta arithmetic
 * (`quantity - quantity_relieved`) is a no-op on anything already relieved,
 * so re-scanning a whole order costs a bit more work in exchange for never
 * having to reason about whether a narrower id set missed a sibling line.
 *
 * A cancelled fulfillment's lines are excluded (`isLiveFulfillment`) - this
 * brief's own §9 item 3 leaves that choice open and calls it "mechanical and
 * probably right"; this is where that call is made, not inside
 * `relieveFulfillmentLines` itself, which only ever sees lines a caller has
 * already decided are live.
 */
async function runFulfillmentReliefForSync(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver
): Promise<void> {
  const [fulfillmentIds, fulfillmentLineIds] = await Promise.all([
    collectArrivedInstanceIds(manifest, resolveDef, 'fulfillment'),
    collectArrivedInstanceIds(manifest, resolveDef, 'fulfillment_line'),
  ])
  if (fulfillmentIds.length === 0 && fulfillmentLineIds.length === 0) return

  const { resolveParentsByRelation } = await import('../../../reconcilers/parent-reconciler')
  const fulfillmentIdsFromLines = await resolveParentsByRelation(
    organizationId,
    'fulfillment_line_fulfillment',
    fulfillmentLineIds
  )
  const allFulfillmentIds = [...new Set([...fulfillmentIds, ...fulfillmentIdsFromLines])]
  if (allFulfillmentIds.length === 0) return

  const orderIds = [
    ...new Set(
      await resolveParentsByRelation(organizationId, 'fulfillment_order', allFulfillmentIds)
    ),
  ]
  if (orderIds.length === 0) return

  const { readFulfillmentsForOrders, isLiveFulfillment } = await import(
    '../../../money/fulfillments'
  )
  const byOrder = await readFulfillmentsForOrders(db, { organizationId, orderIds })

  const lines: FulfillmentLineToRelieve[] = []
  for (const fulfillments of byOrder.values()) {
    for (const fulfillment of fulfillments) {
      if (!isLiveFulfillment(fulfillment)) continue
      const occurredAt = new Date(fulfillment.shippedAt)
      for (const line of fulfillment.lines) {
        lines.push({
          fulfillmentLineId: line.id,
          lineItemId: line.lineItemId,
          quantity: line.quantity,
          quantityRelieved: line.quantityRelieved,
          occurredAt,
        })
      }
    }
  }
  if (lines.length === 0) return

  const { relieveFulfillmentLines } = await import('../../../relief')
  const { getOrgCache } = await import('../../../cache')
  const userId = await getOrgCache().get(organizationId, 'systemUser')

  const result = await relieveFulfillmentLines(db, { organizationId, userId, lines })
  if (result.isErr()) {
    logger.error('integrity fulfillment relief pass: relief failed', {
      organizationId,
      error: result.error.message,
    })
    return
  }

  logger.info('integrity fulfillment relief pass done', {
    organizationId,
    orders: orderIds.length,
    linesConsidered: lines.length,
    written: result.value.movementIds.length,
    skippedNoPart: result.value.skippedNoPart,
    skippedZeroDelta: result.value.skippedZeroDelta,
    skippedNoCost: result.value.skippedNoCost,
  })
}

/**
 * Pass 6: enqueue the automatic fulfillment posting run, and relieve
 * inventory, when - and only when - this sync's manifest shows a fulfillment
 * (or fulfillment line) record arriving.
 *
 * **Never throws**, matching every other pass in this module. The posting
 * trigger and the relief run are independent business decisions on
 * independent lanes, so each gets its OWN try/catch: a failure enqueuing the
 * posting run must not stop inventory from being relieved, and a relief
 * failure must not stop revenue from being posted.
 */
export async function fulfillmentPostingTriggerPass(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefEntityTypeResolver
): Promise<void> {
  try {
    const arrived = await fulfillmentsArrivedThisSync(manifest, resolveDef)
    if (arrived) {
      const { autoPostFulfillmentsAfterSync } = await import(
        '../../../money/fulfillment-posting/auto'
      )
      await autoPostFulfillmentsAfterSync(db, organizationId)

      logger.info('integrity fulfillment posting trigger pass: fulfillments arrived, enqueued', {
        organizationId,
      })
    }
  } catch (error) {
    logger.error('integrity fulfillment posting trigger pass failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    await runFulfillmentReliefForSync(db, organizationId, manifest, resolveDef)
  } catch (error) {
    logger.error('integrity fulfillment relief pass failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
