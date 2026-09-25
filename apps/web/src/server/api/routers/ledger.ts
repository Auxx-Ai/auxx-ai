// apps/web/src/server/api/routers/ledger.ts

import { type Database, schema } from '@auxx/database'
import {
  buildExportBatches,
  countExportBatchesByState,
  countSkippedBeforeFloor,
  countSummaryRows,
  countUnbuiltSummaryRows,
  EXPORT_BATCH_PAGE_SIZE,
  type ExportBatchRow,
  listExportBatches,
  listSummaryRows,
  readExportModeSwitchImpact,
  readSummaryBucket,
  readUnbuiltSummaryMembers,
  readUnbuiltSummaryPage,
  rebuildSummaryBucket,
  releaseExportBatches,
  releaseFailedBatchesNamingAccount,
  retryExportBatch,
  rollbackExportBatch,
  sendExportBatch,
  sendSummaryBucket,
} from '@auxx/lib/accounting/export'
// The comparison itself is PURE (brief 20 §8.2), so it lives on the client-safe
// leaf beside the other planners and is imported from there rather than being
// re-exported through the server barrel for one call site.
import {
  EXPORT_BATCH_STATES,
  EXPORT_BATCH_TABS,
  exportBatchTabStates,
  OUTBOX_GROUP_BYS,
  OUTBOX_ORDERS,
} from '@auxx/lib/accounting/export/client'
import {
  createJournalEntry,
  discardJournalEntry,
  getJournalEntry,
  listJournalEntries,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  updateJournalEntry,
} from '@auxx/lib/accounting/journals'
import {
  clearRecurringJournalSchedule,
  listRecurringJournalTemplates,
  setRecurringJournalSchedule,
} from '@auxx/lib/accounting/journals/recurring'
import {
  ACCOUNT_ROLES,
  assertAccountingSetupUnfrozen,
  CHART_PACK_KEYS,
  createChartAccount,
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
  EXPORT_AVENUES,
  GL_ACCOUNT_SUBTYPES,
  GL_ACCOUNT_TYPES,
  getPosting,
  importChartFromProvider,
  listChartAccounts,
  listChartAccountUsage,
  listClosePeriods,
  listPostings,
  listPostingsForSource,
  listRoleMap,
  listRoleSources,
  monthDateRange,
  readCloseBlockers,
  readExportSettings,
  readLatestPostingsByType,
  readLedgerSummary,
  removeChartAccount,
  restoreChartAccount,
  reverseEntries,
  reverseEntry,
  type SaveMappingRow,
  saveRoleAssignments,
  setLockedThrough,
  setRoleAssignment,
  updateChartAccount,
  verifyBooksBalance,
} from '@auxx/lib/accounting/ledger'
import {
  enqueueProviderSync,
  PROVIDER_SYNC_RUN_STALE_MS,
  PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
  readProviderSyncRunState,
  syncProviderSyncScheduler,
} from '@auxx/lib/accounting/mirror'
import type { ProviderSyncScheduleConfig } from '@auxx/lib/accounting/mirror/client'
import {
  countBlockedWork,
  getPaymentAccount,
  listBlockedWork,
  listBlockedWorkItems,
  readMovementDetail,
  readMovements,
} from '@auxx/lib/accounting/money'
import { finalizeAccountingSetup } from '@auxx/lib/accounting/opening'
import { ensureGuestContact } from '@auxx/lib/accounting/parties'
import {
  accountingOpeningPolicySchema,
  activateAccountingBookConnection,
  confirmSuggestedIdentities,
  createAndLinkProviderAccount,
  createProviderAccounts,
  listAccountIdentities,
  readAccountingBookConnectionStatus,
  readActiveBookConnection,
  repairAccountingBookConnection,
  resolveAccountingProvider,
  setAccountIdentity,
} from '@auxx/lib/accounting/providers'
import { planProviderAgreement } from '@auxx/lib/accounting/providers/client'
import { mintRailAccounts } from '@auxx/lib/accounting/rails'
// The naming catalogue is PURE and client-safe (brief 26 §7.2), so it lives on
// its own leaf subpath and is imported from there rather than through the
// `payment-gateways` barrel, which reaches Drizzle and the org cache.
import { suggestRail } from '@auxx/lib/accounting/rails/rail-catalogue'
import { readTrialBalance } from '@auxx/lib/accounting/reports'
import { readShipmentDetail } from '@auxx/lib/accounting/sales'
import {
  isWorkItemCode,
  requestAccountingRecovery,
  wakeReasonCode,
  wakeSources,
  wakeWorkItemGroup,
} from '@auxx/lib/accounting/work-items'
import { getCachedEntityDefId, getCachedInstalledApps } from '@auxx/lib/cache'
import { BadRequestError, UnprocessableEntityError } from '@auxx/lib/errors'
import { PermissionKey } from '@auxx/lib/permissions'
import { recurrencePatternSchema } from '@auxx/lib/recurrence'
import { toRecordId } from '@auxx/lib/resources/client'
import { seedChartAccounts, seedChartPacks, seedDefaultPaymentGateways } from '@auxx/lib/seed'
import { getOrganizationSetting, updateOrganizationSetting } from '@auxx/lib/settings'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { requestAuditContext } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, permissionProcedure } from '~/server/api/trpc'
import { ledgerConnectAndGoRouter } from './ledger-connect-and-go'

/** What a posting's links are read in, so two postings of a kind read alike (task 83 §2.1). */
const SOURCE_ROLE_ORDER = ['parent', 'counterparty', 'subject', 'member']

const logger = createScopedLogger('ledger-router')

/**
 * Put the failed batches that named this account back on the queue.
 *
 * Never fails the mutation: the mapping itself succeeded, and a re-release that
 * does not happen leaves the Retry button exactly where it was.
 */
async function rereleaseForAccount(
  db: Parameters<typeof releaseFailedBatchesNamingAccount>[0],
  organizationId: string,
  glAccountId: string
): Promise<void> {
  const result = await releaseFailedBatchesNamingAccount(db, { organizationId, glAccountId })
  if (result.isErr())
    logger.warn('Could not re-release the failed batches naming a newly mapped account', {
      organizationId,
      glAccountId,
      error: result.error.message,
    })
}

function sourceRoleRank(linkRole: string): number {
  const rank = SOURCE_ROLE_ORDER.indexOf(linkRole)
  return rank === -1 ? SOURCE_ROLE_ORDER.length : rank
}

/** Every posting's `GlPostingSource` rows, hydrated to badges, in one read for the whole list. */
async function readPostingSources(db: Database, organizationId: string, glPostingIds: string[]) {
  const rows = await db
    .select({
      id: schema.GlPostingSource.id,
      glPostingId: schema.GlPostingSource.glPostingId,
      sourceKind: schema.GlPostingSource.sourceKind,
      sourceId: schema.GlPostingSource.sourceId,
      linkRole: schema.GlPostingSource.linkRole,
      occurrence: schema.GlPostingSource.occurrence,
    })
    .from(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        inArray(schema.GlPostingSource.glPostingId, [...new Set(glPostingIds)])
      )
    )
  const hydrated = await hydrateSources(db, organizationId, rows)
  const bySource = new Map<string, typeof hydrated>()
  for (const source of hydrated) {
    const list = bySource.get(source.glPostingId)
    if (list) list.push(source)
    else bySource.set(source.glPostingId, [source])
  }
  return bySource
}

async function hydrateSources<
  T extends { id: string; sourceKind: string; sourceId: string; linkRole: string },
>(db: Database, organizationId: string, rows: T[]) {
  const movements = await readMovements(
    db,
    organizationId,
    rows.filter((row) => row.sourceKind === 'money_transaction').map((row) => row.sourceId)
  )
  // A `sourceKind` that is an entity type becomes a `RecordId` so the client
  // renders a badge, a `money_transaction` a `MovementBadge`; the remaining
  // ledger-only kinds (`gl_posting`, `payout`, …) stay text.
  const hydrated = await Promise.all(
    rows.map(async (row) => {
      const defId = await getCachedEntityDefId(organizationId, row.sourceKind)
      const movement = movements.get(row.sourceId)
      return {
        ...row,
        recordId: defId ? toRecordId(defId, row.sourceId) : null,
        movement:
          row.sourceKind === 'money_transaction' && movement
            ? {
                id: movement.id,
                purpose: movement.purpose,
                // A string on the wire; the badge only formats it.
                amountMinor: movement.amountMinor.toString(),
                currency: movement.currency,
                currencyExponent: movement.currencyExponent,
              }
            : null,
      }
    })
  )
  return hydrated.sort(
    (a, b) => sourceRoleRank(a.linkRole) - sourceRoleRank(b.linkRole) || a.id.localeCompare(b.id)
  )
}

/**
 * The general ledger's posting surface (plans/money/tasks/10-the-poster.md §6).
 *
 * **Manual, synchronous, and deliberately so.** For the cutover the trigger is a
 * person clicking Post - roughly 30 entries a month - so a cron buys nothing at
 * that volume and costs the ability to look at an entry before it reaches the
 * financial statements. A human is watching and wants the answer, so these are
 * plain procedures rather than jobs. Event triggers, an hourly scheduler and an
 * approval-gated workflow node come later, and only after two closes have agreed
 * with a hand reconciliation.
 *
 * | procedure         | gate         |
 * | ----------------- | ------------ |
 * | `failedExports` | `ledger.view` |
 * | `retryExport` | `ledger.post` |
 * | `syncExports` | `ledger.post` |
 * | `unsyncExports` | `ledger.control` |
 * | `verifyBalance`   | `ledger.view` |
 * | `reverse`         | `ledger.post` |
 * | `reverseMany`     | `ledger.post` |
 * | `setLockedThrough` | `ledger.control` |
 * | `syncProviderLedger` | `ledger.control` |
 * | `providerSyncRunState` | `ledger.view` |
 *
 * `ledger` is its own L2 area rather than a corner of `billing`: `billing`
 * governs what auxx charges this org, this governs what the org's own books say
 * about its money, and the two are held by different people. See
 * `PERMISSION_AREAS[Area.ledger]`.
 *
 * ## Why nothing here maps a status onto an HTTP error
 *
 * `postEntry` and `reverseEntry` never throw. An unmapped account role, an
 * unbalanced entry and a provider that refused the push all come back as a
 * typed {@link PostResult} status, and every one of them is something the UI
 * RENDERS - a setup problem, a role to map - not a 500 to swallow. So these
 * mutations return the result verbatim and let the caller branch on `status`.
 * Collapsing a refusal into a `TRPCError`
 * would throw away `docNumber`, `failureClass` and `retryable`, which is the
 * whole of what the operator needs to decide what to do next.
 *
 * What DOES throw is everything upstream of the poster: `buildEntry` refuses an
 * entry that does not balance, and `periodMonth` rejects a malformed bound.
 * Both throw `AuxxError` subclasses, which `auxxErrorMiddleware`
 * maps to the right status. Nothing here catches them - a `try/catch` that
 * rethrew would have to guard with `isAuxxError(e)` from `~/server/api/trpc`,
 * never `e instanceof TRPCError`, or the 422 flattens into a 500.
 */
