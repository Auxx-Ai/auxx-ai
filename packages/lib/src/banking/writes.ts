// packages/lib/src/banking/writes.ts

/**
 * The two writes the bank accounts settings page needs: adding an account by
 * hand, and editing the handful of fields a person owns on one
 * (plans/accounting/ui-plan.md §2.7, HANDOFF slot 2I).
 *
 * Writes only; the reads live in `reads.ts`. No permission checks - the router
 * asserts `ledgerPost` (`docs/lib-module-guide.md` §6).
 *
 * ## What is deliberately NOT here
 *
 * **Connecting a bank.** That is `hosted-provision` plus a connector, and it
 * arrives with the bank feed wave. The router's `connect` procedure is a stub
 * that says so.
 *
 * ## Removal: four verbs, and one fact decides between two of them
 *
 * ⚠️ **This file used to say there was no delete and never would be. That is no
 * longer true**, and the reason it changed is written down in
 * `plans/bank-connection/08-removing-a-bank-account.md` §4.1 - read it before
 * treating {@link deleteBankAccount} as a mistake.
 *
 * | Verb | When | Effect |
 * |---|---|---|
 * | **Disconnect** | a connected account whose feed is no longer wanted | `feed/actions.ts`. Feed stops, account released at Stripe, every row kept |
 * | **Delete** | nothing on the account has EVER posted | account, rows, connector and the Stripe subscription all gone |
 * | **Archive** | anything else | `archivedAt` set. Out of every list and picker, history intact |
 * | **Restore** | an archived account | `archivedAt` cleared |
 *
 * 🛑 **The line is the first journal entry**, and it is recorded rather than
 * computed: `bank_account_has_posted` is a write-once high-water mark that
 * nothing clears (§5.1). `undoReview` nulls a line's posting id, so a gate that
 * read the rows would hand a delete back to an account that permanently changed
 * the ledger the moment somebody undid the last review - while the `GlPosting`
 * and its reversal both stay in the books.
 *
 * 🛑 **A hard delete is safe here in a way it is not for the chart**
 * (`postings/chart-write.ts:264`) because two of that module's three reasons do
 * not transfer: nothing seeds a user's bank accounts, so there is no re-seed to
 * defend against, and the `RecordIdentity` holding Stripe's `fca_` id is a STEP
 * (release first, §5.1) rather than a reason to refuse. Archive-as-default
 * survives; archive-ONLY does not - connecting the wrong bank pulls up to 180
 * days of transactions, and permanent debris plus 30c a month is not an
 * acceptable price for a misclick.
 *
 * 🛑 **Removing a bank account never touches the chart.** A `bank_account` is not
 * a GL account: it carries a POINTER to a code, and the balance lives in
 * `GlPosting` / `GlPostingLine` against that code with no foreign key back here
 * (§3). So archiving cannot move the trial balance by a cent, and the
 * Opening-Balance-Equity manoeuvre QuickBooks performs has nothing to do here.
 * "What happens to the money" is `removeChartAccount`'s question, not this one.
 */

import { deleteCredential } from '@auxx/credentials/store'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, ne } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { toRecordId } from '../resources/resource-id'
import {
  ARCHIVE_EXCLUSION_PREFIX,
  BANK_ACCOUNT_TYPES,
  type BankAccountRemovalFacts,
  type BankAccountRemovalPlan,
  type BankAccountRow,
  type BankAccountStatus,
  type BankAccountType,
  isArchiveExclusion,
} from './client'
// ⚠️ `./feed/actions` imports `updateBankAccount` from THIS file, so these two
// modules form a cycle. It is safe and deliberate: neither side touches the
// other at module scope, so the live binding is resolved when `archiveBankAccount`
// actually runs. The alternative is re-implementing disconnect's three effects
// here, and a second writer that forgot the Stripe release is the exact leak
// `feed/reaper.ts` exists to stop.
import { disconnectBankAccountFeed } from './feed/actions'
// The LEAF, not the `./feed` barrel: the barrel pulls the Stripe SDK, the
// connector engine and the org cache in to answer one join.
import { findBankFeedAccountForConnector, reapBankFeedAccount } from './feed/reaper'
import { guard } from './guard'
import {
  getBankAccount,
  readAccountLinesByStatus,
  readBankTransactionIdsForAccount,
  readRemovalFacts,
  requireBankAccountFieldContext,
} from './reads'
import { requireReviewFieldContext } from './review/reads'

