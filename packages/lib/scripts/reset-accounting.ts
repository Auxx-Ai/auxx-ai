// packages/lib/scripts/reset-accounting.ts
//
// 🛑 DEV-ONLY. Returns one organization's ACCOUNTING state to zero so the whole
// flow - wizard, opening balances, connectors, close - can be driven again.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-accounting.ts <org> --failed-only
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/reset-accounting.ts <org> --all --wizard --confirm
//
// `<org>` is an organization id, or a name to match (`DemoOrg1`).
// Read-only without `--confirm`.
//
// ── Why this exists next to `reset-month-end-close.ts` ──────────────────────
//
// That script takes a `periodKey` and validates it as `/^\d{4}-\d{2}$/`. Only
// `month_end_inventory` keys on a month. Nine posting types key on a DOCUMENT
// number instead (`doc-number.ts`: `DEP-0003`, `INV-0012`, `JNL-0004`,
// `PMT-<hash>`), so the one script that can unwedge a claimed period refuses
// every period the document-keyed types claim. This one takes the whole
// organization, or any period key of any shape.
//
// ── The wedge this unsticks ─────────────────────────────────────────────────
//
// `postEntry` commits the claim and its lines, THEN calls the provider
// (`post-entry.ts` step 7 - a network call inside an open transaction would
// hold the claim's index tuple for the length of an HTTP round trip). When the
// provider refuses, `recordFailure` stamps the row `failed` and the row keeps
// its claim, its lines and its `requestId`.
//
// Nothing can then re-post that document:
//
//   - a fresh post converges on `already_posted`, which is a SUCCESS status;
//   - `reverseEntry` accepts only a `posted` original;
//   - re-pushing a failed row is a distinct operation and is NOT BUILT.
//
// And every report counts `['posted', 'reversed']` only (`trial-balance.ts`,
// `verify-balance.ts`, `account-lines.ts`, `aging.ts`), so the lines are on
// disk and out of the books at the same time.
//
// 🛑 That means an EXPORT fault silently subtracts from OUR ledger, which
// decision P1 says it must not: the accounting system is an exporter, not the
// system of record. An org with nothing connected posts fine; an org with
// QuickBooks connected and one account unmapped ends up with a hole. Deleting
// the row is the dev remedy. The product remedy is a re-push, or splitting
// export state off `GlPosting.status` entirely.
//
// ── Guards kept from `reset-month-end-close.ts` ─────────────────────────────
//
// 1. A row carrying `providerEntryId` REFUSES without `--force`: deleting our
//    row orphans a real journal entry on the provider, and the next close
//    computes its delta against a snapshot the provider no longer agrees with.
// 2. Delete order is descending `revision`. `GlPosting.reversesId` is ON DELETE
//    RESTRICT, so a reversal has to go before the row it reverses. A reversal
//    always claims a revision above its original and shares its period key, so
//    ordering the whole set by revision descending is sufficient.
// 3. Partial selections (`--failed-only`, `--period`) additionally refuse when
//    a row OUTSIDE the selection reverses a row INSIDE it, which the RESTRICT
//    would otherwise reject halfway through.
// 4. The QuickBooks map is cleared through `clearQuickbooksAccountMapping`, so
//    the `RecordIdentity` mirror goes with the cell. A raw FieldValue delete
//    leaves the mirror behind and manufactures work for the identity
//    reconciler.
// 5. `--wizard` fires `org.settings.changed` itself.
//    `batchUpdateOrganizationSettings` does NOT bust the `orgSettings` cache -
//    the settings ROUTER does - and this script is not the router. Skipping it
//    leaves the wizard reading `finalized` out of Redis for a day.