/**
 * An accounting MONTH, `'2026-08'`.
 *
 * Validated here only for SHAPE. Whether the month is closable - after the
 * cutoff, not already locked, with something in it to close - is decided by
 * `readCloseBlockers`, which answers with one item per piece of outstanding
 * work, naming the exact row to fix. Restating any of that in Zod would give the same
 * input two authorities and the worse error would win.
 */
const monthKey = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, 'periodKey must be a YYYY-MM month'),
})

/**
 * The same month, optional.
 *
 * Only `listPostings` takes this: an org whose accounting is finalized with a
 * cutoff in the future resolves NO month, and the ledger page's Entries section
 * is the only door to a manual journal entry. A required month there hid every
 * posting on exactly the screen somebody opens to find one. Absent means "the
 * whole ledger"; a malformed value is still refused.
 */
const optionalMonthKey = z.object({
  periodKey: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'periodKey must be a YYYY-MM month')
    .optional(),
})

/** Rows per page on every Outbox tab. */
const OUTBOX_PAGE_SIZE = 50

/** Offset paging in `useInfiniteQuery`'s shape - the banking review queue's convention. */
const outboxPage = z.object({
  search: z.string().trim().max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.number().int().min(0).optional(),
})

/** One summary group's identity - what `ExportBatch_grain_key` holds, without the book. */
const unbuiltGroup = z.object({
  avenue: z.enum(EXPORT_AVENUES),
  grainKey: z.string().min(1),
  storeId: z.string().nullable(),
  railId: z.string().nullable(),
  currency: z.string().min(1),
})

/** `readUnbuiltSummaryPage`'s keyset cursor: the last row's full sort key. */
const unbuiltCursor = z.object({
  txnDateTo: z.iso.date(),
  avenue: z.string(),
  grainKey: z.string(),
  storeId: z.string(),
  railId: z.string(),
  currency: z.string(),
})

/** One Blocked group's identity - its code and wake keys. */
const workItemGroup = z.object({
  reasonCode: z.string().min(1),
  role: z.string().nullable(),
  railId: z.string().nullable(),
  glAccountId: z.string().nullable(),
  externalRef: z.string().nullable().optional(),
})

/** The book zone a Blocked date range is cut in, read only when a range is set. */
async function readOutboxZone(
  organizationId: string,
  input: { from?: string; to?: string }
): Promise<string | undefined> {
  if (!input.from && !input.to) return undefined
  const zone = await getOrganizationSetting({ organizationId, key: 'accounting.bookTimeZone' })
  return typeof zone === 'string' ? zone : undefined
}

/** The Outbox's one category vocabulary, on every tab: the avenue. */
const outboxCategories = z.array(z.enum(EXPORT_AVENUES)).max(EXPORT_AVENUES.length).optional()

/** Reject inverted ranges before querying any outbox family. */
const validOutboxRange = (input: { from?: string; to?: string }) =>
  !input.from || !input.to || input.from <= input.to
const outboxRangeError = { message: 'End date must be on or after start date', path: ['to'] }

/**
 * Adds `providerObjectUrl` to each batch. The deep-link guard (plan 67 §5.6): only a `sent`
 * batch with a provider id, sent to the book connected right now, links out.
 */
async function withProviderObjectUrls<T extends ExportBatchRow>(
  db: Database,
  organizationId: string,
  batches: T[]
): Promise<Array<T & { providerObjectUrl: string | null }>> {
  const [connection, provider] = await Promise.all([
    readActiveBookConnection(db, organizationId),
    resolveAccountingProvider(organizationId),
  ])
  const activeBookId = connection?.bookId ?? null
  return batches.map((batch) => ({
    ...batch,
    providerObjectUrl:
      batch.state === 'sent' && batch.providerObjectId && batch.bookId === activeBookId
        ? (provider.objectUrl?.({
            objectType: batch.objectType,
            externalId: batch.providerObjectId,
          }) ?? null)
        : null,
  }))
}

/** Adds `providerObjectUrl` to Blocked items naming a provider entry, under the same book guard. */
async function withProviderEntryUrls<T extends { sourceKind: string; sourceId: string }>(
  db: Database,
  organizationId: string,
  items: T[]
): Promise<Array<T & { providerObjectUrl: string | null }>> {
  const entryIds = items
    .filter((item) => item.sourceKind === 'provider_ledger_entry')
    .map((item) => item.sourceId)
  if (entryIds.length === 0) return items.map((item) => ({ ...item, providerObjectUrl: null }))
  const e = schema.ProviderLedgerEntry
  const [entries, connection, provider] = await Promise.all([
    db
      .select({
        id: e.id,
        bookId: e.bookId,
        providerTxnType: e.providerTxnType,
        providerTxnId: e.providerTxnId,
      })
      .from(e)
      .where(and(eq(e.organizationId, organizationId), inArray(e.id, entryIds))),
    readActiveBookConnection(db, organizationId),
    resolveAccountingProvider(organizationId),
  ])
  const activeBookId = connection?.bookId ?? null
  const urls = new Map(
    entries.map((entry) => [
      entry.id,
      entry.bookId === activeBookId
        ? (provider.objectUrl?.({
            objectType: entry.providerTxnType,
            externalId: entry.providerTxnId,
          }) ?? null)
        : null,
    ])
  )
  return items.map((item) => ({
    ...item,
    providerObjectUrl:
      item.sourceKind === 'provider_ledger_entry' ? (urls.get(item.sourceId) ?? null) : null,
  }))
}

/**
 * One `journal_entry_line` child as the drawer sends it. `amountMinor` is integer
 * minor units (the browser converts at the `CurrencyInput` boundary); a zero saves,
 * and `buildManualEntry` refuses it at Post, naming the row.
 */
const journalEntryLine = z.object({
  /** The line's instance id: present keeps and updates that row, absent creates one. */
  id: z.string().min(1).optional(),
  /** The `gl_account` instance id out of this org's chart, never a code (task 15). */
  glAccountId: z.string().min(1),
  direction: z.enum(['debit', 'credit']),
  amountMinor: z.number().int().nonnegative(),
  memo: z.string().max(1000).optional(),
  /**
   * Who this line is attributable to, when it names a receivable or payable
   * account (brief 13 §1.4). Optional everywhere; the only refusal on an
   * empty counterparty happens at QuickBooks export time, never on save.
   */
  counterpartyType: z.enum(['customer', 'vendor']).optional(),
  counterpartyId: z.string().min(1).optional(),
})