const logger = createScopedLogger('banking')

/** What `createBankAccount` accepts. Every field is what a person typed. */
export interface CreateBankAccountInput {
  organizationId: string
  actorUserId: string
  name: string
  institution?: string | null
  last4?: string | null
  type?: BankAccountType
  currency?: string | null
  /** The `gl_account` instance id this account maps to (task 15 §4). Never a code. */
  glAccountId?: string | null
  feedStartDate?: string | null
}

/** What `updateBankAccount` accepts. Undefined means "leave it alone". */
export interface UpdateBankAccountInput {
  organizationId: string
  actorUserId: string
  bankAccountId: string
  name?: string
  institution?: string | null
  last4?: string | null
  type?: BankAccountType
  currency?: string | null
  /** The `gl_account` instance id this account maps to (task 15 §4). Never a code. */
  glAccountId?: string | null
  feedStartDate?: string | null
  status?: BankAccountStatus
}

/**
 * Add a bank account by hand - no connector, `status: 'manual'`.
 *
 * ⚠️ **A manual account is not a lesser one.** It is the only account type that
 * exists until the feed wave lands, it is what a customer whose institution
 * Stripe FC does not cover will always use, and it is the fallback when a live
 * feed throws `credentials_invalid` mid-close. It maps to the chart, holds
 * imported statement lines and reports coverage exactly as a connected one does;
 * the only difference is where the rows came from.
 *
 * 🛑 `connectorId` is left null and `status` is forced to `manual`, whatever the
 * caller passes. A record claiming a connector it does not have would render a
 * live status line for a feed that will never sync.
 */
export async function createBankAccount(
  db: Database,
  input: CreateBankAccountInput
): Promise<Result<BankAccountRow, Error>> {
  const { organizationId, actorUserId } = input
  return guard(
    async () => {
      const ctx = await requireBankAccountFieldContext(organizationId)

      const name = input.name?.trim()
      if (!name) {
        throw new BadRequestError('A bank account needs a name')
      }
      const type = input.type ?? 'depository'
      if (!BANK_ACCOUNT_TYPES.includes(type)) {
        throw new BadRequestError(
          `"${type}" is not a bank account type. Use ${BANK_ACCOUNT_TYPES.join(' or ')}`
        )
      }
      const last4 = normalizeLast4(input.last4)

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const created = await crud.create(ctx.bankAccountDefId, {
        bank_account_name: name,
        bank_account_institution: input.institution?.trim() || undefined,
        bank_account_last4: last4 ?? undefined,
        bank_account_type: type,
        bank_account_currency: input.currency?.trim().toUpperCase() || 'USD',
        bank_account_gl_account: input.glAccountId?.trim() || undefined,
        bank_account_feed_start_date: input.feedStartDate || undefined,
        bank_account_status: 'manual',
      })

      const row = await getBankAccount(db, {
        organizationId,
        bankAccountId: created.instance.id,
      })
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The bank account could not be read back after writing')
      }

      logger.info('Created a manual bank account', {
        organizationId,
        bankAccountId: created.instance.id,
        type,
      })
      return row.value
    },
    'Failed to create bank account',
    { organizationId }
  )
}