import { database as db, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { onCacheEvent } from '../src/cache/invalidate'
import {
  clearQuickbooksAccountMapping,
  readQuickbooksAccountMap,
} from '../src/money/quickbooks/account-map'
import { listChartAccounts } from '../src/postings'
import { batchUpdateOrganizationSettings } from '../src/settings/settings-service'

const ORG_ARG = process.argv[2] ?? ''
const args = process.argv.slice(3)

const ALL = args.includes('--all')
const FAILED_ONLY = args.includes('--failed-only')
const PERIOD = args.includes('--period') ? (args[args.indexOf('--period') + 1] ?? '') : ''
const WIZARD = args.includes('--wizard')
const KEEP_MAP = args.includes('--keep-map')
const FORCE = args.includes('--force')
const CONFIRM = args.includes('--confirm')

const selectors = [ALL, FAILED_ONLY, !!PERIOD].filter(Boolean).length

if (!ORG_ARG || selectors !== 1) {
  console.error(
    'usage: reset-accounting.ts <organizationId|name> <selector> [options]\n\n' +
      '  selectors, exactly one:\n' +
      '    --failed-only     delete postings whose EXPORT was refused.\n' +
      '                      🛑 These are REAL entries: since the export split a refused\n' +
      '                      push leaves the entry posted, so deleting one removes it\n' +
      '                      from the books. The product remedy is Retry export.\n' +
      '    --period <key>    delete one period key, any shape (2026-08, DEP-0003, INV-0012)\n' +
      '    --all             delete every posting this organization has\n\n' +
      '  options:\n' +
      '    --wizard          also return the setup wizard and opening baseline to draft\n' +
      '    --keep-map        do not clear the QuickBooks account map\n' +
      '    --force           past the providerEntryId and remaining-postings guards\n' +
      '    --confirm         actually write. Without it this is a dry run.\n'
  )
  process.exit(1)
}

/**
 * Every key the wizard and the close write, returned to its catalog default.
 *
 * Written through `batchUpdateOrganizationSettings` rather than deleted, so the
 * organization lands exactly where one that never opened the wizard sits, and
 * still passes that function's normalization and unknown-key check.
 */
const WIZARD_KEYS = [
  { key: 'accounting.setupState' as const, value: 'draft' },
  { key: 'accounting.setupFinalizedAt' as const, value: null },
  { key: 'accounting.setupFinalizedByUserId' as const, value: null },
  { key: 'accounting.cutoffPeriod' as const, value: null },
  { key: 'accounting.bookTimeZone' as const, value: null },
  { key: 'accounting.openingRawMaterials' as const, value: null },
  { key: 'accounting.openingWip' as const, value: null },
  { key: 'accounting.openingFinishedGoods' as const, value: null },
  { key: 'accounting.qboOpeningRawMaterials' as const, value: null },
  { key: 'accounting.qboOpeningWip' as const, value: null },
  { key: 'accounting.qboOpeningFinishedGoods' as const, value: null },
  { key: 'accounting.qboOpeningJournalRef' as const, value: null },
  { key: 'ledger.lockedThroughMonth' as const, value: null },
]

const QUICKBOOKS_APP_SLUG = 'quickbooks'

function money(minor: number | bigint | null): string {
  if (minor === null) return '-'
  return `$${(Number(minor) / 100).toFixed(2)}`
}

/** Resolve `<org>` as an id first, then as a name. */
async function resolveOrg(): Promise<{ id: string; name: string | null }> {
  const byId = await db.query.Organization.findFirst({
    where: (t, { eq: is }) => is(t.id, ORG_ARG),
    columns: { id: true, name: true },
  })
  if (byId) return byId

  const byName = await db.query.Organization.findMany({
    where: (t, { ilike }) => ilike(t.name, ORG_ARG),
    columns: { id: true, name: true },
    limit: 5,
  })
  if (byName.length === 1 && byName[0]) return byName[0]
  if (byName.length > 1) {
    console.error(`'${ORG_ARG}' matches ${byName.length} organizations:`)
    for (const o of byName) console.error(`  ${o.id}  ${o.name}`)
    process.exit(1)
  }
  console.error(`No organization matches '${ORG_ARG}' by id or name.`)
  process.exit(1)
}

/**
 * The org's QuickBooks installation and connection, by query rather than
 * through `resolveQuickbooksContext`.
 *
 * That helper also resolves the app DEPLOYMENT and answers `connected: false`
 * when the bundle cannot be resolved. For a tool whose whole job is cleaning up
 * after something went wrong, "the deployment is broken so I will not clear the
 * map" is the wrong failure mode. Nothing here invokes a tool.
 */
async function resolveQuickbooksConnection(
  organizationId: string
): Promise<{ installationId: string; connectionId: string } | null> {
  const install = await db
    .select({ id: schema.AppInstallation.id })
    .from(schema.AppInstallation)
    .innerJoin(schema.App, eq(schema.App.id, schema.AppInstallation.appId))
    .where(
      and(
        eq(schema.AppInstallation.organizationId, organizationId),
        eq(schema.App.slug, QUICKBOOKS_APP_SLUG)
      )
    )
    .limit(1)

  const installationId = install[0]?.id
  if (!installationId) return null

  const credential = await db
    .select({ id: schema.Credential.id })
    .from(schema.Credential)
    .where(eq(schema.Credential.appInstallationId, installationId))
    .limit(1)

  const connectionId = credential[0]?.id
  if (!connectionId) return null

  return { installationId, connectionId }
}

async function main() {
  const org = await resolveOrg()
  const scope = ALL ? 'every posting' : FAILED_ONLY ? 'failed postings' : `period ${PERIOD}`

  console.log(`\norganization ${org.name} (${org.id})`)
  console.log(`selection    ${scope}`)
  console.log(`mode         ${CONFIRM ? 'DELETE' : 'dry run (pass --confirm to write)'}`)
  console.log(
    `also         ${
      [KEEP_MAP ? null : 'clear QuickBooks account map', WIZARD ? 'reopen the setup wizard' : null]
        .filter(Boolean)
        .join(', ') || 'nothing'
    }\n`
  )

  // ── 1. The postings in scope ──────────────────────────────────────────────

  const where = [eq(schema.GlPosting.organizationId, org.id)]
  // Since the export split there is no `failed` LEDGER status: a refused push
  // leaves the entry posted and stamps `exportStatus`. So this selector now
  // means "entries whose export was refused", and deleting one throws away a
  // real entry. That is right for a dev reset and wrong everywhere else, which
  // is why the summary says so.
  if (FAILED_ONLY) where.push(eq(schema.GlPosting.exportStatus, 'failed'))
  if (PERIOD) where.push(eq(schema.GlPosting.periodKey, PERIOD))

  const postings = await db
    .select({
      id: schema.GlPosting.id,
      postingType: schema.GlPosting.postingType,
      periodKey: schema.GlPosting.periodKey,
      revision: schema.GlPosting.revision,
      status: schema.GlPosting.status,
      docNumber: schema.GlPosting.docNumber,
      totalMinor: schema.GlPosting.totalMinor,
      providerId: schema.GlPosting.providerId,
      providerEntryId: schema.GlPosting.providerEntryId,
      attempts: schema.GlPosting.attempts,
      failureReason: schema.GlPosting.failureReason,
    })
    .from(schema.GlPosting)
    .where(and(...where))
    // Descending revision is also the delete order `reversesId`'s RESTRICT forces.
    .orderBy(desc(schema.GlPosting.revision))

  if (postings.length === 0) {
    console.log('postings: none in scope - already clean\n')
  } else {
    console.log(`postings: ${postings.length} row(s), highest revision first`)
    for (const p of postings) {
      const exported = p.providerEntryId ? ` EXPORTED ${p.providerId}:${p.providerEntryId}` : ''
      console.log(
        `  ${p.status.padEnd(8)} rev${p.revision} ${p.postingType.padEnd(19)}` +
          ` ${(p.docNumber ?? '').padEnd(22)} ${money(p.totalMinor).padStart(13)}` +
          ` attempts=${p.attempts}${exported}`
      )
      if (p.failureReason) console.log(`           ${p.failureReason.slice(0, 150)}`)
    }
    console.log('')
  }

  // ── 2. Guard: anything already on the provider ────────────────────────────

  const exportedRows = postings.filter((p) => p.providerEntryId !== null)
  if (exportedRows.length > 0 && !FORCE) {
    console.error(
      `🛑 REFUSING. ${exportedRows.length} posting(s) carry a providerEntryId and are already in\n` +
        '   the accounting system. Deleting our row orphans a real journal entry over there and\n' +
        '   leaves the next close computing its delta against a snapshot the provider no longer\n' +
        '   agrees with.\n\n' +
        '   Reverse them in the app, or pass --force once you have deleted them by hand.\n'
    )
    process.exit(1)
  }
  if (exportedRows.length > 0) {
    console.log(
      `⚠️  --force: deleting ${exportedRows.length} posting(s) that DID reach the provider.\n`
    )
  }

  // ── 3. Guard: a reversal outside the selection ────────────────────────────
  //
  // Only reachable on a partial selection. `reversesId` is ON DELETE RESTRICT,
  // so a row we keep that reverses a row we delete rejects the delete halfway
  // through and leaves the reset half applied.

  if (postings.length > 0 && !ALL) {
    const ids = postings.map((p) => p.id)
    const dependants = await db
      .select({
        id: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        reversesId: schema.GlPosting.reversesId,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, org.id),
          isNotNull(schema.GlPosting.reversesId),
          inArray(schema.GlPosting.reversesId, ids)
        )
      )

    const outside = dependants.filter((d) => !ids.includes(d.id))
    if (outside.length > 0 && !FORCE) {
      console.error(
        `🛑 REFUSING. ${outside.length} posting(s) OUTSIDE this selection reverse a row inside it.\n` +
          '   GlPosting.reversesId is ON DELETE RESTRICT, so the delete would fail partway.\n'
      )
      for (const d of outside) console.error(`   ${d.docNumber} reverses ${d.reversesId}`)
      console.error('\n   Widen the selection (--all), or pass --force.\n')
      process.exit(1)
    }
  }

  // ── 4. The account map ────────────────────────────────────────────────────

  let mappings: { glAccountId: string; code: string; name: string; providerAccountId: string }[] =
    []
  let connection: { installationId: string; connectionId: string } | null = null

  if (!KEEP_MAP) {
    connection = await resolveQuickbooksConnection(org.id)
    if (!connection) {
      console.log('account map: no QuickBooks connection for this org - nothing to clear\n')
    } else {
      const map = await readQuickbooksAccountMap({ organizationId: org.id, ...connection })
      const chart = await listChartAccounts(db, org.id)
      const byId = new Map(chart.isOk() ? chart.value.map((a) => [a.id, a] as const) : [])

      mappings = [...map.entries()].map(([glAccountId, providerAccountId]) => ({
        glAccountId,
        code: byId.get(glAccountId)?.code ?? '????',
        name: byId.get(glAccountId)?.name ?? '(not in the live chart)',
        providerAccountId,
      }))
      mappings.sort((a, b) => a.code.localeCompare(b.code))

      if (mappings.length === 0) {
        console.log('account map: empty\n')
      } else {
        console.log(`account map: ${mappings.length} mapped account(s)`)
        for (const m of mappings) {
          console.log(`  ${m.code.padEnd(6)} ${m.name.padEnd(34)} -> ${m.providerAccountId}`)
        }
        console.log('')
      }
    }
  }

  if (WIZARD) {
    console.log(
      `settings: ${WIZARD_KEYS.length} key(s) back to their defaults, setupState -> draft\n`
    )
  }

  if (!CONFIRM) {
    console.log('dry run - nothing was written. Re-run with --confirm.\n')
    return
  }

  // ── 5. Do it ──────────────────────────────────────────────────────────────

  for (const p of postings) {
    await db
      .delete(schema.GlPosting)
      .where(and(eq(schema.GlPosting.id, p.id), eq(schema.GlPosting.organizationId, org.id)))
    console.log(`deleted ${p.docNumber ?? p.id} (${p.status} rev${p.revision})`)
  }

  if (connection) {
    for (const m of mappings) {
      await clearQuickbooksAccountMapping({
        organizationId: org.id,
        installationId: connection.installationId,
        connectionId: connection.connectionId,
        glAccountId: m.glAccountId,
      })
      console.log(`cleared mapping ${m.code} -> ${m.providerAccountId}`)
    }
  }

  // AFTER the deletes, so the remaining-postings check sees the world this run
  // leaves behind rather than the one it found.
  let reopened = false
  if (WIZARD) {
    const [remaining] = await db
      .select({ id: schema.GlPosting.id })
      .from(schema.GlPosting)
      .where(eq(schema.GlPosting.organizationId, org.id))
      .limit(1)

    if (remaining && !FORCE) {
      console.error(
        '\n🛑 NOT reopening the wizard. Postings still exist for this organization.\n' +
          '   Reopening the opening baseline underneath a posted entry rewrites the arithmetic\n' +
          '   behind it, which is the edit the settings freeze exists to prevent.\n' +
          '   Re-run with --all, or pass --force.\n'
      )
    } else {
      await batchUpdateOrganizationSettings({ organizationId: org.id, settings: WIZARD_KEYS })
      // The router's job when a human does this. See the header.
      await onCacheEvent('org.settings.changed', { orgId: org.id, broadcastUserKeys: true })
      reopened = true
      console.log(`reset ${WIZARD_KEYS.length} setting(s); accounting.setupState is draft`)
    }
  }

  console.log(
    `\ndone. ${postings.length} posting(s), ${mappings.length} mapping(s)` +
      `${reopened ? ', wizard reopened' : ''}.\n` +
      (postings.length > 0
        ? 'Those period keys are unclaimed - the documents can be posted again.\n'
        : '') +
      (mappings.length > 0
        ? 'The account map is empty, so the first Post refuses until the accounts are re-mapped.\nThat refusal is the mapping step working.\n'
        : '') +
      (reopened ? 'The wizard reruns from page 1 and the opening baseline is editable.\n' : '')
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
