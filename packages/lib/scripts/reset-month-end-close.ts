// packages/lib/scripts/reset-month-end-close.ts
//
// 🛑 DEV-ONLY. Unwedges one organization's month-end close so it can be driven
// again from scratch: deletes the `GlPosting` rows for one period and, unless
// `--postings-only`, clears the QuickBooks account map so the setup wizard's
// mapping step starts empty.
//
//   npx dotenv -- npx tsx packages/lib/scripts/reset-month-end-close.ts <orgId> <periodKey>
//   npx dotenv -- npx tsx packages/lib/scripts/reset-month-end-close.ts <orgId> <periodKey> --confirm
//
// Read-only without `--confirm`. Companion to `drive-month-end-close.ts`, which
// previews without persisting; this one deletes what a previous drive persisted.
//
// ── Why this needs to exist at all ──────────────────────────────────────────
//
// A period cannot be re-posted through any supported path once revision 0 is
// claimed. `postEntry` defaults `revision` to 0 (`post-entry.ts:443`) and
// `GlPosting_reversal_check` is `(revision = 0 AND reversesId IS NULL) OR
// (revision > 0 AND reversesId IS NOT NULL)`, so an original is ALWAYS revision
// 0 and a fresh post of a claimed period converges on `already_posted`.
//
// The two supported ways forward both dead-end on a failed row:
//
//   - `reverseEntry` accepts only a `posted` original, so a `failed` revision
//     cannot be reversed.
//   - Re-pushing a `failed` row is a distinct operation that must reuse that
//     row's claimed `requestId` and `docNumber`, and it is NOT BUILT -
//     `post-entry.ts:552` says so in as many words ("It is owed").
//
// So a close that failed at the provider leaves the period permanently claimed.
// In production that is correct and the remedy is to build the re-push. In dev
// it means one bad mapping burns the month, which is why this is a script and
// not a feature.
//
// ── 🛑 The guard that matters: `providerEntryId` ─────────────────────────────
//
// Deleting a `GlPosting` whose entry actually reached the accounting system
// orphans a real journal entry over there - our side forgets, the provider's
// books do not, and the next close computes its delta against a prior snapshot
// that no longer describes what the provider holds. So a row carrying a
// `providerEntryId` REFUSES, and `--force` is the only way past it.
//
// That guard is dormant today and will not stay that way. As of 2026-08-31 no
// entry in this database has ever been pushed: revisions 0 and 1 of DemoOrg1's
// `2026-08` were posted while `quickbooks.postJournalEntries` was false, so
// `QuickbooksAccountingProvider.postEntry` returned `status: 'disabled'` and
// pushed nothing (`quickbooks-accounting-provider.ts:599`), and revision 2
// failed on unmapped accounts before reaching the push. All three carry a NULL
// `providerEntryId`. The first genuinely exported month is the one this guard
// is for.
//
// ── Delete order is forced by a constraint ──────────────────────────────────
//
// `GlPosting.reversesId` is `ON DELETE RESTRICT`, so a reversal has to go before
// the row it reverses: descending `revision`. `GlPostingLine.glPostingId` is
// `ON DELETE CASCADE`, so lines need no statement of their own.
//
// ── Why the account map is cleared through its own module ───────────────────
//
// `clearQuickbooksAccountMapping` removes the `qboAccountId` cell AND its
// `RecordIdentity` mirror. A raw `DELETE FROM "FieldValue"` would leave the
// mirror behind, which is exactly the drift the identity reconciler exists to
// catch - a reset that manufactures work for a repair job is not a reset.
//
// The map is connection-scoped, so it is resolved through the org's QuickBooks
// `Credential`, and an org with no connection simply has no map to clear.