/**
 * Edit a bank account.
 *
 * 🛑 **The connector-owned identity fields are refused on a CONNECTED account.**
 * `name`, `institution`, `last4`, `type` and `currency` are what the bank said,
 * and the feed rewrites them on every sync - accepting an edit would produce a
 * change that silently reverts, which is worse than a refusal. On a manual
 * account they are the only source there is, so they are editable.
 *
 * `glAccount`, `feedStartDate` and `status` are always auxx's and always
 * editable. Mapping an account to a `gl_account` is the whole point of the
 * entity, and a connected account is exactly the one that most needs mapping.
 *
 * ⚠️ `glAccountId` is NOT validated against the org's chart here. The router
 * hands down an id the `GlAccountPicker` sourced from `ledger.chartAccounts`,
 * and `resolveAccountLines`/the review-queue readers refuse an unknown, archived
 * or wrongly-typed id at read time with a sentence naming the account - which is
 * the message worth surfacing. A second authority here would drift from it.
 */
export async function updateBankAccount(
  db: Database,
  input: UpdateBankAccountInput
): Promise<Result<BankAccountRow, Error>> {
  const { organizationId, actorUserId, bankAccountId } = input
  return guard(
    async () => {
      const ctx = await requireBankAccountFieldContext(organizationId)

      const existing = await getBankAccount(db, { organizationId, bankAccountId })
      if (existing.isErr()) throw existing.error
      if (!existing.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const isConnected = existing.value.connectorId != null
      const patch: Record<string, unknown> = {}

      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name) throw new BadRequestError('A bank account needs a name')
        refuseWhenConnected(isConnected, 'name')
        patch.bank_account_name = name
      }
      if (input.institution !== undefined) {
        refuseWhenConnected(isConnected, 'institution')
        patch.bank_account_institution = input.institution?.trim() || null
      }
      if (input.last4 !== undefined) {
        refuseWhenConnected(isConnected, 'last four')
        patch.bank_account_last4 = normalizeLast4(input.last4)
      }
      if (input.type !== undefined) {
        if (!BANK_ACCOUNT_TYPES.includes(input.type)) {
          throw new BadRequestError(
            `"${input.type}" is not a bank account type. Use ${BANK_ACCOUNT_TYPES.join(' or ')}`
          )
        }
        refuseWhenConnected(isConnected, 'type')
        patch.bank_account_type = input.type
      }
      if (input.currency !== undefined) {
        refuseWhenConnected(isConnected, 'currency')
        patch.bank_account_currency = input.currency?.trim().toUpperCase() || null
      }

      if (input.glAccountId !== undefined) {
        patch.bank_account_gl_account = input.glAccountId?.trim() || null
      }
      if (input.feedStartDate !== undefined) {
        patch.bank_account_feed_start_date = input.feedStartDate || null
      }
      if (input.status !== undefined) {
        patch.bank_account_status = input.status
      }

      if (Object.keys(patch).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
        await crud.update(toRecordId(ctx.bankAccountDefId, bankAccountId), patch)
      }

      const row = await getBankAccount(db, { organizationId, bankAccountId })
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The bank account could not be read back after writing')
      }

      logger.info('Updated a bank account', {
        organizationId,
        bankAccountId,
        fields: Object.keys(patch),
      })
      return row.value
    },
    'Failed to update bank account',
    { organizationId, bankAccountId }
  )
}

/** The refusal a connector-owned field earns on a connected account. */
function refuseWhenConnected(isConnected: boolean, label: string): void {
  if (!isConnected) return
  throw new BadRequestError(
    `The ${label} of a connected account comes from the bank and cannot be edited here. ` +
      'Disconnect the account first, or correct it at your bank.'
  )
}

/**
 * The last four digits, as TEXT.
 *
 * Kept as a string and never parsed: a leading zero is part of the account, and
 * `0381` read as a number and rendered back is `381`, which matches nothing.
 * Anything but digits is refused rather than stripped, because silently turning
 * `**5381` into `5381` hides a paste error that will not match the statement.
 */
