// packages/lib/src/postings/read-register.ts
//
// The register read (plans/accounting/tasks/53-two-modes-one-ledger.md §7.3,
// decision D16): the member effects behind ONE summary posting.
//
// 🔑 **Nothing is built here. Everything is read back.** `AccountingEffect`
// already carries one balanced, account-resolved `contribution[]` per accepted
// transaction, hashed and immutable, and `AccountingEffect.glPostingId` already
// names the summary it rolled into. The register Synder puts on a second page
// is a join we have never run. The projection is `register.ts`; this file is
// three queries and a map.
//
// 🛑 **Level B is not taken.** These contributions are NOT written as
// `GlPosting`/`GlPostingLine` rows. A derived register in the trial balance
// double-counts every summary it rolls into and both sides still balance, so
// nothing detects it (§7.3.2). This file is read-only and must stay that way:
// a register row is a projection of a frozen, hashed basis, and the correction
// path is `operation: 'correction'` on `AccountingWork`, which already exists.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, NotFoundError } from '../errors'
import {
  type PostingRegister,
  projectRegisterEntry,
  type RegisterAccountLabel,
  registerTotalMinor,
} from './register'

const logger = createScopedLogger('postings:read-register')

/**
 * Every member effect of one summary posting, oldest accounting date first.
 *
 * ⚠️ **An empty `entries` is a real answer and the caller must render it as
 * one.** §7.3.3 splits the twenty `GlPostingType` values in two: seven
 * transaction-driven families gain an `AccountingWork` under D19, and seven more
 * have no upstream transaction at all - a manual journal, an opening balance, a
 * `provider_sync` row authored in the provider. For those the posting IS the
 * register row, 1:1, and there is nothing to expand. The register is the UNION
 * of per-transaction effects and standalone postings, so this read is written to
 * gain rows as families land and to say "none" without implying "missing".
 *
 * Returns `NotFoundError` for a posting that does not exist AND for one
 * belonging to another organization - deliberately indistinguishable, the rule
 * `getPosting` keeps.
 *
 * Three queries, never N+1: the summary header, its lines (for the frozen
 * account labels), then every effect joined to its work.
 *
 * @param db a `Database` or a transaction handle - this is a plain read.
 * @param organizationId the scope. Every query filters on it.
 * @param glPostingId the summary whose members are wanted.
 */
export async function readPostingRegister(
  db: Database,
  organizationId: string,
  glPostingId: string
): Promise<Result<PostingRegister, Error>> {
  try {
    const [posting] = await db
      .select({
        id: schema.GlPosting.id,
        currency: schema.GlPosting.currency,
        totalMinor: schema.GlPosting.totalMinor,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.id, glPostingId)
        )
      )
      .limit(1)

    if (!posting) {
      return err(new NotFoundError('Posting not found', { glPostingId, organizationId }))
    }

    // The account code and name as they stood WHEN THE SUMMARY POSTED. Borrowed
    // from the summary's own lines rather than joined to `gl_account`, for the
    // reason `read-posting.ts` spells out: joining the live chart silently
    // restates history the moment somebody renames an account. A contribution
    // and the summary line it rolls into always share a `glAccountId` -
    // `assertExactContributions` refuses an acceptance where they do not.
    const lineRows = await db
      .select({
        glAccountId: schema.GlPostingLine.glAccountId,
        accountCode: schema.GlPostingLine.accountCode,
        accountName: schema.GlPostingLine.accountName,
      })
      .from(schema.GlPostingLine)
      .where(
        and(
          eq(schema.GlPostingLine.organizationId, organizationId),
          eq(schema.GlPostingLine.glPostingId, glPostingId)
        )
      )

    const accountLabels = new Map<string, RegisterAccountLabel>()
    for (const line of lineRows) {
      if (accountLabels.has(line.glAccountId)) continue
      accountLabels.set(line.glAccountId, {
        accountCode: line.accountCode ?? null,
        accountName: line.accountName ?? null,
      })
    }

    // `AccountingEffect_posting_idx` is `(organizationId, glPostingId)` and
    // carries this read. The join to `AccountingWork` is what turns an effect
    // into a register ROW - the effect knows its basis, the work knows what kind
    // of transaction it was and whether it is an original or a correction.
    const effectRows = await db
      .select({
        effectId: schema.AccountingEffect.id,
        workId: schema.AccountingEffect.workId,
        basisVersion: schema.AccountingEffect.basisVersion,
        basisHash: schema.AccountingEffect.basisHash,
        effectiveDate: schema.AccountingEffect.effectiveDate,
        currency: schema.AccountingEffect.currency,
        acceptedBasis: schema.AccountingEffect.acceptedBasis,
        effectKind: schema.AccountingWork.effectKind,
        effectKey: schema.AccountingWork.effectKey,
        operation: schema.AccountingWork.operation,
        componentKey: schema.AccountingWork.componentKey,
      })
      .from(schema.AccountingEffect)
      .innerJoin(
        schema.AccountingWork,
        and(
          eq(schema.AccountingWork.organizationId, schema.AccountingEffect.organizationId),
          eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
        )
      )
      .where(
        and(
          eq(schema.AccountingEffect.organizationId, organizationId),
          eq(schema.AccountingEffect.glPostingId, glPostingId)
        )
      )
      // The accounting date first, then the effect key, so the order is stable
      // across reads. `createdAt` would order by when we LEARNED of the
      // transaction, which is the late-arrivals question, not this one.
      .orderBy(asc(schema.AccountingEffect.effectiveDate), asc(schema.AccountingWork.effectKey))

    const entries = effectRows.map((row) =>
      projectRegisterEntry(
        {
          effectId: row.effectId,
          workId: row.workId,
          effectKind: row.effectKind,
          effectKey: row.effectKey,
          operation: row.operation,
          componentKey: row.componentKey,
          basisVersion: row.basisVersion,
          basisHash: row.basisHash,
          effectiveDate: toDateKey(row.effectiveDate),
          currency: row.currency,
          acceptedBasis: row.acceptedBasis,
        },
        accountLabels
      )
    )

    return ok({
      glPostingId: posting.id,
      currency: posting.currency,
      // The summary's own recorded total, never a sum of the members. The whole
      // point of showing both is that a reader can see them agree.
      postingTotalMinor: toMinor(posting.totalMinor),
      entries,
      totalMinor: registerTotalMinor(entries),
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the posting register', { error, organizationId, glPostingId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Keep a Postgres `date` as `YYYY-MM-DD`.
 *
 * Same reasoning as `read-posting.ts`'s copy: the accounting date must never
 * acquire a time and a zone on its way to a browser, because
 * `new Date('2026-08-31')` read west of Greenwich renders as August 30 and a
 * register row dated the previous month is unarguable to a bookkeeper.
 */
function toDateKey(value: Date | string): string {
  if (typeof value === 'string') return value
  return value.toISOString().slice(0, 10)
}

/** Coerce a `bigint`-backed amount to integer minor units. See `read-posting.ts`. */
function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}