import { database as db, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import {
  clearQuickbooksAccountMapping,
  readQuickbooksAccountMap,
} from '../src/money/quickbooks/account-map'
import { listChartAccounts } from '../src/postings'

const ORG = process.argv[2] ?? ''
const PERIOD = process.argv[3] ?? ''
const args = process.argv.slice(4)
const CONFIRM = args.includes('--confirm')
const POSTINGS_ONLY = args.includes('--postings-only')
const FORCE = args.includes('--force')

if (!ORG || !/^\d{4}-\d{2}$/.test(PERIOD)) {
  console.error(
    'usage: reset-month-end-close.ts <organizationId> <periodKey> [--postings-only] [--force] [--confirm]\n' +
      '       periodKey is YYYY-MM, e.g. 2026-08'
  )
  process.exit(1)
}

const QUICKBOOKS_APP_SLUG = 'quickbooks'

function money(minor: number | bigint | null): string {
  if (minor === null) return '-'
  return `$${(Number(minor) / 100).toFixed(2)}`
}

/**
 * The org's QuickBooks installation and its connection, resolved by query
 * rather than through `resolveQuickbooksContext`.
 *
 * Deliberate: that helper also resolves the app DEPLOYMENT and answers
 * `connected: false` when the server bundle cannot be resolved. For a tool whose
 * whole purpose is to clean up after something went wrong, "the deployment is
 * broken so I will not clear the map" is the wrong failure mode. Nothing here
 * invokes a tool, so the deployment is not needed.
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
  const org = await db.query.Organization.findFirst({
    where: (t, { eq: is }) => is(t.id, ORG),
    columns: { id: true, name: true },
  })
  if (!org) {
    console.error(`No organization ${ORG}`)
    process.exit(1)
  }

  console.log(`\norganization ${org.name} (${org.id})`)
  console.log(`period       ${PERIOD}`)
  console.log(`mode         ${CONFIRM ? 'DELETE' : 'dry run (pass --confirm to delete)'}`)
  console.log(`scope        postings${POSTINGS_ONLY ? '' : ' + QuickBooks account map'}\n`)

  // ── 1. The postings ───────────────────────────────────────────────────────

  const postings = await db
    .select({
      id: schema.GlPosting.id,
      postingType: schema.GlPosting.postingType,
      revision: schema.GlPosting.revision,
      status: schema.GlPosting.status,
      docNumber: schema.GlPosting.docNumber,
      totalMinor: schema.GlPosting.totalMinor,
      providerId: schema.GlPosting.providerId,
      providerEntryId: schema.GlPosting.providerEntryId,
    })
    .from(schema.GlPosting)
    .where(and(eq(schema.GlPosting.organizationId, ORG), eq(schema.GlPosting.periodKey, PERIOD)))
    // Descending, which is also the delete order `reversesId`'s RESTRICT forces.
    .orderBy(desc(schema.GlPosting.revision))

  if (postings.length === 0) {
    console.log('postings: none - this period is already clean\n')
  } else {
    console.log(`postings: ${postings.length} row(s), newest revision first`)
    for (const p of postings) {
      const exported = p.providerEntryId ? ` EXPORTED as ${p.providerId}:${p.providerEntryId}` : ''
      console.log(
        `  rev ${String(p.revision).padEnd(3)} ${p.status.padEnd(9)} ${(p.docNumber ?? '').padEnd(24)} ${money(p.totalMinor).padStart(16)}${exported}`
      )
    }
    console.log('')
  }

  const exportedRows = postings.filter((p) => p.providerEntryId !== null)
  if (exportedRows.length > 0 && !FORCE) {
    console.error(
      `🛑 REFUSING. ${exportedRows.length} of these postings reached the accounting provider and\n` +
        '   carry a providerEntryId. Deleting our row would orphan a real journal entry over\n' +
        '   there and leave the next close computing its delta against a snapshot the provider\n' +
        '   no longer agrees with.\n\n' +
        '   Reverse the entry in the app instead, or pass --force if you have already deleted\n' +
        `   the ${exportedRows.length} entr${exportedRows.length === 1 ? 'y' : 'ies'} on the provider's side by hand.\n`
    )
    process.exit(1)
  }
  if (exportedRows.length > 0) {
    console.log(
      `⚠️  --force: deleting ${exportedRows.length} posting(s) that DID reach the provider.\n`
    )
  }

  // ── 2. The account map ────────────────────────────────────────────────────

  let mappings: { glAccountId: string; code: string; name: string; providerAccountId: string }[] =
    []
  let connection: { installationId: string; connectionId: string } | null = null

  if (!POSTINGS_ONLY) {
    connection = await resolveQuickbooksConnection(ORG)
    if (!connection) {
      console.log('account map: no QuickBooks connection for this org - nothing to clear\n')
    } else {
      const map = await readQuickbooksAccountMap({ organizationId: ORG, ...connection })
      const chart = await listChartAccounts(db, ORG)
      const byId = new Map(chart.isOk() ? chart.value.map((a) => [a.id, a] as const) : [])

      mappings = [...map.entries()].map(([glAccountId, providerAccountId]) => ({
        glAccountId,
        code: byId.get(glAccountId)?.code ?? '????',
        name: byId.get(glAccountId)?.name ?? '(account not in the live chart)',
        providerAccountId,
      }))
      mappings.sort((a, b) => a.code.localeCompare(b.code))

      if (mappings.length === 0) {
        console.log('account map: empty\n')
      } else {
        console.log(
          `account map: ${mappings.length} mapped account(s) on connection ${connection.connectionId}`
        )
        // Two of ours pointing at ONE provider account is legal - `G19` allows
        // several roles to share an account - but on the inventory roles it
        // silently merges two balances into one line over there, so it is called
        // out rather than just listed.
        const byProvider = new Map<string, number>()
        for (const m of mappings)
          byProvider.set(m.providerAccountId, (byProvider.get(m.providerAccountId) ?? 0) + 1)
        for (const m of mappings) {
          const shared = (byProvider.get(m.providerAccountId) ?? 0) > 1 ? '  ⚠️ shared' : ''
          console.log(
            `  ${m.code.padEnd(6)} ${m.name.padEnd(38)} -> provider account ${m.providerAccountId}${shared}`
          )
        }
        console.log('')
      }
    }
  }

  // ── 3. Do it ──────────────────────────────────────────────────────────────

  if (!CONFIRM) {
    console.log('dry run - nothing was deleted. Re-run with --confirm.\n')
    return
  }

  // Descending revision: `reversesId` is ON DELETE RESTRICT, so a reversal must
  // go before the row it names. Lines cascade.
  for (const p of postings) {
    await db
      .delete(schema.GlPosting)
      .where(and(eq(schema.GlPosting.id, p.id), eq(schema.GlPosting.organizationId, ORG)))
    console.log(`deleted posting rev ${p.revision} ${p.docNumber ?? p.id}`)
  }

  if (connection) {
    for (const m of mappings) {
      await clearQuickbooksAccountMapping({
        organizationId: ORG,
        installationId: connection.installationId,
        connectionId: connection.connectionId,
        glAccountId: m.glAccountId,
      })
      console.log(`cleared mapping ${m.code} -> ${m.providerAccountId}`)
    }
  }

  console.log(
    `\ndone. ${postings.length} posting(s), ${mappings.length} mapping(s).\n` +
      `${PERIOD} is unclaimed - preview and Post it again from /app/accounting.\n` +
      (mappings.length > 0
        ? 'The account map is empty, so the first Post will refuse until the accounts are\nre-mapped in the setup wizard. That refusal is the mapping step working.\n'
        : '')
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