function normalizeLast4(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!/^\d{1,4}$/.test(trimmed)) {
    throw new BadRequestError('The last four is up to four digits, with nothing else in it')
  }
  return trimmed
}

// ── Removal: the gate, and the three verbs behind it ────────────────────────

/**
 * Which verb applies to this account. **Pure, and no database.**
 *
 * 🛑 **ONE term decides: `hasEverPosted`.** False deletes, true archives. Every
 * other fact on {@link BankAccountRemovalFacts} is for the confirm dialog and is
 * forbidden from changing the answer - 400 rows in `for_review`, a live
 * connector and three rules naming the account are all deletable, because
 * nothing on the account reached the books
 * (plans/bank-connection/08-removing-a-bank-account.md §5.1).
 *
 * ⚠️ **A `matched` row is deletable, and that is a real decision.** A match says
 * a document we already posted really cleared, so deleting it removes that
 * evidence while the document's own entry stays in the books. It is still the
 * right answer: the alternative is that one auto-detected transfer match makes a
 * wrongly-connected account permanently undeletable, and a match is evidence
 * *about* an entry, never the entry itself. The dialog names the count.
 *
 * ⚠️ **A `bank_rule` is a WARNING, never a blocker.** `rules/evaluate.ts` skips a
 * rule whose `bankAccountId` does not match the line, so a dangling scope makes
 * the rule INERT rather than universal - silently dead, not silently dangerous.
 *
 * ⚠️ **A `bank_deposit` needs no term of its own.** A posted deposit debits this
 * account's chart mapping and names this account as where the money went, so
 * `createBankDeposit` stamps `bank_account_has_posted` the same way a posted
 * bank line does (`money/bank-deposits/writes.ts`). It reaches the gate through
 * the one term rather than beside it, which is why §5.1's "ONE term decides"
 * still holds after entity migration 135 gave the deposit a real relationship to
 * the account.
 *
 * Exported and pure so the gate is tested without a database, exactly the way
 * `import/reverse.ts`'s `refusalReason` is.
 */
export function resolveRemoval(facts: BankAccountRemovalFacts): BankAccountRemovalPlan {
  const verb = facts.hasEverPosted ? 'archive' : 'delete'
  return {
    verb,
    cascade:
      verb === 'delete'
        ? {
            transactions: facts.transactionCount,
            matched: facts.matchedCount,
            releasesAtStripe: facts.connectorId != null,
          }
        : // An archive destroys nothing, so there is no cascade to name. Filling
          // these in for an archive would put "1,240 transactions will be
          // deleted" in front of somebody about to archive.
          { transactions: 0, matched: 0, releasesAtStripe: facts.connectorId != null },
    unreviewed: facts.unreviewedCount,
    warnings: facts.rules,
  }
}

/** What `deleteBankAccount` accepts. */
export interface DeleteBankAccountInput {
  organizationId: string
  actorUserId: string
  bankAccountId: string
}

/** What `deleteBankAccount` did. */
export interface DeleteBankAccountResult {
  id: string
  /** Every `bank_transaction` on the account, whatever its review status. */
  transactionsDeleted: number
  connectorDeleted: boolean
  /** True when Stripe confirmed the release, so the 30c a month stops. */
  releasedAtStripe: boolean
  /** True when the bank LOGIN this was the last account on went with it. */
  credentialDeleted: boolean
}

