// apps/worker/scripts/verify-signals-substrate.ts
/**
 * Signals Stage B verification (plans/signals/01-signal-store.md "Write path" / "Rollups") —
 * exercises the reworked `recordSignal()` write path (DB-level dedupe via
 * `onConflictDoNothing`, inline `EntitySignalRollup` upsert, post-commit `signal:recorded`
 * publish) and the `recordSignals()` bulk variant, against the real dev DB.
 *
 * Every signal this script writes carries a `verify:signals-substrate:` dedupeKey prefix and
 * its id is tracked for cleanup; the `EntitySignalRollup` row for the chosen contact is
 * snapshotted before any write and restored (or deleted, if it didn't exist) in the `finally`
 * block, so this script leaves the dev org's rollup state exactly as it found it.
 *
 * Run (from repo root):
 *   npx dotenv -- npx tsx apps/worker/scripts/verify-signals-substrate.ts
 * or, if ESM/tsx resolution complains:
 *   npx dotenv -- node --conditions source --import tsx/esm \
 *     apps/worker/scripts/verify-signals-substrate.ts
 */

import { database } from '@auxx/database'
import { recordSignal, recordSignals, toSignalRecordKey } from '@auxx/lib/signals'

const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — precedent)
const MARKER = 'verify:signals-substrate'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  PASS ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}`, detail ?? '')
  }
}

interface RollupSnapshot {
  lastOpenedAt: Date | null
  openCount30d: number
  lastClickedAt: Date | null
  clickCount30d: number
  lastVisitAt: Date | null
  visitCount30d: number
  lastRepliedAt: Date | null
  lastSignalAt: Date | null
  unsubscribedAt: Date | null
  bouncedAt: Date | null
  bounceType: string | null
  updatedAt: Date
}

async function getRollup(entityInstanceId: string): Promise<RollupSnapshot | null> {
  const res = await database.$client.query(
    `SELECT "lastOpenedAt", "openCount30d", "lastClickedAt", "clickCount30d", "lastVisitAt",
            "visitCount30d", "lastRepliedAt", "lastSignalAt", "unsubscribedAt", "bouncedAt",
            "bounceType", "updatedAt"
     FROM "EntitySignalRollup"
     WHERE "organizationId" = $1 AND "entityInstanceId" = $2`,
    [organizationId, entityInstanceId]
  )
  return (res.rows[0] as RollupSnapshot | undefined) ?? null
}

async function main() {
  const contactDef = await database.query.EntityDefinition.findFirst({
    columns: { id: true },
    where: (t, { and, eq }) =>
      and(eq(t.organizationId, organizationId), eq(t.entityType, 'contact')),
  })
  if (!contactDef) throw new Error('No contact EntityDefinition in org — cannot verify signals')
  const contact = await database.query.EntityInstance.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.entityDefinitionId, contactDef.id),
  })
  if (!contact) throw new Error('No contact EntityInstance in org — cannot verify signals')
  console.log(`Org ${organizationId}, contact ${contact.id}`)

  const createdSignalIds: string[] = []
  const rollupBefore = await getRollup(contact.id)
  console.log('Rollup snapshot before:', rollupBefore)

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1/2. Dedupe: same dedupeKey twice → second call is a silent no-op (ok, null).
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: dedupe idempotency')
    const dedupeKey1 = `${MARKER}:${Date.now()}:1`
    const links = [toSignalRecordKey('contact', contact.id)]

    const first = await recordSignal({
      organizationId,
      kind: 'message:sent',
      subtype: 'sequence_step',
      dedupeKey: dedupeKey1,
      contactEntityInstanceId: contact.id,
      title: `${MARKER} first write`,
      metadata: { note: 'first write' },
      links,
    })
    check('1a: first recordSignal call succeeds', first.ok && !!first.value, first)
    if (first.ok && first.value) createdSignalIds.push(first.value.id)

    const second = await recordSignal({
      organizationId,
      kind: 'message:sent',
      subtype: 'sequence_step',
      dedupeKey: dedupeKey1,
      contactEntityInstanceId: contact.id,
      title: `${MARKER} second write (should dedupe)`,
      metadata: { note: 'second write' },
      links,
    })
    check(
      '1b: second recordSignal with the SAME dedupeKey returns ok(null)',
      second.ok && second.value === null,
      second
    )

    // ══════════════════════════════════════════════════════════════════════
    // 3. EntitySignal row + EntitySignalLink rows exist for the first write.
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: row + link existence')
    const signalId = first.ok && first.value ? first.value.id : null
    if (!signalId) throw new Error('signalId missing — cannot continue')

    const signalRow = await database.$client.query(
      `SELECT id, kind, "dedupeKey" FROM "EntitySignal" WHERE id = $1`,
      [signalId]
    )
    check('3a: EntitySignal row exists', signalRow.rows.length === 1, signalRow.rows)

    const linkRows = await database.$client.query(
      `SELECT "recordKey" FROM "EntitySignalLink" WHERE "signalId" = $1`,
      [signalId]
    )
    check(
      '3b: EntitySignalLink row exists for the contact link',
      linkRows.rows.length === 1 && linkRows.rows[0]?.recordKey === links[0],
      linkRows.rows
    )

    const dedupeCount = await database.$client.query(
      `SELECT count(*)::int AS n FROM "EntitySignal" WHERE "organizationId" = $1 AND "dedupeKey" = $2`,
      [organizationId, dedupeKey1]
    )
    check(
      '3c: exactly ONE EntitySignal row exists for the dedupeKey (no double-write)',
      dedupeCount.rows[0]?.n === 1,
      dedupeCount.rows[0]
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. email:opened (isBot: false) → rollup openCount30d increments, timestamps set.
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: rollup increments on a non-bot open')
    const rollupBeforeOpen = await getRollup(contact.id)
    const openDedupeKey = `${MARKER}:${Date.now()}:2`
    const openSignal = await recordSignal({
      organizationId,
      kind: 'email:opened',
      subtype: 'default',
      dedupeKey: openDedupeKey,
      contactEntityInstanceId: contact.id,
      title: `${MARKER} email opened`,
      links,
      isBot: false,
    })
    check(
      '4a: recordSignal(email:opened) succeeds',
      openSignal.ok && !!openSignal.value,
      openSignal
    )
    if (openSignal.ok && openSignal.value) createdSignalIds.push(openSignal.value.id)

    const rollupAfterOpen = await getRollup(contact.id)
    const expectedOpenCount = (rollupBeforeOpen?.openCount30d ?? 0) + 1
    check(
      '4b: openCount30d incremented by exactly 1',
      rollupAfterOpen?.openCount30d === expectedOpenCount,
      { before: rollupBeforeOpen?.openCount30d, after: rollupAfterOpen?.openCount30d }
    )
    check(
      '4c: lastOpenedAt set (recent)',
      !!rollupAfterOpen?.lastOpenedAt &&
        Date.now() - new Date(rollupAfterOpen.lastOpenedAt).getTime() < 60_000,
      rollupAfterOpen?.lastOpenedAt
    )
    check(
      '4d: lastSignalAt set (recent)',
      !!rollupAfterOpen?.lastSignalAt &&
        Date.now() - new Date(rollupAfterOpen.lastSignalAt).getTime() < 60_000,
      rollupAfterOpen?.lastSignalAt
    )

    // ══════════════════════════════════════════════════════════════════════
    // 5. email:opened (isBot: true) → rollup untouched.
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: bot-flagged open skips the rollup entirely')
    const botDedupeKey = `${MARKER}:${Date.now()}:3`
    const botSignal = await recordSignal({
      organizationId,
      kind: 'email:opened',
      subtype: 'default',
      dedupeKey: botDedupeKey,
      contactEntityInstanceId: contact.id,
      title: `${MARKER} bot open`,
      links,
      isBot: true,
    })
    check(
      '5a: recordSignal(email:opened, isBot: true) still inserts the signal',
      botSignal.ok && !!botSignal.value,
      botSignal
    )
    if (botSignal.ok && botSignal.value) createdSignalIds.push(botSignal.value.id)

    const rollupAfterBot = await getRollup(contact.id)
    check(
      '5b: openCount30d unchanged after a bot-flagged open',
      rollupAfterBot?.openCount30d === rollupAfterOpen?.openCount30d,
      { beforeBot: rollupAfterOpen?.openCount30d, afterBot: rollupAfterBot?.openCount30d }
    )
    check(
      '5c: lastOpenedAt unchanged after a bot-flagged open',
      rollupAfterBot?.lastOpenedAt?.toString() === rollupAfterOpen?.lastOpenedAt?.toString(),
      { beforeBot: rollupAfterOpen?.lastOpenedAt, afterBot: rollupAfterBot?.lastOpenedAt }
    )

    // ══════════════════════════════════════════════════════════════════════
    // 6. recordSignals bulk — 3 inputs, one dedupeKey collides with an already-persisted
    // signal (dedupeKey1 from step 1) ⇒ only 2 new rows inserted. (Two *new* rows sharing a
    // dedupeKey within the SAME bulk statement would hit Postgres's "ON CONFLICT DO NOTHING
    // command cannot affect row a second time" restriction — colliding against a pre-existing
    // row instead is both safe and the realistic case: a batch re-processing a signal that a
    // prior partial run, or the single-write path, already recorded.)
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: recordSignals bulk dedupe')
    const rollupBeforeBulk = await getRollup(contact.id)
    const bulkDedupeKeyA = `${MARKER}:${Date.now()}:bulk-a`
    const bulkDedupeKeyB = `${MARKER}:${Date.now()}:bulk-b`
    const bulkResult = await recordSignals([
      {
        organizationId,
        kind: 'email:opened',
        subtype: 'default',
        dedupeKey: bulkDedupeKeyA,
        contactEntityInstanceId: contact.id,
        title: `${MARKER} bulk open A`,
        links,
      },
      {
        organizationId,
        kind: 'email:opened',
        subtype: 'default',
        dedupeKey: bulkDedupeKeyB,
        contactEntityInstanceId: contact.id,
        title: `${MARKER} bulk open B`,
        links,
      },
      {
        organizationId,
        kind: 'message:sent',
        subtype: 'sequence_step',
        dedupeKey: dedupeKey1, // collides with the already-persisted signal from step 1
        contactEntityInstanceId: contact.id,
        title: `${MARKER} bulk duplicate of step 1`,
        links,
      },
    ])
    check(
      '6a: recordSignals bulk call succeeds',
      bulkResult.ok,
      bulkResult.ok ? undefined : bulkResult.error
    )
    if (bulkResult.ok) {
      for (const row of bulkResult.value) createdSignalIds.push(row.id)
    }
    check(
      '6b: exactly 2 of 3 bulk signals inserted (1 deduped against the pre-existing row)',
      bulkResult.ok && bulkResult.value.length === 2,
      bulkResult.ok ? bulkResult.value : bulkResult.error
    )

    const rollupAfterBulk = await getRollup(contact.id)
    check(
      '6c: bulk rollup pass applied both inserted opens (openCount30d +2)',
      rollupAfterBulk?.openCount30d === (rollupBeforeBulk?.openCount30d ?? 0) + 2,
      { before: rollupBeforeBulk?.openCount30d, after: rollupAfterBulk?.openCount30d }
    )
  } finally {
    // ── Cleanup: delete every signal this script created (links cascade), then restore the
    // rollup row to its pre-test snapshot (or delete it if it didn't exist before). ──
    if (createdSignalIds.length > 0) {
      console.log(`Cleanup: deleting ${createdSignalIds.length} verify signals`)
      try {
        await database.$client.query('DELETE FROM "EntitySignal" WHERE id = ANY($1)', [
          [...new Set(createdSignalIds)],
        ])
      } catch (err) {
        console.log('  cleanup failed deleting signals:', err instanceof Error ? err.message : err)
      }
    }

    try {
      if (rollupBefore) {
        await database.$client.query(
          `UPDATE "EntitySignalRollup"
           SET "lastOpenedAt" = $3, "openCount30d" = $4, "lastClickedAt" = $5, "clickCount30d" = $6,
               "lastVisitAt" = $7, "visitCount30d" = $8, "lastRepliedAt" = $9, "lastSignalAt" = $10,
               "unsubscribedAt" = $11, "bouncedAt" = $12, "bounceType" = $13, "updatedAt" = $14
           WHERE "organizationId" = $1 AND "entityInstanceId" = $2`,
          [
            organizationId,
            contact.id,
            rollupBefore.lastOpenedAt,
            rollupBefore.openCount30d,
            rollupBefore.lastClickedAt,
            rollupBefore.clickCount30d,
            rollupBefore.lastVisitAt,
            rollupBefore.visitCount30d,
            rollupBefore.lastRepliedAt,
            rollupBefore.lastSignalAt,
            rollupBefore.unsubscribedAt,
            rollupBefore.bouncedAt,
            rollupBefore.bounceType,
            rollupBefore.updatedAt,
          ]
        )
        console.log('Cleanup: restored EntitySignalRollup to its pre-test snapshot')
      } else {
        await database.$client.query(
          `DELETE FROM "EntitySignalRollup" WHERE "organizationId" = $1 AND "entityInstanceId" = $2`,
          [organizationId, contact.id]
        )
        console.log('Cleanup: deleted the EntitySignalRollup row this script created')
      }
    } catch (err) {
      console.log('  cleanup failed restoring rollup:', err instanceof Error ? err.message : err)
    }
  }

  const residue = await database.$client.query(
    `SELECT count(*)::int AS n FROM "EntitySignal" WHERE "organizationId" = $1 AND "dedupeKey" LIKE $2`,
    [organizationId, `${MARKER}%`]
  )
  check(
    'cleanup: zero verify-tagged EntitySignal residue',
    residue.rows[0]?.n === 0,
    residue.rows[0]
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit())