export const ledgerRouter = createTRPCRouter({
  connectAndGo: ledgerConnectAndGoRouter,

  bookConnectionStatus: permissionProcedure(PermissionKey.ledgerControl).query(({ ctx }) =>
    readAccountingBookConnectionStatus(ctx.db, ctx.session.organizationId)
  ),
  repairBookConnection: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        connectionId: z.string().min(1),
        credentialId: z.string().min(1),
        expectedActiveConnectionId: z.string().min(1).nullable(),
        reason: z.string().trim().min(1).max(2000),
      })
    )
    .mutation(({ ctx, input }) =>
      repairAccountingBookConnection(ctx.db, {
        ...input,
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
      })
    ),
  activateBookConnection: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        credentialId: z.string().min(1),
        expectedActiveConnectionId: z.string().min(1).nullable(),
        openingPolicy: accountingOpeningPolicySchema,
      })
    )
    .mutation(({ ctx, input }) =>
      activateAccountingBookConnection(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        credentialId: input.credentialId,
        expectedActiveConnectionId: input.expectedActiveConnectionId,
        exportFromDate: input.openingPolicy.exportFromDate,
        openingPolicy: input.openingPolicy,
      })
    ),

  /** Finalize setup server-side, then post the opening entry - both Finalize buttons call this. */
  finalizeSetup: permissionProcedure(PermissionKey.ledgerControl).mutation(async ({ ctx }) => {
    const result = await finalizeAccountingSetup(ctx.db, {
      organizationId: ctx.session.organizationId,
      actorUserId: ctx.session.userId,
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Back out a posted entry with a second, opposite one.
   *
   * There is no edit and no void: the reversal is its own `GlPosting` row
   * carrying `reversesId`, and the original flips to `reversed` in the same
   * transaction. Nothing about the original provider entry is touched, so the
   * provider's register ends up holding both halves - which is what a bookkeeper
   * expects to see and what makes the pair auditable.
   *
   * Gated on `ledgerPost`, not on a separate key: a reversal IS a post, it lands
   * in the same books, and someone trusted to write to the ledger is exactly
   * who should be able to correct it.
   */
  reverse: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        glPostingId: z.string().min(1),
        memo: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      return reverseEntry(ctx.db, {
        organizationId,
        glPostingId: input.glPostingId,
        actorUserId: userId,
        memo: input.memo,
        onlyIfExported: true,
      })
    }),

  /**
   * Reverse several postings in one press - the outbox's bulk Reverse.
   *
   * 🛑 A LEDGER operation, unlike `unsyncExports` beside it in the same bulk
   * bar. Every accepted row writes a NEW entry into the books and flips its
   * original to `reversed`; nothing is edited and nothing is deleted, but an
   * effect-backed original's accepted effect IS released so its source can be
   * posted again (plans/accounting/tasks/done/62-correcting-an-effect-backed-posting.md).
   * The copy already in the provider is left exactly where it is
   * (plans/accounting/tasks/60-un-syncing-from-the-provider.md E1/E2).
   *
   * One outcome per posting and never a throw: an entry that is
   * not `posted` and an unmapped account all arrive as that row's `refused`
   * message and land the rest of the selection.
   *
   * ⚠️ Capped at **100**, not `syncExports`' 500. A release stamps a column;
   * each of these is a full `postEntry` - claim, resolve against the chart,
   * write lines and effects - run sequentially inside the request.
   */
  reverseMany: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        glPostingIds: z.array(z.string().min(1)).min(1).max(100),
        memo: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      return reverseEntries(ctx.db, {
        organizationId,
        glPostingIds: input.glPostingIds,
        actorUserId: userId,
        memo: input.memo,
        onlyIfExported: true,
      })
    }),

  /**
   * Every month from the accounting cutoff to now, with its state - the
   * console's period strip.
   *
   * Derived from `GlPosting` + `accounting.cutoffPeriod` +
   * `ledger.lockedThroughMonth`, with **no new table**. Task 13 deferred the
   * `gl_close_period` entity pair and this is why that deferral holds: there is
   * nothing for a table to hold that the ledger does not already answer.
   *
   * An organization that has not finished setup gets an EMPTY strip rather than
   * an error. "You have not started" is not a failure, and the module home
   * renders the setup checklist in that case.
   */
  periods: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listClosePeriods(ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Declare the books shut through one month, or reopen back to the month
   * before it. This is the ONLY door onto `ledger.lockedThroughMonth`.
   *
   * Gated on `ledgerControl`, not `settingsManage` (plans/accounting/tasks/
   * 12-accountant-permissions.md §0.4/§4.4). Closing a period is the single most
   * characteristic act of an accountant, and the generic settings door would
   * have handed them every organization setting in the product to get it. See
   * `setting.ts`'s `ROUTER_OWNED_ORG_SETTING_KEYS`, which refuses this key on
   * the generic door so this stays the only path.
   *
   * `periodKey: null` reopens everything - "nothing is closed" - which is
   * `resolvePeriodLock`'s own reading of an unset value.
   */
  setLockedThrough: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        periodKey: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .nullable(),
      })
    )
    .use(notDemo('lock or unlock an accounting period'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const key = 'ledger.lockedThroughMonth' as const

      // Mirrors `setting.updateOrganizationSetting`'s guard: harmless today
      // (this key is not in `FROZEN_SETUP_SETTING_KEYS`), but the same
      // authority should apply if that ever changes.
      await assertAccountingSetupUnfrozen(organizationId, [key])

      await setLockedThrough(ctx.db, {
        organizationId,
        periodKey: input.periodKey,
        actorUserId: ctx.session.user.id,
        ...requestAuditContext(ctx.headers),
        sessionId: ctx.session.id ?? null,
      })

      return { success: true }
    }),

  /**
   * What stands between one month and its close.
   *
   * 🛑 A close POSTS NOTHING since MIGRATION step 5: every inventory document
   * posted its own entry when it was written, so all a close can do is check -
   * is every movement in an entry, and does the ledger tie to the movements.
   * The items are the answer and the console renders one actionable row each.
   */
  closeBlockers: permissionProcedure(PermissionKey.ledgerView)
    .input(monthKey)
    .query(async ({ ctx, input }) => {
      return readCloseBlockers(ctx.db, {
        organizationId: ctx.session.organizationId,
        periodKey: input.periodKey,
      })
    }),

  /**
   * One posting with its lines and its stored envelope - the posting drawer's single read.
   * The envelope's assertions come back as stored, never re-derived, so a reversed month
   * still renders its swapped pair.
   */
  get: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await getPosting(ctx.db, ctx.session.organizationId, input.id)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Every `GlPostingSource` row this posting carries - the posting drawer's
   * Links list (accounting migration step 1c).
   *
   * A plain scoped select rather than a `postings/` lib read: nothing upstream
   * of this needs the OTHER direction (`listPostingsForSource` walks
   * `sourceKind`/`sourceId` → posting), and adding a one-off reverse read there
   * for a single drawer would be a lib export with one caller.
   */
  postingSources: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ glPostingId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const rows = await ctx.db
        .select({
          id: schema.GlPostingSource.id,
          sourceKind: schema.GlPostingSource.sourceKind,
          sourceId: schema.GlPostingSource.sourceId,
          linkRole: schema.GlPostingSource.linkRole,
          occurrence: schema.GlPostingSource.occurrence,
        })
        .from(schema.GlPostingSource)
        .where(
          and(
            eq(schema.GlPostingSource.organizationId, organizationId),
            eq(schema.GlPostingSource.glPostingId, input.glPostingId)
          )
        )
      return hydrateSources(ctx.db, organizationId, rows)
    }),

  /**
   * Every posting role and the account it resolves to, plus every store and
   * rail it may be scoped to.
   *
   * Returns a row for EVERY role in `ACCOUNT_ROLES`, mapped or not: the role map
   * is a complete checklist, and a list of only the rows that happen to exist
   * could never show what is missing. Each role's `overrides` carries its
   * per-store rows and `railOverrides` its per-rail rows (with a currency
   * sub-row where one exists) - `sources` is what `listRoleSources` offers a
   * picker for either axis (task 58 §6.1), stores from evidence, rails from the
   * org's own live `payment_gateway` records.
   */
  roleMap: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const [result, sources] = await Promise.all([
      listRoleMap(ctx.db, organizationId),
      // The stores and rails a scopable role may be pointed at (task 47 §7.4,
      // task 58 §6.1). On the same read as the roles because the tree renders
      // them together, and a second round trip would let the two arrive out of
      // step - a role showing an override for a store or rail the picker has
      // not heard of yet.
      listRoleSources(ctx.db, organizationId),
    ])
    if (result.isErr()) throw result.error
    return { roles: result.value, sources }
  }),

  /**
   * Point one role at an account, or mark it unused.
   *
   * Gated on `ledgerControl` rather than `ledgerPost`: this decides where real
   * money lands, not merely that it moves, so it belongs with the people
   * trusted to control the ledger's structure, not everyone trusted to post to
   * it.
   */
  setRoleAssignment: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        role: z.enum(Object.values(ACCOUNT_ROLES) as [string, ...string[]]),
        glAccountId: z.string().min(1).nullish(),
        markedUnused: z.boolean().optional(),
        /**
         * Scope this edit to one connection (task 47 §7.3). Every refusal that
         * belongs to it - a role that cannot be scoped, a connection that is not
         * this org's, a revenue role pointed at a merchant account - is
         * `setRoleAssignment`'s, and its sentence is what reaches the screen.
         */
        sourceAccountId: z.string().min(1).nullish(),
        /** Drop this connection's override so it follows the default again. */
        useDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const result = await setRoleAssignment(ctx.db, {
        organizationId,
        role: input.role,
        glAccountId: input.glAccountId,
        markedUnused: input.markedUnused,
        sourceAccountId: input.sourceAccountId,
        useDefault: input.useDefault,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Apply the Mapping tab's whole staged batch in one call (59 §2.4): every
   * edit goes through `setRoleAssignment`'s own validation, in one transaction,
   * so one refused row refuses the batch and names itself - never a partial
   * save the screen would have to reconcile against what it just rendered.
   *
   * Same `ledgerControl` rung as `setRoleAssignment`, for the same reason.
   */
  saveMapping: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z
        .object({
          role: z.enum(Object.values(ACCOUNT_ROLES) as [string, ...string[]]),
          /** `null` is the org default; a store or a rail scopes the edit (58 §3). */
          scope: z
            .union([
              z.object({ store: z.string().min(1) }).strict(),
              z.object({ rail: z.string().min(1) }).strict(),
            ])
            .nullable(),
          /** Only meaningful beside `scope: { rail }` - a settlement currency. */
          currency: z.string().min(1).nullish(),
          /** An account id, or one of the two sentinels the row's picker offers beside one. */
          value: z.string().min(1),
        } satisfies Record<keyof SaveMappingRow, z.ZodTypeAny>)
        .array()
        .min(1)
    )
    .mutation(async ({ ctx, input }) => {
      const result = await saveRoleAssignments(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        rows: input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The organization's chart of accounts - every non-archived `gl_account`. */
  chartAccounts: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // 🛑 Archived rows are opt-IN, and only the settings list opts in. Every
      // other caller of this query feeds a picker or a preview, where a removed
      // account is an account money must not land in.
      const result = await listChartAccounts(ctx.db, ctx.session.organizationId, {
        includeArchived: input?.includeArchived,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * How many posted lines landed on each account, keyed on `glAccountId` (task 15).
   *
   * Read by the Chart of accounts tab alone. A posting line stores the
   * account's id with no foreign key, so a deleted account still reports its
   * true count - renumbering an account no longer affects this number at all.
   */
  chartAccountUsage: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listChartAccountUsage(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * The `G19` account map: every account in the org's chart, the account it is
   * mapped to in the connected accounting system, and what the matcher would
   * suggest for the ones without a mapping.
   *
   * ⚠️ **This one reaches the provider**, unlike every other read on this
   * router - it fetches the connected system's chart of accounts over the app
   * Lambda. Expect it to be slow relative to its neighbours, and do not put it
   * behind a component that renders on every page.
   *
   * An org with nothing connected gets its own chart back with every row
   * `unmapped` and no provider accounts, which is `P1`'s supported
   * configuration rather than an error.
   */
  accountMap: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listAccountIdentities(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Confirm that one of the org's accounts IS one account in the connected
   * system, or withdraw that confirmation by sending a null id.
   *
   * Gated on `ledgerControl` for `setRoleAssignment`'s reason: this decides
   * which external account real money lands in, so it belongs with the people
   * trusted to control the ledger's structure rather than everyone trusted to
   * post to it.
   */
  setAccountIdentity: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        glAccountId: z.string().min(1),
        providerAccountId: z.string().min(1).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await setAccountIdentity(ctx.db, {
        organizationId: ctx.session.organizationId,
        glAccountId: input.glAccountId,
        providerAccountId: input.providerAccountId,
        actorUserId: ctx.session.userId,
      })
      if (result.isErr()) throw result.error
      // Withdrawing a mapping (a null id) cannot unblock anything.
      if (input.providerAccountId)
        await rereleaseForAccount(ctx.db, ctx.session.organizationId, input.glAccountId)
      return result.value
    }),

  /**
   * Create the counterpart of one of our accounts in the connected system, then
   * link the two - the seam run BACKWARDS.
   *
   * The accounts auxx creates itself (a clearing account per card rail, the
   * role-bearing core) exist on one side only, so the matcher has nothing to
   * offer for them and {@link setAccountIdentity} has nothing to point at. This
   * is how they stop blocking the export without somebody retyping each one
   * into QuickBooks by hand.
   *
   * Same rung as `setAccountIdentity` and for a stronger version of its reason:
   * this does not only decide which external account real money lands in, it
   * ADDS that account to somebody's books. `accountMap.canCreateProviderAccounts`
   * says whether the connected system can be asked at all.
   */
  createProviderAccount: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        glAccountId: z.string().min(1),
        /** Create the account's unlinked parents first - the screen names them in its confirm. */
        includeAncestors: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createAndLinkProviderAccount(ctx.db, {
        organizationId: ctx.session.organizationId,
        glAccountId: input.glAccountId,
        includeAncestors: input.includeAncestors,
        actorUserId: ctx.session.userId,
      })
      if (result.isErr()) throw result.error
      // The ancestors were mapped too, and a batch may name one of them.
      for (const created of [...result.value.ancestors, result.value])
        await rereleaseForAccount(ctx.db, ctx.session.organizationId, created.row.account.id)
      return result.value
    }),

  /**
   * `createProviderAccount` for a selection - the chart tab's bulk action (97
   * item 10). One resolved connection, parents before children, sequential
   * against the provider, halting on the first refusal with the rows already
   * linked kept and reported. Same rung, same reason.
   */
  createProviderAccounts: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ glAccountIds: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await createProviderAccounts(ctx.db, {
        organizationId: ctx.session.organizationId,
        glAccountIds: input.glAccountIds,
        actorUserId: ctx.session.userId,
      })
      if (result.isErr()) throw result.error
      for (const created of result.value.created)
        await rereleaseForAccount(ctx.db, ctx.session.organizationId, created.row.account.id)
      return result.value
    }),

  /**
   * Confirm every suggestion at once - the wizard's "accept all" action.
   *
   * A human confirmation under `G19`: the person has been shown every proposed
   * pairing and is agreeing to the set. The connect-and-go flow may also run it
   * on connect (see plans/accounting/tasks/105-connect-and-go.md §6a).
   *
   * Reports partial success rather than rolling back. Twenty good mappings and
   * one refusal is a better outcome than none, and the refusals come back named
   * so the screen can show which.
   */
  confirmSuggestedAccounts: permissionProcedure(PermissionKey.ledgerControl).mutation(
    async ({ ctx }) => {
      const result = await confirmSuggestedIdentities(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }
  ),

  /**
   * Write the requested chart PACKS, and point each role at the account that
   * fulfils it (brief 16 §1.5).
   *
   * `packs` defaults to `['core']`, and `core` is walked whether or not it is
   * named: a bare `provisionChart()` - what the wizard's button sent before
   * the pack picker existed - still means the core, and the picker and the
   * Roles tab's Add accounts action both name their packs explicitly. A
   * pack's own `requires` is expanded transitively before the walk runs, so
   * `{ packs: ['purchasing'] }` also lands `inventory`.
   *
   * ── Why this is a BUTTON and not part of creating an organization ──
   *
   * `gl_account`'s DEFINITION ships with every org (`SYSTEM_ENTITIES`), but its
   * ROWS do not, deliberately: most orgs never open the accounting module, and
   * a chart nobody asked for is a table everybody has to scan. Provisioning is
   * the first step of setting accounting up, so it lives where somebody has
   * said they want accounting.
   *
   * 🛑 It also closes a real hole. `seedChartPacks`' only other caller is
   * entity migration 108, which reaches production through the DataMigration
   * ledger - and `DataMigration.id` is the PRIMARY KEY, one global row, no
   * `organizationId`. Once 108 is `applied` it never runs again, so **every org
   * created after that deploy would have had a def, no accounts, and every core
   * role unmapped with no way to fix it.** This is that way.
   *
   * Safe to press twice, for any set of packs: the seed is idempotent on `code`
   * and its assignments are `ON CONFLICT (organizationId, role) DO NOTHING`, so
   * a second press over an already-provisioned pack reports `created: 0` and
   * cannot disturb an account or a mapping somebody has edited. That is
   * `seedChartPacks`' rules 1, 3 and 4, and they are the whole reason this can
   * be offered as a button at all - and the whole reason the Roles tab's Add
   * accounts action can re-walk a `partial` pack without asking which rows are
   * already there.
   */
  provisionChart: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      // Brief 16 §1.5. The outer `.default` keeps a bare `provisionChart()`
      // meaning the core, which is what the wizard's button sent before the
      // pack picker existed; the picker and the Roles tab's Add accounts both
      // name their packs explicitly.
      z
        .object({ packs: z.array(z.enum(CHART_PACK_KEYS)).default(['core']) })
        .default({ packs: ['core'] })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const glAccountDefId = await getCachedEntityDefId(organizationId, 'gl_account')
      if (!glAccountDefId) {
        throw new UnprocessableEntityError(
          'This organization has no gl_account definition, so there is nothing to seed a chart into. Run the entity migrations.',
          { organizationId }
        )
      }

      const chart = await seedChartPacks(ctx.db, organizationId, glAccountDefId, input.packs)

      // Task 13 §5.3: the one default `payment_gateway` record. Runs AFTER the
      // chart on purpose - the clearing account it points at (`clearing`)
      // only exists once the chart above has just created or confirmed it.
      // Brief 16 §1.5 ties it to the `card_rail` pack; gated on the WALKED
      // packs, not the requested ones, so `requires` expansion is honoured
      // (though nothing requires `card_rail` today, so the two currently agree).
      const paymentGateways = chart.packs.includes('card_rail')
        ? await seedDefaultPaymentGateways(ctx.db, organizationId)
        : null

      // Task 79 §4.1: the org's one guest customer, so every order has a
      // customer from here on. `ctx.db` is the pool, so the settings write busts
      // the org cache itself and no explicit invalidation is needed.
      const guestContact = await ensureGuestContact(ctx.db, organizationId)

      return { ...chart, paymentGateways, guestContact }
    }),

  /**
   * Adopt named accounts from the catalogue - the Chart tab's From catalogue
   * picker (brief 16 §3.2), which selects ACCOUNTS where `provisionChart`
   * selects packs.
   *
   * 🛑 A pack is not a fine enough unit for this door. "Add Deferred Revenue"
   * is a reasonable thing to want, and `provisionChart(['prepayments'])` would
   * land Customer Deposits alongside it - an account nobody asked for, on a
   * screen whose whole job is showing what the chart contains.
   *
   * 🛑 Codes are validated against the catalogue and an unknown one is
   * REFUSED, naming itself. The picker only ever sends codes it rendered, so an
   * unknown code means the client and this deploy disagree about what the
   * catalogue is; creating an account from a code with no catalogue row behind
   * it would invent a name, a type and a role out of nothing.
   *
   * Same `ledgerControl` rung as `provisionChart`, for the same reason: an
   * account carrying a role decides where real money lands. And safe to press
   * twice for the same reason - `seedChartAccounts` keeps all four rules.
   */
  adoptChartAccounts: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ codes: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const glAccountDefId = await getCachedEntityDefId(organizationId, 'gl_account')
      if (!glAccountDefId) {
        throw new UnprocessableEntityError(
          'This organization has no gl_account definition, so there is nothing to seed a chart into. Run the entity migrations.',
          { organizationId }
        )
      }

      const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((account) => [account.code, account]))
      const unknown = input.codes.filter((code) => !byCode.has(code))
      if (unknown.length > 0) {
        throw new BadRequestError(
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is not an account' : 'are not accounts'} in the catalogue.`,
          { organizationId, unknown }
        )
      }

      // De-duplicated: a code sent twice would be filtered to one `missing` row
      // anyway, but `skipped` is reported to the reader and double-counting it
      // would say a code was already there when it was merely named twice.
      const accounts = [...new Set(input.codes)].map(
        (code) => byCode.get(code) as DefaultChartAccount
      )

      return seedChartAccounts(ctx.db, organizationId, glAccountDefId, accounts, {
        source: 'catalogue',
      })
    }),

  /**
   * Import the connected provider's chart of accounts as the org's own
   * (brief 16 §2). Creates only what the org lacks, sets each new account's
   * identity, assigns the unambiguous roles as `suggested`, and adds the
   * role-bearing core accounts the provider has no counterpart for.
   *
   * Same rung as `provisionChart`: this decides where money lands.
   * `refreshOnly` is the Chart tab's door and never creates the missing core.
   */
  importChartFromProvider: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ refreshOnly: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await importChartFromProvider(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        refreshOnly: input.refreshOnly,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Which card rails this org already has, so the wizard can pre-check the
   * `card_rail` pack (brief 16 §3.2). Facts about the org, not switches: a
   * Stripe Connect account is the read the payouts sync makes, and the Shopify
   * app is the `installedApps` cache. Nothing provisions off either (16 §3.3).
   */
  paymentRailsPresent: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const [account, installedApps] = await Promise.all([
      getPaymentAccount(organizationId),
      getCachedInstalledApps(organizationId),
    ])
    return {
      stripeConnect: Boolean(account?.stripeAccountId),
      shopify: installedApps.some((installed) => installed.app.slug === 'shopify'),
    }
  }),

  /**
   * Add one account to the org's chart.
   *
   * ── Why these live on `ledgerPost` and not on the generic record path ──
   *
   * 🛑 `record.create` / `record.update` are `capabilityProcedure` and assert the
   * RECORDS capability for the definition. Routing the chart through them would
   * hand "which account does `grni` resolve to" to anyone with records-Full and
   * ledger-None - and a renumber there is undetectable downstream, because the
   * resulting entry still balances. Gated on `ledgerControl`, not `ledgerPost`:
   * `setRoleAssignment` above already made this call for the same reason - this
   * decides where real money lands, which is a rung above ordinary posting.
   *
   * `gl_account` therefore stays `isVisible: false` and this is its only door.
   *
   * The refusals are the lib's, verbatim - see `postings/chart-write.ts`. Zod
   * checks structure only, for the reason `postingLine` gives at the top of this
   * file: two authorities over one input, and the worse message wins.
   */
  chartAccountCreate: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        /**
         * Optional (task 15 §5): a chart imported from a provider that ships
         * with numbering off, or one a person keeps by name alone, has no
         * code at all. The lib refuses a blank code the same as an absent one.
         */
        code: z.string().max(32).optional(),
        name: z.string().min(1),
        accountType: z.enum(GL_ACCOUNT_TYPES),
        isActive: z.boolean().optional(),
        subtype: z.enum(GL_ACCOUNT_SUBTYPES).nullable().optional(),
        /** Sub-account parent (CHART-HIERARCHY §4). Omit or `null` for top level. */
        parentId: z.string().min(1).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await createChartAccount(ctx.db, {
        ...input,
        organizationId,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Change one account. Only the keys sent are written.
   *
   * `code` and `name` are unconditional (`G7`); `accountType` and `isActive` are
   * refused when a role still posts to the account, naming it. `code: null` or
   * a blank string clears it (task 15 §5) - the account id is the identity, so
   * removing the label leaves a perfectly postable account.
   */
  chartAccountUpdate: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        id: z.string().min(1),
        code: z.string().max(32).nullable().optional(),
        name: z.string().optional(),
        accountType: z.enum(GL_ACCOUNT_TYPES).optional(),
        isActive: z.boolean().optional(),
        subtype: z.enum(GL_ACCOUNT_SUBTYPES).nullable().optional(),
        /** `null` moves the account to top level (CHART-HIERARCHY §4). */
        parentId: z.string().min(1).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { id, ...values } = input
      const result = await updateChartAccount(ctx.db, {
        ...values,
        organizationId,
        accountId: id,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Take one account out of the chart.
   *
   * ARCHIVES - the lib module carries the three reasons there is no hard delete.
   * Refused while a role still posts to the account.
   */
  chartAccountRemove: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await removeChartAccount(ctx.db, {
        organizationId,
        accountId: input.id,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Put a removed account back. Same `ledgerControl` rung as the removal - a
   * restored account becomes postable again the moment a role names it.
   */
  chartAccountRestore: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const result = await restoreChartAccount(ctx.db, {
        organizationId,
        accountId: input.id,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Mint the chart accounts one payment rail needs (brief 26 §7).
   *
   * 🛑 **Its own door, and deliberately NOT part of creating the gateway.**
   * `createPaymentGateway`'s jsdoc states *"What it must NOT do: mint an
   * account per gateway"* and §7.4 keeps that true: the gateway writer names
   * EXISTING accounts. A caller that wants both in one click calls this and
   * then names the ids that come back (`paymentGateway.setUp` does both).
   *
   * 🛑 **No role, and no way to ask for one.** `mintRailAccounts` offers no
   * role parameter - the rule that killed `clearing_affirm` on 2026-09-10,
   * since a role must not name a vendor. A minted account is reached by id,
   * through the gateway record that points at it.
   *
   * ⚠️ `mintFeeAccount` is the CALLER's answer, not a derivation from the
   * rail. §5's defaults (a `netted` rail books to the shared `6100` fallback, a
   * `billed` rail mints its own) are the wizard's checkbox default; a mutation
   * that decided it here would overrule whatever the person just unticked.
   *
   * `handle` is used for one thing: defaulting the two account names through
   * the suggestion catalogue when the client did not send them. Suggestions
   * only - nothing here routes (§7.2), and an unknown handle gets a titled name
   * rather than a refusal.
   *
   * `ledgerControl`, the rung `chartAccountCreate` and `setRoleAssignment` both
   * sit on: this decides where real money lands.
   */
  mintRailAccounts: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        /** The gateway handle being routed, e.g. `'shopify_payments'`. Names only. */
        handle: z.string().min(1),
        /** Overrides the suggested clearing account name. */
        clearingAccountName: z.string().min(1).optional(),
        /** Mint a dedicated fee account as well as the clearing account. */
        mintFeeAccount: z.boolean(),
        /** Overrides the suggested fee account name. */
        feeAccountName: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const suggestion = suggestRail(input.handle)
      const result = await mintRailAccounts(ctx.db, {
        organizationId,
        actorUserId: userId,
        clearingAccountName: input.clearingAccountName ?? suggestion.clearingAccountName,
        mintFeeAccount: input.mintFeeAccount,
        feeAccountName: input.feeAccountName ?? suggestion.feeAccountName,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The export queue: one row per {@link ExportBatch}, expandable to the
   * postings it rolls up (TARGET §3, §6).
   *
   * A read, and `ledgerView`: asking changes nothing.
   */
  exportBatches: createTRPCRouter({
    /**
     * Batches, newest first, one page at a time. `tab` is the Outbox's own
     * filter (Ready holds `sending` too); `glPostingIds` is a card's or the
     * drawer's read - the batches these postings are live members of.
     */
    list: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            ...outboxPage.shape,
            categories: outboxCategories,
            /** One accounting month, `'2026-09'`. Bounds the read by DETAIL date. */
            month: z.string().min(1).optional(),
            tab: z.enum(EXPORT_BATCH_TABS).optional(),
            /** `day` orders by the row's day so a page never splits a group the client renders. */
            groupBy: z.enum(OUTBOX_GROUP_BYS).optional(),
            order: z.enum(OUTBOX_ORDERS).optional(),
            glPostingIds: z.array(z.string().min(1)).max(500).optional(),
            limit: z.number().int().min(1).max(500).optional(),
            /** The row offset the next page starts at, as `useInfiniteQuery` hands it back. */
            cursor: z.number().int().min(0).optional(),
          })
          .refine(validOutboxRange, outboxRangeError)
      )
      .query(async ({ ctx, input }) => {
        const pageSize = input.limit ?? EXPORT_BATCH_PAGE_SIZE
        const offset = input.cursor ?? 0
        const result = await listExportBatches(ctx.db, {
          organizationId: ctx.session.organizationId,
          categories: input.categories,
          search: input.search,
          from: input.from,
          to: input.to,
          ...(input.month ? { month: input.month } : {}),
          ...(input.tab ? { states: exportBatchTabStates(input.tab) } : {}),
          ...(input.glPostingIds ? { glPostingIds: input.glPostingIds } : {}),
          orderBy: input.groupBy === 'day' ? 'day' : 'created',
          direction: input.order,
          limit: pageSize,
          offset,
        })
        if (result.isErr()) throw result.error

        const items = await withProviderObjectUrls(ctx.db, ctx.session.organizationId, result.value)
        // A full page means there MAY be more; a short one is the end.
        return { items, nextCursor: items.length === pageSize ? offset + pageSize : undefined }
      }),

    /**
     * The Summary view: one row per bucket in the export window, with its live batch
     * or none (plans/accounting/tasks/95-the-summary-is-the-row.md §3.2).
     */
    summaryRows: permissionProcedure(PermissionKey.ledgerView)
      .input(
        outboxPage
          .extend({
            categories: outboxCategories,
            tab: z.enum(EXPORT_BATCH_TABS),
            order: z.enum(OUTBOX_ORDERS).optional(),
          })
          .refine(validOutboxRange, outboxRangeError)
      )
      .query(async ({ ctx, input }) => {
        const { organizationId } = ctx.session
        const pageSize = input.limit ?? EXPORT_BATCH_PAGE_SIZE
        const offset = input.cursor ?? 0
        const result = await listSummaryRows(ctx.db, {
          organizationId,
          tab: input.tab,
          categories: input.categories,
          search: input.search,
          from: input.from,
          to: input.to,
          direction: input.order,
          limit: pageSize,
          offset,
        })
        if (result.isErr()) throw result.error

        const { items: rows, total } = result.value
        const batches = await withProviderObjectUrls(
          ctx.db,
          organizationId,
          rows.flatMap((row) => (row.batch ? [row.batch] : []))
        )
        const sources = await readPostingSources(
          ctx.db,
          organizationId,
          batches.flatMap((batch) => batch.members.map((member) => member.glPostingId))
        )
        const byId = new Map(
          batches.map((batch) => [
            batch.id,
            {
              ...batch,
              members: batch.members.map((member) => ({
                ...member,
                sources: sources.get(member.glPostingId) ?? [],
              })),
            },
          ])
        )
        const items = rows.map((row) => ({
          ...row,
          batch: row.batch ? (byId.get(row.batch.id) ?? null) : null,
        }))
        return {
          items,
          total,
          nextCursor: offset + pageSize < total ? offset + pageSize : undefined,
        }
      }),

    /** Send one summary row: build its bucket when no live batch holds it, then send or retry. */
    sendBucket: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ key: unbuiltGroup }))
      .mutation(async ({ ctx, input }) => {
        const result = await sendSummaryBucket(ctx.db, {
          organizationId: ctx.session.organizationId,
          key: input.key,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** `sent · n new`: roll back, rebuild, resend (95 D3). `ledgerControl` for `rollback`'s reason. */
    rebuildBucket: permissionProcedure(PermissionKey.ledgerControl)
      .input(z.object({ key: unbuiltGroup, force: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const result = await rebuildSummaryBucket(ctx.db, {
          organizationId: ctx.session.organizationId,
          key: input.key,
          ...(input.force === undefined ? {} : { force: input.force }),
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Summary mode's rows Build has not made yet: posted, unbatched entries
     * grouped the way a batch would group them. Empty in Transaction mode.
     */
    unbuilt: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            search: z.string().trim().max(200).optional(),
            from: z.iso.date().optional(),
            to: z.iso.date().optional(),
            categories: outboxCategories,
            limit: z.number().int().min(1).max(200).optional(),
            /** The last row of the previous page, as `useInfiniteQuery` hands it back. */
            cursor: unbuiltCursor.optional(),
            order: z.enum(OUTBOX_ORDERS).optional(),
          })
          .refine(validOutboxRange, outboxRangeError)
      )
      .query(async ({ ctx, input }) => {
        const result = await readUnbuiltSummaryPage(ctx.db, {
          organizationId: ctx.session.organizationId,
          from: input.from,
          to: input.to,
          avenues: input.categories,
          search: input.search,
          limit: input.limit ?? EXPORT_BATCH_PAGE_SIZE,
          cursor: input.cursor,
          direction: input.order,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** Postings dated before the export floor that no batch holds - never exported (101 E6). */
    skippedBeforeFloor: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
      const result = await countSkippedBeforeFloor(ctx.db, ctx.session.organizationId)
      if (result.isErr()) throw result.error
      return result.value
    }),

    /** What an Export Mode switch leaves behind: the three counts General's confirm shows. */
    modeSwitchImpact: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
      const result = await readExportModeSwitchImpact(ctx.db, ctx.session.organizationId)
      if (result.isErr()) throw result.error
      return result.value
    }),

    /** One Summary row's drawer: the journal it sends and the postings it sums. */
    summaryBucket: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ key: unbuiltGroup }))
      .query(async ({ ctx, input }) => {
        const { organizationId } = ctx.session
        const result = await readSummaryBucket(ctx.db, { organizationId, key: input.key })
        if (result.isErr()) throw result.error
        const { batch, members, newMembers } = result.value
        const sources = await readPostingSources(
          ctx.db,
          organizationId,
          [...members, ...newMembers].map((member) => member.glPostingId)
        )
        const withSources = (list: typeof members) =>
          list.map((member) => ({ ...member, sources: sources.get(member.glPostingId) ?? [] }))
        const [linked] = batch ? await withProviderObjectUrls(ctx.db, organizationId, [batch]) : []
        return {
          ...result.value,
          batch: linked ?? null,
          members: withSources(members),
          newMembers: withSources(newMembers),
        }
      }),

    /** The postings inside one unbuilt group - read when its row is opened. */
    unbuiltMembers: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ group: unbuiltGroup }))
      .query(async ({ ctx, input }) => {
        const { organizationId } = ctx.session
        const result = await readUnbuiltSummaryMembers(ctx.db, {
          organizationId,
          group: input.group,
        })
        if (result.isErr()) throw result.error
        const sources = await readPostingSources(
          ctx.db,
          organizationId,
          result.value.map((member) => member.glPostingId)
        )
        return result.value.map((member) => ({
          ...member,
          sources: sources.get(member.glPostingId) ?? [],
        }))
      }),

    /**
     * Build every batch a month still owes, or just the postings named.
     *
     * 🛑 `ledgerPost`: building freezes a payload out of posted entries and is
     * the act that decides what leaves. It sends nothing - `autoSend` and the
     * sweep, or an explicit release, do that.
     */
    build: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.union([
          monthKey,
          z
            .object({
              from: z.iso.date(),
              to: z.iso.date(),
              glPostingIds: z.array(z.string().min(1)).min(1).max(500),
            })
            .refine(validOutboxRange, outboxRangeError),
          z
            .object({ from: z.iso.date(), to: z.iso.date(), group: unbuiltGroup })
            .refine(validOutboxRange, outboxRangeError),
        ])
      )
      .mutation(async ({ ctx, input }) => {
        const result = await buildExportBatches(ctx.db, {
          organizationId: ctx.session.organizationId,
          ...('periodKey' in input ? monthDateRange(input.periodKey) : input),
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Send one batch and WAIT on the provider.
     *
     * The one-row door: a single row pressed on its own wants the refusal back
     * in the same breath. Use `release` for a bulk bar.
     */
    send: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ batchId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await sendExportBatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchId: input.batchId,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Send failed batches again and reset the sweep's attempt budget.
     *
     * One `batchId` waits on the provider; `batchIds` enqueues like `release` and
     * answers its `runId` for the bulk bar to tally (93 C2).
     */
    retry: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.union([
          z.object({ batchId: z.string().min(1) }),
          z.object({ batchIds: z.array(z.string().min(1)).min(1).max(500) }),
        ])
      )
      .mutation(async ({ ctx, input }) => {
        if ('batchIds' in input) {
          const released = await releaseExportBatches(ctx.db, {
            organizationId: ctx.session.organizationId,
            batchIds: input.batchIds,
            manual: true,
          })
          if (released.isErr()) throw released.error
          return released.value
        }
        const result = await retryExportBatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchId: input.batchId,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Hand held batches to the export worker, once.
     *
     * 🛑 It RELEASES and returns; it does not wait on the provider. A send is
     * three to five sequential round trips to a rate-limited third party and a
     * bulk bar acts on forty rows at once.
     *
     * ⚠️ 500 is a ceiling on ONE call, not on the queue.
     */
    release: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ batchIds: z.array(z.string().min(1)).min(1).max(500) }))
      .mutation(async ({ ctx, input }) => {
        const result = await releaseExportBatches(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchIds: input.batchIds,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Remove the provider's copy of a sent batch and free its postings for the
     * next build (TARGET §3, "Late changes follow Synder").
     *
     * 🛑 `ledgerControl`, not `ledgerPost`. Deleting rows out of the firm's
     * books is the authority that closes and reopens a period, not the one that
     * posts a journal.
     *
     * 🛑 An EXPORT operation, never a ledger one. Nothing here reverses, reopens
     * a period or releases a claim - the postings stay `posted` and come back to
     * *Ready*. Backing an entry out of OUR books is `reverse`.
     *
     * ⚠️ Unlike `release` this WAITS on the provider, and it is one batch per
     * call: the refusals are exactly what the operator pressed the button to
     * find out.
     */
    rollback: permissionProcedure(PermissionKey.ledgerControl)
      .input(z.object({ batchId: z.string().min(1), force: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const result = await rollbackExportBatch(ctx.db, {
          organizationId: ctx.session.organizationId,
          batchId: input.batchId,
          ...(input.force === undefined ? {} : { force: input.force }),
        })
        if (result.isErr()) throw result.error
        return result.value
      }),
  }),

  /**
   * Prove that debits equal credits across every posted entry.
   *
   * The schema does not enforce the identity and this repo has no trigger
   * precedent, so the guarantee is three-part: `buildEntry` refuses to build an
   * unbalanced entry, the poster re-asserts in-transaction before commit, and
   * this sweep proves it after the fact. This is the third part.
   *
   * `postingsChecked` rides along on purpose - "0 discrepancies out of 0" and
   * "0 out of 412" are very different answers and the banner has to be able to
   * tell them apart.
   */
  // `periodKey` is OPTIONAL and adds the COMPLETENESS half - what that month
  // still owes the ledger (49 §2.4). Optional because the two callers genuinely
  // differ: the close console asks about the month on screen, while
  // `useAccountingSettingsFreeze` wants only `postingsChecked` and has no month.
  // Asked for nothing, the counts come back `null`, never `0`: a zero would read
  // as "nothing outstanding" for a question that was never put.
  verifyBalance: permissionProcedure(PermissionKey.ledgerView)
    .input(optionalMonthKey.optional())
    .query(async ({ ctx, input }) => {
      const result = await verifyBooksBalance(ctx.db, ctx.session.organizationId, {
        month: input?.periodKey,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Do our books and theirs agree as of one date, and if not, where
   * (plans/accounting/tasks/20-two-authors-one-ledger.md §8).
   *
   * Reads the provider's balance sheet and OUR trial balance as of the same
   * date, joins them through the `qboAccountId` links `chart-import.ts` stamps,
   * and hands both sides to the pure `planProviderAgreement`. Writes nothing,
   * posts nothing, and never becomes a statement source - §0.7 holds, this is a
   * COMPARISON beside the statements and the sync is what will make the
   * statements complete.
   *
   * ⚠️ **This one reaches the provider**, the same caveat {@link accountMap}
   * carries: it fetches a balance sheet over the app Lambda, so it is slow
   * relative to its neighbours. Cadence is at close and on demand, never
   * continuous (§8.3) - do not put it behind a component that runs on mount.
   *
   * 🛑 Three outcomes a screen has to be able to tell apart, and only one of
   * them is an error:
   *
   *   1. `not_connected` - nothing is authorized. A complete answer to a read
   *      (`P1`), not a failure and not an empty agreement.
   *   2. `ok` with `agreement.providerHasData: false` - connected, and the
   *      provider answered with an empty company. Distinct from agreement.
   *   3. `ok` with `agreement.totalDifferenceMinor === 0` - the books agree.
   *
   * The only refusal is a provider id claimed by more than one of our accounts,
   * which `planProviderAgreement` returns as an `err` naming BOTH accounts
   * (§8.2). It is thrown straight through - there is deliberately no `try/catch`
   * here, because catching and rethrowing is the only way an `AuxxError` gets
   * flattened into a generic 500 on its way to `auxxErrorMiddleware`.
   */
  providerAgreement: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        /** `YYYY-MM-DD`. Both sides are read as of this same day. */
        asOf: z.iso.date({ error: 'asOf must be YYYY-MM-DD' }),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const provider = await resolveAccountingProvider(organizationId)

      // Asked FIRST, and on its own: an org with nothing connected has nothing
      // to compare against, so there is no reason to read our own trial balance
      // or the account map for it.
      const sheetResult = await provider.readProviderBalances(organizationId, input.asOf)
      if (sheetResult.isErr()) throw sheetResult.error
      const sheet = sheetResult.value
      if (!sheet) return { status: 'not_connected' as const, asOf: input.asOf }

      const [ours, mappings] = await Promise.all([
        // Cumulative from the beginning of time - `from` is deliberately
        // omitted. A balance as of a date is what the provider's balance sheet
        // reports, and an activity-only window would compare a period's
        // movement against a running balance.
        readTrialBalance(ctx.db, { organizationId, to: input.asOf }),
        provider.listAccountMappings(organizationId),
      ])
      if (ours.isErr()) throw ours.error
      if (mappings.isErr()) throw mappings.error

      const planned = planProviderAgreement({
        provider: sheet.rows,
        ours: ours.value.rows,
        accountMap: mappings.value,
        // The provider's own `Header.EndPeriod`, already asserted equal to the
        // `asOf` that was asked for. Echoing the request instead would let a
        // report the provider silently re-dated render under the wrong day.
        asOf: sheet.asOf,
        providerHasData: sheet.hasData,
      })
      if (planned.isErr()) throw planned.error

      return {
        status: 'ok' as const,
        providerId: provider.id,
        /** Their reporting currency. Compared against ours by the screen, never converted. */
        providerCurrency: sheet.currency,
        agreement: planned.value,
      }
    }),

  /**
   * Open a walk over the connected provider's general ledger, so everything the
   * accountant authored there reaches these books
   * (plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §2, §4.6).
   *
   * 🛑 **It ENQUEUES; it does not walk.** Nine months is nine sequential
   * app-runtime round trips and the transport gives up before the walk does
   * (§2), so the body is one bounded `add()` and the answer is a run handle
   * rather than a `ProviderSyncOutcome`. What the run found is read back through
   * {@link providerSyncRunState}, which survives a remount, a refresh and a
   * dropped connection - the three things that lost the outcome before.
   *
   * 🛑 **`ledgerControl`, not `ledgerPost` and not `ledgerView`.** This is not
   * "post an entry": the sync walks from the cutover forward and RESTATES PRIOR
   * MONTHS - it writes entries dated into months that are already closed (which
   * it defers, §7.2) and REVERSES entries whose provider id has stopped
   * appearing (§7.1). That is the same class of authority `setLockedThrough`
   * takes, and a bookkeeper holding `ledgerPost` posts what is in front of them
   * rather than deciding that last December is now different.
   *
   * `from` is optional and means "everything the sync is allowed to see",
   * starting the month after `accounting.cutoffPeriod`. 🛑 A `from` BELOW that
   * floor is a refusal from `planSyncChunks`, never a clamp - reading the
   * opening period back would import the balances brief 19's opening entry was
   * derived from and double the entire opening position. The floor is asserted
   * in the worker, where the source is built.
   *
   * 🛑 No `try/catch`. `enqueueProviderSync` throws `ConflictError` when a walk
   * is already open for this org, and catching it is the only way an `AuxxError`
   * gets flattened into a generic 500 on its way to `auxxErrorMiddleware`.
   */
  syncProviderLedger: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        /** `YYYY-MM-DD`. Omitted means the cutover floor - see above. */
        from: z.iso.date({ error: 'from must be YYYY-MM-DD' }).optional(),
        /** `YYYY-MM-DD`, inclusive. Usually today in the book timezone. */
        to: z.iso.date({ error: 'to must be YYYY-MM-DD' }),
      })
    )
    .use(notDemo('sync the accounting provider ledger'))
    .mutation(async ({ ctx, input }) => {
      const queued = await enqueueProviderSync({
        organizationId: ctx.session.organizationId,
        from: input.from,
        to: input.to,
        trigger: 'pressed',
        actorUserId: ctx.session.userId,
      })
      // 🛑 A dropped enqueue is a press that did nothing at all - there is no
      // sweep until §5's cadence exists - so it is surfaced rather than logged
      // (§4.6.2). 422 rather than the truer 500: `errorFormatter` replaces every
      // `INTERNAL_SERVER_ERROR` message with "Internal server error", and the
      // one thing this refusal has to carry is that nothing was started.
      if (!queued) {
        throw new UnprocessableEntityError(
          'The sync could not be queued, so nothing was started and nothing was read. The job ' +
            'queue did not accept the request. Try again in a moment.',
          { organizationId: ctx.session.organizationId }
        )
      }
      return { status: 'queued' as const, from: input.from ?? null, to: input.to }
    }),

  /**
   * The inbound sync's own run state - what the panel renders (§4.4, §4.8).
   *
   * 🛑 Read from the `OrganizationSetting` ROW, never through `useSettings` or
   * `getOrganizationSetting`. Both resolve from the `orgSettings` org cache, and
   * `providerSync.state` is written after every slice with cache invalidation
   * deliberately skipped - so a cached read renders a blob several chunks stale.
   * `readProviderSyncRunState` selects the row.
   *
   * `stale` is §7.4's display fix rather than a recovery one: a chain killed
   * mid-slice by a worker restart leaves `currentRun` open with nothing to close
   * it, and a panel that believed the blob would show it running for ever. The
   * heartbeat is compared here so the browser needs no copy of the threshold -
   * `queue.ts` is server-only and the constant would not survive the client
   * boundary.
   */
  providerSyncRunState: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await readProviderSyncRunState(ctx.session.organizationId)
    if (result.isErr()) throw result.error
    const { currentRun, lastRun } = result.value
    const silentMs = currentRun ? Date.now() - Date.parse(currentRun.heartbeatAt) : 0
    return {
      currentRun: currentRun ?? null,
      lastRun: lastRun ?? null,
      /** The open run has gone quiet past the takeover threshold; a press may restart it. */
      stale: Boolean(currentRun) && !(silentMs < PROVIDER_SYNC_RUN_STALE_MS),
    }
  }),

  /**
   * How often the inbound sync runs by itself (brief 55 §5.1).
   *
   * 🛑 NOT `setting.updateOrganizationSetting`, which is why the key is
   * router-owned there. Writing `providerSync.schedule` and registering the
   * BullMQ job scheduler are one act: a value written without
   * `syncProviderSyncScheduler` is a cadence the screen claims and nothing
   * fires, and a scheduler left registered after the value says `off` is the
   * reverse. One door keeps them from disagreeing.
   *
   * 🛑 `ledgerControl`. A cadence decides when prior months get restated without
   * anybody watching, which is the same authority the press itself takes.
   *
   * ⚠️ The CADENCE is an enum here rather than a free `ScheduledTriggerConfig`.
   * The shape allows a five-minute poll; an accounting ledger read every five
   * minutes is a rate-limit incident with nobody's name on it. Three choices is
   * the whole vocabulary this door offers, and the config is built from them.
   */
  setProviderSyncSchedule: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ cadence: z.enum(['off', 'twice-daily', 'daily']) }))
    .use(notDemo('schedule the accounting provider sync'))
    .mutation(async ({ ctx, input }) => {
      const zone = await getOrganizationSetting({
        organizationId: ctx.session.organizationId,
        key: 'accounting.bookTimeZone',
      })
      // The books' own zone, not the browser's: a daily fire is a fire on an
      // accounting day, and the reader may be sitting in another one.
      const timezone = typeof zone === 'string' && zone.trim() ? zone.trim() : 'UTC'
      const config: ProviderSyncScheduleConfig =
        input.cadence === 'off'
          ? { triggerInterval: 'off', timeBetweenTriggers: {}, timezone }
          : {
              triggerInterval: 'hours',
              timeBetweenTriggers: {
                hours: input.cadence === 'twice-daily' ? 12 : 24,
                isConstant: true,
              },
              timezone,
            }

      await updateOrganizationSetting({
        organizationId: ctx.session.organizationId,
        key: PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
        value: config,
        db: ctx.db,
      })
      await syncProviderSyncScheduler(ctx.session.organizationId)
      return { cadence: input.cadence }
    }),

  /**
   * Every posting in one month EXCEPT the close entry - the ledger page's
   * entries list.
   *
   * `periods` above answers "which months have a close entry", which is a
   * different question and cannot be made to answer this one. Under L1 a month
   * held exactly one posting and no list was needed; a manual journal entry is
   * what makes a month hold N.
   *
   * The month-end inventory entry is excluded because the console renders it
   * INLINE above this list, with its own roll-forward, its own blockers and its
   * own Post button. Including it here would give the screen two places to post
   * the same thing.
   */
  listPostings: permissionProcedure(PermissionKey.ledgerView)
    // 🛑 The month is OPTIONAL here and required by `monthKey` elsewhere. The
    // ledger page resolves no month for a finalized org whose cutoff is in the
    // future, and its Entries section is the only door to a manual entry, so
    // demanding one made every posting invisible on the screen a bookkeeper
    // opens to find them. A MALFORMED month is still refused by the regex.
    .input(
      optionalMonthKey.extend({
        exportStates: z.array(z.enum(['none', ...EXPORT_BATCH_STATES])).optional(),
        order: z.enum(OUTBOX_ORDERS).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listPostings(ctx.db, {
        organizationId: ctx.session.organizationId,
        periodKey: input.periodKey,
        exportStates: input.exportStates,
        direction: input.order,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The Outbox's Transaction view: posted postings with their export state, paged (95 §3.3). */
  listExportPostings: permissionProcedure(PermissionKey.ledgerView)
    .input(
      outboxPage
        .extend({
          categories: outboxCategories,
          tab: z.enum(EXPORT_BATCH_TABS),
          order: z.enum(OUTBOX_ORDERS).optional(),
        })
        .refine(validOutboxRange, outboxRangeError)
    )
    .query(async ({ ctx, input }) => {
      const pageSize = input.limit ?? OUTBOX_PAGE_SIZE
      const offset = input.cursor ?? 0
      const result = await listPostings(ctx.db, {
        organizationId: ctx.session.organizationId,
        status: 'posted',
        // An unbatched posting waits on Ready.
        exportStates: [
          ...(input.tab === 'ready' ? (['none'] as const) : []),
          ...exportBatchTabStates(input.tab),
        ],
        categories: input.categories,
        search: input.search,
        from: input.from,
        to: input.to,
        direction: input.order,
        limit: pageSize,
        offset,
      })
      if (result.isErr()) throw result.error
      const sources = await readPostingSources(
        ctx.db,
        ctx.session.organizationId,
        result.value.map((posting) => posting.id)
      )
      return {
        items: result.value.map((posting) => ({
          ...posting,
          sources: sources.get(posting.id) ?? [],
        })),
        nextCursor: result.value.length === pageSize ? offset + pageSize : undefined,
      }
    }),

  /**
   * Every posting one record produced - the `ledger` card on an order, an
   * invoice, a payment or a journal entry.
   *
   * Reached through `GlPostingSource` (TARGET §1), never a stamp field and
   * never `GlPostingLine.sourceType`: one query, every link role. `sourceKind`
   * is a free string rather than an enum on purpose - it names the KIND of
   * record a posting is linked to and new kinds arrive with new builders, so an
   * enum here would have to be edited in lockstep with a vocabulary this router
   * does not own. There is nothing to leak - both halves are scoped to the
   * caller's organization in SQL.
   */
  listPostingsForSource: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ sourceKind: z.string().min(1), sourceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await listPostingsForSource(ctx.db, {
        organizationId: ctx.session.organizationId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The summarised view over the detail ledger (TARGET §6): posted postings grouped by avenue,
   * grain (`accounting.summaryGrain.*`, payout included), store, rail and currency; lines summed
   * by account and side (91 D9). Batched postings are not excluded here.
   */
  summary: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        from: z.iso.date({ error: 'from must be YYYY-MM-DD' }),
        to: z.iso.date({ error: 'to must be YYYY-MM-DD' }),
        avenue: z.enum(EXPORT_AVENUES).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const settings = await readExportSettings(organizationId)

      const result = await readLedgerSummary(ctx.db, {
        organizationId,
        from: input.from,
        to: input.to,
        avenue: input.avenue,
        grainByAvenue: settings.summaryGrain,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The Outbox's Blocked tab: parked accounting work grouped by
   * `(reasonCode, role, railId, glAccountId)`, newest write first (91 §4.6). With
   * `reasonCode`, one reason row's per-`externalRef` groups, largest first (106 §6.1).
   */
  listBlocked: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      outboxPage
        .extend({ categories: outboxCategories, reasonCode: z.string().min(1).optional() })
        .refine(validOutboxRange, outboxRangeError)
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const result = await listBlockedWork(ctx.db, organizationId, {
        reasonCode: input.reasonCode,
        limit: input.limit ?? OUTBOX_PAGE_SIZE,
        cursor: input.cursor,
        categories: input.categories,
        search: input.search,
        from: input.from,
        to: input.to,
        bookTimeZone: await readOutboxZone(organizationId, input),
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** One Blocked group expanded: its items, paged. */
  listBlockedItems: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      outboxPage
        .extend({ categories: outboxCategories, group: workItemGroup })
        .refine(validOutboxRange, outboxRangeError)
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const result = await listBlockedWorkItems(ctx.db, organizationId, input.group, {
        limit: input.limit ?? OUTBOX_PAGE_SIZE,
        cursor: input.cursor,
        categories: input.categories,
        search: input.search,
        from: input.from,
        to: input.to,
        bookTimeZone: await readOutboxZone(organizationId, input),
      })
      if (result.isErr()) throw result.error
      return {
        ...result.value,
        items: await withProviderEntryUrls(ctx.db, organizationId, result.value.items),
      }
    }),

  /**
   * Every Outbox tab's badge and the rail's total, counted in SQL - one dev org
   * holds ~1,100 blocked movements, so no badge rides on the rows. Blocked is a
   * `ledgerPost` read, so a member without it sees zero, matching the tab it is
   * not offered.
   */
  outboxCounts: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const canPost = ctx.capabilities.can(PermissionKey.ledgerPost)
    const [blocked, settings] = await Promise.all([
      canPost ? countBlockedWork(ctx.db, organizationId) : 0,
      readExportSettings(organizationId),
    ])
    // Summary mode counts summary rows per tab (95 §4); Ready already holds unbuilt and sending.
    if (settings.mode === 'summary') {
      const rows = await countSummaryRows(ctx.db, { organizationId })
      if (rows.isErr()) throw rows.error
      return { blocked, unbuilt: 0, ...rows.value, sending: 0 }
    }
    const [batches, unbuilt] = await Promise.all([
      countExportBatchesByState(ctx.db, organizationId),
      countUnbuiltSummaryRows(ctx.db, { organizationId }),
    ])
    return {
      blocked,
      /** Summary mode's groups Build has not made yet; they sit on Ready as rows. */
      unbuilt: unbuilt.isOk() ? unbuilt.value : 0,
      ready: batches.ready,
      sending: batches.sending,
      sent: batches.sent,
      failed: batches.failed,
    }
  }),

  /** One movement for the drawer, parked or posted, with its work items (83 §2.3). */
  getMovement: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ moneyTransactionId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      readMovementDetail(ctx.db, ctx.session.organizationId, input.moneyTransactionId)
    ),

  /** One shipment for the drawer, parked or posted, with its work items. */
  getShipment: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ fulfillmentId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      readShipmentDetail(ctx.db, ctx.session.organizationId, input.fulfillmentId)
    ),

  /**
   * Retry all: make a Blocked group, a whole reason (every row of the code, whatever the
   * filters), or one source's rows due now and return. The recovery job does the
   * posting, as release does for the outbox (91 §4.6).
   */
  retryBlockedGroup: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.union([
        z.object({ group: workItemGroup }),
        z.object({ reasonCode: z.string().min(1) }),
        z.object({
          source: z.object({ sourceKind: z.string().min(1), sourceId: z.string().min(1) }),
        }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      let woken: Awaited<ReturnType<typeof wakeSources>>
      if ('group' in input) woken = await wakeWorkItemGroup(ctx.db, organizationId, input.group)
      else if ('source' in input)
        woken = await wakeSources(ctx.db, organizationId, {
          sourceKind: input.source.sourceKind,
          sourceIds: [input.source.sourceId],
        })
      else if (isWorkItemCode(input.reasonCode))
        woken = await wakeReasonCode(ctx.db, organizationId, input.reasonCode)
      else throw new BadRequestError(`Unknown work item code '${input.reasonCode}'`)
      if (woken.isErr()) throw woken.error
      if (woken.value > 0) await requestAccountingRecovery(organizationId)
      return { woken: woken.value }
    }),

  /**
   * The newest posting of every type the organization has ever posted, one
   * row per type (brief 28 §3.2). The Posting settings page prints each
   * section's "Last posted" line from this; a type with no row has never
   * posted. One grouped read rather than a `listPostings` per section.
   */
  latestPostingsByType: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await readLatestPostingsByType(ctx.db, {
      organizationId: ctx.session.organizationId,
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * The journal-entry document and its `journal_entry_line` children (91 D5): a
   * document like a bill that is `draft` until Post builds the entry from its lines.
   * Reads and preview are `ledgerView`; every write is `ledgerPost`, because the
   * lines decide where real money lands. `journal_entry` is `isVisible: false`, so
   * this is its only door - `record.create` would hand it to records-Full, ledger-None.
   */
  journalEntry: createTRPCRouter({
    /** Create the record and its lines, `draft`. Empty or unbalanced saves; Post refuses. */
    create: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          // 🛑 No `recurring` here, deliberately. A generated entry is raised
          // by the daily sweep and by nothing else: it has to carry the rule
          // and the slot its posting is keyed on, and a person typing one by
          // hand would either omit them (refused) or claim a slot the sweep
          // would then raise a second entry for.
          kind: z.enum(['manual', 'opening_balance', 'recurring_template']).optional(),
          date: z.iso.date({ error: 'date must be YYYY-MM-DD' }),
          memo: z.string().max(4000).optional(),
          lines: z.array(journalEntryLine).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await createJournalEntry(ctx.db, organizationId, userId, input)
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Edit the document. `lines`, when present, is the full list after the edit: a
     * line naming a known `id` is kept and updated, one without is created, a saved
     * line left out is deleted; sort order is array position. Allowed while `draft`,
     * or `posted` with a `documentEdit` snapshot open; otherwise a `ConflictError`.
     */
    update: permissionProcedure(PermissionKey.ledgerPost)
      .input(
        z.object({
          id: z.string().min(1),
          date: z.iso.date({ error: 'date must be YYYY-MM-DD' }).optional(),
          /** An empty string CLEARS the memo; omitting the key leaves it alone. */
          memo: z.string().max(4000).optional(),
          lines: z.array(journalEntryLine).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const { id, ...values } = input
        const result = await updateJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: id,
          ...values,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /** One entry with its lines, or a `NotFoundError` for an id that is not this org's. */
    get: permissionProcedure(PermissionKey.ledgerView)
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const result = await getJournalEntry(ctx.db, ctx.session.organizationId, input.id)
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Entries newest first. `status: 'draft'` is every unposted document. ⚠️ `periodKey`
     * is the month of the entry's own date, not the posting's `periodKey` (its number).
     */
    list: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z
          .object({
            kinds: z
              .array(z.enum(['manual', 'opening_balance', 'recurring_template', 'recurring']))
              .min(1)
              .max(4)
              .optional(),
            status: z.enum(['draft', 'posted', 'reversed']).optional(),
            periodKey: z
              .string()
              .regex(/^\d{4}-\d{2}$/, 'periodKey must be a YYYY-MM month')
              .optional(),
            limit: z.number().int().positive().max(200).optional(),
            offset: z.number().int().nonnegative().optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const result = await listJournalEntries(ctx.db, ctx.session.organizationId, input ?? {})
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * What this entry WOULD post, with the on-screen values as overrides so the
     * drawer need not save first. Persists nothing; a `.mutation()` because the
     * lines are a request body.
     */
    preview: permissionProcedure(PermissionKey.ledgerView)
      .input(
        z.object({
          id: z.string().min(1),
          date: z.iso.date({ error: 'date must be YYYY-MM-DD' }).optional(),
          memo: z.string().max(4000).optional(),
          lines: z.array(journalEntryLine).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { id, ...overrides } = input
        const result = await previewJournalEntry(ctx.db, ctx.session.organizationId, {
          journalEntryId: id,
          ...overrides,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Build the entry from the stored lines, post it, and stamp the record's
     * pointer. Pre-ledger refusals (not a draft, unbalanced, a bad row) throw;
     * ledger outcomes return as the `PostResult` to render.
     */
    post: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1), memo: z.string().max(4000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await postJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: input.id,
          memo: input.memo,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Delete an unposted entry and its lines. The number is not reused. A posted
     * entry refuses with a `ConflictError` (409 via `auxxErrorMiddleware`).
     */
    discard: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await discardJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: input.id,
        })
        if (result.isErr()) throw result.error
        return { id: input.id, discarded: true }
      }),

    /**
     * Void: back the posted entry out with an opposite one; the record reads
     * `reversed`. Correcting it instead goes through `documentEdit` (open, update, save).
     */
    reverse: permissionProcedure(PermissionKey.ledgerPost)
      .input(z.object({ id: z.string().min(1), memo: z.string().max(4000).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { organizationId, userId } = ctx.session
        const result = await reverseJournalEntry(ctx.db, organizationId, userId, {
          journalEntryId: input.id,
          memo: input.memo,
        })
        if (result.isErr()) throw result.error
        return result.value
      }),
  }),

  /**
   * The SCHEDULE on a recurring journal template
   * (`plans/accounting/tasks/21-the-books-stand-alone.md` §1).
   *
   * The template is an ordinary `journalEntry` record (`kind: 'recurring_template'`)
   * written through the procedures above; this sub-router owns only its rule.
   * Each occurrence posts directly when the sweep materialises it (91 D5), so the
   * writes are `ledgerControl`, not `ledgerPost`: a schedule puts entries in the
   * books every month without anybody pressing anything, the authority
   * `setLockedThrough` takes.
   */
  recurringTemplate: createTRPCRouter({
    /**
     * Every template, its schedule, and what the next sweep owes.
     *
     * The plan comes from the same pure planner the sweep runs, so the screen
     * cannot disagree with the job about which month is being held.
     */
    list: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
      const result = await listRecurringJournalTemplates(ctx.db, ctx.session.organizationId)
      if (result.isErr()) throw result.error
      return result.value
    }),

    /**
     * Attach or replace a template's schedule.
     *
     * No `timezone` input: the rule stores the org's `accounting.bookTimeZone`
     * and nothing reads a zone from anywhere else. A browser-detected zone
     * would make two authorities out of the month boundary, and a December 31
     * entry would land in January for a template saved one zone east.
     */
    setSchedule: permissionProcedure(PermissionKey.ledgerControl)
      .use(notDemo('change a recurring journal schedule'))
      .input(
        z.object({
          templateId: z.string().min(1),
          pattern: recurrencePatternSchema,
          anchor: z.iso.date({ error: 'anchor must be YYYY-MM-DD' }).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await setRecurringJournalSchedule(ctx.db, ctx.session.organizationId, input)
        if (result.isErr()) throw result.error
        return result.value
      }),

    /**
     * Stop a template repeating. Entries it has already generated are
     * untouched - a schedule is configuration and the entries are what
     * happened.
     */
    clearSchedule: permissionProcedure(PermissionKey.ledgerControl)
      .use(notDemo('remove a recurring journal schedule'))
      .input(z.object({ templateId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await clearRecurringJournalSchedule(
          ctx.db,
          ctx.session.organizationId,
          input.templateId
        )
        if (result.isErr()) throw result.error
        return { ok: true }
      }),
  }),
})