/**
 * A real, permanent delete. Only reachable while nothing on the account has ever
 * posted (§5.1) - {@link resolveRemoval} is re-asked here rather than trusted
 * from the caller, because a sync can land a transaction between a preview and
 * the click that follows it.
 *
 * 🛑 **Stripe first, and outside everything else.** The release is the only thing
 * that stops the 30c per institution per month, and the ordering is the same one
 * `deleteOrganization` states for the plan subscription: failing the delete after
 * a release is recoverable - reconnecting is a fresh authentication either way -
 * and deleting first then failing the release is not, because the
 * `providerAccountId` we would need is on the row we just destroyed and the
 * nightly reaper sweeps `DataConnector` rows that still EXIST.
 *
 * Then, in order:
 *
 * 1. the `DataConnector` (its streams and mappings cascade with it);
 * 2. its credential, but ONLY when no other connector still uses it - one
 *    credential is one bank LOGIN, and two accounts at the same bank share it,
 *    so an unconditional delete would break the sibling account's feed;
 * 3. every `bank_transaction` on the account, whatever its review status;
 * 4. the account itself. The `RecordIdentity` carrying Stripe's `fca_` id
 *    cascades off `EntityInstance`.
 *
 * ⚠️ **Not one Postgres transaction**, and deliberately: `UnifiedCrudHandler`
 * opens its own write session per call, which is also how `import/reverse.ts`
 * deletes a batch. The order above is what makes a partial failure recoverable -
 * the account is destroyed last, so anything that dies half way leaves a row the
 * operator can press Remove on again.
 */
export async function deleteBankAccount(
  db: Database,
  input: DeleteBankAccountInput
): Promise<Result<DeleteBankAccountResult, Error>> {
  const { organizationId, actorUserId, bankAccountId } = input
  return guard(
    async () => {
      const ctx = await requireBankAccountFieldContext(organizationId)
      const account = await getBankAccount(db, { organizationId, bankAccountId })
      if (account.isErr()) throw account.error
      if (!account.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const facts = await readRemovalFacts(db, { organizationId, bankAccountId })
      if (facts.isErr()) throw facts.error
      if (resolveRemoval(facts.value).verb !== 'delete') {
        throw new ConflictError(
          'A line on this account has produced a journal entry, so the account can only be ' +
            'archived. The entry and any reversal of it stay in the books, and the row they ' +
            'were posted from is their source document.',
          { verb: 'archive' }
        )
      }

      // 1. Stripe, first and on its own.
      let releasedAtStripe = false
      const connectorId = account.value.connectorId
      let credentialId: string | null = null
      if (connectorId) {
        const feedAccount = await findBankFeedAccountForConnector(db, organizationId, connectorId)
        if (feedAccount) {
          credentialId = feedAccount.credentialId
          // Throws on a Stripe failure, and the throw is the point: nothing below
          // has run yet, so the account is still whole and still retryable.
          releasedAtStripe = await reapBankFeedAccount(db, {
            connectorId,
            providerAccountId: feedAccount.providerAccountId,
          })
        }
      }

      // 2. The connector, then the credential when nothing else holds it.
      let connectorDeleted = false
      let credentialDeleted = false
      if (connectorId) {
        const deleted = await db
          .delete(schema.DataConnector)
          .where(
            and(
              eq(schema.DataConnector.id, connectorId),
              eq(schema.DataConnector.organizationId, organizationId)
            )
          )
          .returning({ id: schema.DataConnector.id })
        connectorDeleted = deleted.length > 0

        if (credentialId) {
          // 🛑 One credential is one bank LOGIN. Two accounts under one login
          // share it, so deleting it while a sibling connector still points at
          // it would take that account's feed down as a side effect of removing
          // this one.
          const siblings = await db
            .select({ id: schema.DataConnector.id })
            .from(schema.DataConnector)
            .where(
              and(
                eq(schema.DataConnector.credentialId, credentialId),
                ne(schema.DataConnector.id, connectorId)
              )
            )
            .limit(1)
          if (siblings.length === 0) {
            const removed = await deleteCredential(credentialId, organizationId)
            credentialDeleted = removed.isOk()
          }
        }
      }

      // 3. Every line on the account, whatever it says and whether or not it is
      //    archived. Nothing here reached the books - that is what the gate above
      //    just established - and an archived line left behind would point at an
      //    `EntityInstance` that no longer exists, with no foreign key to clean
      //    it up.
      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const lines = await readBankTransactionIdsForAccount(db, { organizationId, bankAccountId })
      if (lines.isErr()) throw lines.error
      // 🛑 `bulkDelete`, not a loop. Every single-record method wraps itself in
      // `inWriteSession` and runs its own `assertEditRows` + cache warm, so a
      // per-row loop over a wrongly-connected account's 2,390 lines opened 2,390
      // write sessions inside one request. The bulk call does all three once.
      if (lines.value.ids.length > 0) {
        const result = await crud.bulkDelete(
          lines.value.ids.map((id) => toRecordId(lines.value.bankTransactionDefId, id))
        )
        if (result.errors.length > 0) {
          // Refusing loudly beats deleting the account over the top of lines that
          // would not go: the leftovers would point at an `EntityInstance` that no
          // longer exists, with no foreign key to find them by.
          throw new ConflictError(
            `${result.errors.length} of ${lines.value.ids.length} bank transactions could not be deleted, so the account was kept. First: ${result.errors[0]?.message ?? 'unknown'}`
          )
        }
      }

      // 4. The account. Its `RecordIdentity` rows cascade off `EntityInstance`.
      await crud.delete(toRecordId(ctx.bankAccountDefId, bankAccountId))

      logger.info('Deleted a bank account', {
        organizationId,
        bankAccountId,
        transactionsDeleted: lines.value.ids.length,
        connectorDeleted,
        releasedAtStripe,
      })
      return {
        id: bankAccountId,
        transactionsDeleted: lines.value.ids.length,
        connectorDeleted,
        releasedAtStripe,
        credentialDeleted,
      } satisfies DeleteBankAccountResult
    },
    'Failed to delete bank account',
    { organizationId, bankAccountId }
  )
}

/** What `archiveBankAccount` accepts. */
export interface ArchiveBankAccountInput {
  organizationId: string
  actorUserId: string
  bankAccountId: string
}

/** What `archiveBankAccount` did, so the confirmation can say it. */
export interface ArchiveBankAccountResult {
  id: string
  /** `for_review` and `suggested` lines swept to `excluded` (§6). */
  excluded: number
  /** True when a live feed was stopped and released at Stripe first. */
  disconnected: boolean
}

/**
 * Take the account out of every list and picker, keeping its history whole.
 *
 * ## What it does
 *
 * 1. **Disconnects first, when there is a feed.** 🛑 Not optional and not
 *    skippable: `reapBankFeedAccount` is the only thing that stops the 30c per
 *    month, so archiving a still-billing account out of the UI would recreate
 *    precisely the silent leak `feed/reaper.ts` was built to stop. It happens in
 *    one action rather than as a refusal, with the consequence spelled out in the
 *    confirm dialog, because the extra sentence is cheaper than the leak (§10 q3).
 * 2. **Sweeps the unreviewed queue to `excluded`** with a machine-recognisable
 *    reason (§6, option C). Those rows are cash movements that never reached the
 *    ledger and that nobody will look at again; refusing until the queue is empty
 *    leaves an org that connected the wrong bank unable to clear 180 days of
 *    noise, and discarding them silently destroys evidence with no trace.
 * 3. **Sets `archivedAt`.**
 *
 * ## 🛑 What it must NOT do (§5.3)
 *
 * - never touches the mapped `gl_account`;
 * - never touches any `GlPosting`;
 * - never deletes or modifies a `bank_transaction` other than step 2's
 *   exclusions - `matched`, `coded` and human-`excluded` rows come out
 *   byte-identical;
 * - never clears `bank_account_coverage_from`. A balance sheet spanning the
 *   archived account's period still has to know what was covered.
 *
 * There is no balance check, no posting check and no period check either, and
 * §3 is why: a `bank_account` holds a POINTER to a GL code, so none of them can
 * be affected by this write.
 */
export async function archiveBankAccount(
  db: Database,
  input: ArchiveBankAccountInput
): Promise<Result<ArchiveBankAccountResult, Error>> {
  const { organizationId, actorUserId, bankAccountId } = input
  return guard(
    async () => {
      const ctx = await requireBankAccountFieldContext(organizationId)
      // Read the archived row too, so archiving one twice refuses with a sentence
      // that says so rather than a 404 on a record the caller is looking at.
      const account = await getBankAccount(db, {
        organizationId,
        bankAccountId,
        includeArchived: true,
      })
      if (account.isErr()) throw account.error
      if (!account.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }
      if (account.value.archivedAt) {
        throw new ConflictError('That bank account is already archived.')
      }

      let disconnected = false
      if (account.value.connectorId) {
        const stopped = await disconnectBankAccountFeed(db, {
          organizationId,
          actorUserId,
          bankAccountId,
        })
        if (stopped.isErr()) throw stopped.error
        disconnected = true
      }

      const excluded = await excludeUnreviewedLines(db, {
        organizationId,
        actorUserId,
        bankAccountId,
        accountLabel: account.value.name ?? 'this account',
      })

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.archive(toRecordId(ctx.bankAccountDefId, bankAccountId))

      logger.info('Archived a bank account', {
        organizationId,
        bankAccountId,
        excluded,
        disconnected,
      })
      return { id: bankAccountId, excluded, disconnected } satisfies ArchiveBankAccountResult
    },
    'Failed to archive bank account',
    { organizationId, bankAccountId }
  )
}

/**
 * Sweep `for_review` and `suggested` to `excluded`, and touch nothing else.
 *
 * ⚠️ **`matched`, `coded` and human-`excluded` rows are left alone**, and the
 * narrowing is done in the query rather than by filtering afterwards. They are
 * already in the books, or they carry a decision somebody made and the reason
 * they were required to give for it.
 *
 * 🛑 **Uncapped, and one write.** This used to page `listForReview` (which clamps
 * at 500) and then `crud.update` per row, so an archive swept at most 1,000 of
 * however many the account had and opened a write session for each. The rest
 * stayed in the For Review queue under an account nobody could see any more
 * (plans/bank-connection/08-removing-a-bank-account.md §6.1). The cap existed to
 * bound a per-row loop; with `bulkUpdate` there is nothing to bound.
 *
 * The reason is prefixed so a later path can tell an archive's own bookkeeping
 * from a person's - the same job `IMPORT_LINK_EXCLUSION_PREFIX` does for the
 * importer's link exclusions.
 */
async function excludeUnreviewedLines(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    bankAccountId: string
    accountLabel: string
  }
): Promise<number> {
  const { organizationId, actorUserId, bankAccountId, accountLabel } = params
  const ctx = await requireReviewFieldContext(organizationId)

  const pending = await readAccountLinesByStatus(db, {
    organizationId,
    bankAccountId,
    statuses: ['for_review', 'suggested'],
  })
  if (pending.isErr()) throw pending.error
  if (pending.value.lines.length === 0) return 0

  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  const reason = `${ARCHIVE_EXCLUSION_PREFIX}: ${accountLabel}`
  const reviewedAt = new Date().toISOString()

  const result = await crud.bulkUpdate(
    pending.value.lines.map((line) => ({
      recordId: toRecordId(ctx.bankTransactionDefId, line.id),
      values: {
        bank_transaction_review_status: 'excluded',
        bank_transaction_exclude_reason: reason,
        bank_transaction_reviewed_at: reviewedAt,
        bank_transaction_reviewed_by_user_id: actorUserId,
      },
    }))
  )
  if (result.errors.length > 0) {
    logger.warn('Some lines could not be excluded while archiving a bank account', {
      organizationId,
      bankAccountId,
      failed: result.errors.length,
    })
  }
  return result.updated
}

/**
 * Put the archive's own exclusions back to `for_review`, and only those.
 *
 * The mirror of {@link excludeUnreviewedLines}. It reads the account's `excluded`
 * lines and re-opens the ones {@link isArchiveExclusion} recognises, so a row a
 * person excluded by hand - and the reason they were required to give for it -
 * survives a restore untouched.
 */
async function reopenArchiveExclusions(
  db: Database,
  params: { organizationId: string; actorUserId: string; bankAccountId: string }
): Promise<number> {
  const { organizationId, actorUserId, bankAccountId } = params
  const ctx = await requireReviewFieldContext(organizationId)

  const excluded = await readAccountLinesByStatus(db, {
    organizationId,
    bankAccountId,
    statuses: ['excluded'],
  })
  if (excluded.isErr()) throw excluded.error

  const mine = excluded.value.lines.filter((line) => isArchiveExclusion(line.excludeReason))
  if (mine.length === 0) return 0

  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  const result = await crud.bulkUpdate(
    mine.map((line) => ({
      recordId: toRecordId(ctx.bankTransactionDefId, line.id),
      values: {
        bank_transaction_review_status: 'for_review',
        bank_transaction_exclude_reason: null,
        bank_transaction_reviewed_at: null,
        bank_transaction_reviewed_by_user_id: null,
      },
    }))
  )
  return result.updated
}

/** What `restoreBankAccount` accepts. */
export interface RestoreBankAccountInput {
  organizationId: string
  actorUserId: string
  bankAccountId: string
}

/**
 * Put an archived account back.
 *
 * 🛑 **Restore is not optional.** Archive is only a safe default if it is
 * reversible in the product; without this, "Archive" is a hard delete with a
 * nicer word on it (§4.2).
 *
 * ⚠️ It does NOT reconnect the feed. The connector was released at Stripe, so
 * the only way back to a live feed is a fresh authentication at the bank.
 *
 * 🛑 **It DOES un-exclude the lines the archive swept**, and only those: the ones
 * whose reason still carries {@link ARCHIVE_EXCLUSION_PREFIX}. Three reasons, and
 * the first is the load-bearing one:
 *
 *  1. Reversibility is the whole argument for sweeping the queue rather than
 *     refusing the archive (plan §6). "Undo it one row at a time in the queue" is
 *     not a path for the 400-row account this feature exists to clean up, so
 *     without this, archive is one-way in practice and the argument collapses.
 *  2. These exclusions are the archive's OWN bookkeeping, not a person's. The
 *     precedent is `isImportLinkExclusion` in `import/reverse.ts`: a
 *     machine-written exclusion belongs to the operation that wrote it and is
 *     reversed with it, while a human one is never touched by either path.
 *  3. A row a person excluded by hand keeps its reason and stays excluded,
 *     because {@link isArchiveExclusion} is false for it. The surprising restore
 *     would be the one that re-opened those.
 */
export async function restoreBankAccount(
  db: Database,
  input: RestoreBankAccountInput
): Promise<Result<BankAccountRow, Error>> {
  const { organizationId, actorUserId, bankAccountId } = input
  return guard(
    async () => {
      const ctx = await requireBankAccountFieldContext(organizationId)
      const existing = await getBankAccount(db, {
        organizationId,
        bankAccountId,
        includeArchived: true,
      })
      if (existing.isErr()) throw existing.error
      if (!existing.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }
      if (!existing.value.archivedAt) {
        throw new BadRequestError('That bank account is not archived.')
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.restore(toRecordId(ctx.bankAccountDefId, bankAccountId))

      const reopened = await reopenArchiveExclusions(db, {
        organizationId,
        actorUserId,
        bankAccountId,
      })

      const row = await getBankAccount(db, { organizationId, bankAccountId })
      if (row.isErr()) throw row.error
      if (!row.value) {
        throw new NotFoundError('The bank account could not be read back after restoring')
      }

      logger.info('Restored a bank account', { organizationId, bankAccountId, reopened })
      return row.value
    },
    'Failed to restore bank account',
    { organizationId, bankAccountId }
  )
}
