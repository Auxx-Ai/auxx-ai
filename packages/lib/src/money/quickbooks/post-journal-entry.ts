// packages/lib/src/money/quickbooks/post-journal-entry.ts
//
// Orchestrator CORE for posting one summary journal entry to the QuickBooks
// general ledger (plans/auxx-lift/gap-b-quickbooks-journal-entry.md §6).
//
// Shaped like `sync-invoice.ts`: invocation-agnostic, never throws, and keyed on
// an id-map field so re-runs converge instead of double-posting. The difference
// is what it is keyed ON — an invoice has a record of its own, a "2026-08-18
// daily fulfillment summary" does not, so the `gl_posting` entity WAS the record
// (entity-migration 103) and `qboJournalEntryId` hung on it. That is no longer
// true; see the block below.
//
// 🛑 LAYER 1 IS DANGLING AS OF 2026-08-28 — READ THIS BEFORE CALLING THIS FILE.
//
// The `gl_posting` EntityInstance def this file's PRIMARY idempotency layer maps
// onto **no longer exists**. Decision `G6` replaced it with the `GlPosting` /
// `GlPostingLine` Drizzle tables, and entity migration 114 removed the def from
// every organization. So `readQuickbooksIdField` / `writeQuickbooksIdField`
// below would now fail to resolve `gl_posting` at runtime.
//
// That was safe to do because this function has **no production caller** — only
// its own test file, which mocks both helpers — exactly the half-wired shape
// `sync-invoice.ts` is in. Nothing regressed; a defence that protected nothing
// stopped existing.
//
// The file is kept, not deleted, because layers 2-4 below are the valuable part
// and their reasoning is what the rewrite must preserve.
// **plans/money/tasks/10-the-poster.md** moves layer 1 onto the table's unique
// index (`INSERT … ON CONFLICT (organizationId, postingType, periodKey,
// revision) DO NOTHING`) and leaves layers 2-4 exactly as they are. Do not wire
// a caller to this file before that lands.
//
// ── Why four layers of idempotency ──────────────────────────────────────────
// A double-posted journal entry silently misstates the financial statements —
// there is no invoice or payment to reconcile it against, and nobody notices
// until a close does not tie out. So:
//
//   1. PRIMARY   the `gl_posting` id map. If an id is stored, do not post.
//                Authoritative, ours, no expiry.
//   2. SECONDARY deterministic `DocNumber` + query-before-insert. Catches the
//                case layer 1 cannot: a previous run posted and then crashed
//                before writing back. On a hit we HEAL the id map — we do not
//                post again. This is the single most valuable failure mode here.
//   3. INNERMOST `requestid` on the POST itself. Covers the race layers 1-2
//                share: read id-map (empty) → query (empty) → POST → timeout →
//                retry. Without it that retry double-posts even though both
//                checks were correct.
//   4. FORENSIC  a `PrivateNote` stamp, for a human reading the QBO register.
//                Never a lookup key — `PrivateNote` is not filterable.

import { createHash } from 'node:crypto'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { buildDocNumber as buildLedgerDocNumber } from '../../postings/doc-number'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import { readQuickbooksIdField, writeQuickbooksIdField } from './identity-field'
import { resolveQuickbooksContext } from './invoke-quickbooks-tool'

const logger = createScopedLogger('quickbooks-post-journal-entry')

const QBO_JOURNAL_ENTRY_ID_FIELD_KEY = 'qboJournalEntryId'
const GL_POSTING_ENTITY_TYPE = 'gl_posting'

/** QuickBooks caps `requestid` at 50 characters. */
const REQUEST_ID_MAX_LENGTH = 50

/**
 * The six posting types THIS adapter names.
 *
 * ⚠️ **This is a stale, narrower copy of `POSTING_TYPES`** — it is missing
 * `receipt` and `vendor_bill`, the two L3 per-event types the purchasing work
 * added. It dies in plans/money/tasks/10-the-poster.md, which rewrites this
 * file's layer 1 onto `GlPosting`'s unique index and takes `PostingType`
 * wholesale.
 *
 * 🛑 Do NOT "fix" it by adding the two missing values. Widening a duplicate
 * makes it a better duplicate; the point is that there is one vocabulary, in
 * `postings/types.ts`, and the file that owns the document number now imports
 * from it. This union has no production caller (see the header) so its narrowness
 * costs nothing until it is deleted.
 */
export type GlPostingTypeValue =
  | 'fulfillment'
  | 'payout'
  | 'build'
  | 'month_end_deferral'
  | 'month_end_reversal'
  | 'month_end_inventory'

export interface JournalLine {
  /** Integer MINOR units (cents). Always positive — direction is `postingType`. */
  amountMinor: number
  postingType: 'Debit' | 'Credit'
  accountId: string
  accountName?: string
  description?: string
  entity?: { type: 'Customer' | 'Vendor' | 'Employee'; id: string; name?: string }
}

export interface PostJournalEntryInput {
  organizationId: string
  /** The `gl_posting` EntityInstance id this posting is recorded on. */
  glPostingInstanceId: string
  postingType: GlPostingTypeValue
  /** '2026-08-18' for a daily entry, '2026-08' for a month-end one. */
  periodKey: string
  lines: JournalLine[]
  /** `YYYY-MM-DD`. Always set it explicitly — QBO defaults to its own server date. */
  txnDate: string
  actorUserId?: string
}

export interface PostJournalEntryResult {
  status: 'posted' | 'already_posted' | 'healed' | 'disabled' | 'not_connected' | 'error'
  qboJournalEntryId?: string
  docNumber?: string
  error?: string
  /** QuickBooks fault code when the failure carried one — '2300' is an imbalance. */
  faultCode?: string
}

/**
 * Build the deterministic document number. Same posting identity always yields
 * the same string, which is what makes layer 2 work at all.
 *
 * A thin adapter over `postings/doc-number.ts`, which now owns the keyspace: a
 * document number is written to `GlPosting.docNumber` whether or not a provider
 * exists, so it is ledger vocabulary rather than a QuickBooks detail. The
 * prefixes, the 21-character cap, the `-R<revision>` reversal suffix and the
 * build/payout key rules all live there.
 *
 * ⚠️ `revision` is not threaded through here because this adapter has no
 * production caller and no reversal path; task 10 replaces the call site with a
 * `GlPosting` row that carries its own revision.
 */
export function buildDocNumber(postingType: GlPostingTypeValue, periodKey: string): string {
  return buildLedgerDocNumber({ postingType, periodKey })
}

/**
 * Deterministic idempotency key for the POST itself.
 *
 * Derived from the posting identity, never random — a random key guarantees
 * nothing, because the retry would carry a different one. `glPostingInstanceId`
 * is in the hash so that a deliberately re-created posting row (a corrected
 * entry) is a genuinely different request rather than being swallowed as a
 * duplicate of the one it replaces.
 */
export function buildRequestId(input: {
  organizationId: string
  postingType: GlPostingTypeValue
  periodKey: string
  glPostingInstanceId: string
}): string {
  return createHash('sha256')
    .update(
      `${input.organizationId}:${input.postingType}:${input.periodKey}:${input.glPostingInstanceId}`
    )
    .digest('hex')
    .slice(0, REQUEST_ID_MAX_LENGTH)
}

/**
 * Post one summary journal entry to QuickBooks.
 *
 * Never throws — disabled, not-connected and every failure mid-chain resolve to
 * a typed `status`, so a BullMQ job or a tRPC mutation can persist the outcome
 * without its own try/catch.
 *
 * Returns `already_posted` when the id map already held an id (layer 1), and
 * `healed` when QuickBooks had the entry but our id map did not (layer 2) — the
 * caller should treat both as success and neither as a reason to retry.
 */
export async function postJournalEntry(
  input: PostJournalEntryInput
): Promise<PostJournalEntryResult> {
  const { organizationId, glPostingInstanceId, postingType, periodKey, lines, txnDate } = input
  const docNumber = buildDocNumber(postingType, periodKey)

  try {
    const enabled = await getOrganizationSetting({
      organizationId,
      key: 'quickbooks.postJournalEntries',
    })
    if (!enabled) return { status: 'disabled', docNumber }

    const resolved = await resolveQuickbooksContext({
      organizationId,
      actorUserId: input.actorUserId,
    })
    if (!resolved.connected) return { status: 'not_connected', docNumber }
    const ctx = resolved.context

    const handler = new UnifiedCrudHandler(organizationId, ctx.userId)
    const glPostingRecordId = toRecordId(GL_POSTING_ENTITY_TYPE, glPostingInstanceId)

    // ── Layer 1: the id map. Authoritative and ours. ────────────────────────
    const existingId = await readQuickbooksIdField({
      organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: QBO_JOURNAL_ENTRY_ID_FIELD_KEY,
      recordId: glPostingRecordId,
      handler,
    })
    if (existingId) {
      logger.info('GL posting already carries a QuickBooks id — not posting again', {
        organizationId,
        glPostingInstanceId,
        qboJournalEntryId: existingId,
      })
      return { status: 'already_posted', qboJournalEntryId: existingId, docNumber }
    }

    // ── Layer 2: query by DocNumber, and HEAL rather than re-post. ──────────
    // A hit here with an empty id map means a previous run posted and then died
    // before writing back. Posting again would duplicate the entry.
    const found = await ctx.callTool('find_quickbooks_journal_entry', { docNumber })
    const alreadyThere = found?.journalEntries?.[0]
    if (alreadyThere?.journalEntryId) {
      logger.warn('QuickBooks already holds this DocNumber — healing the id map, not re-posting', {
        organizationId,
        glPostingInstanceId,
        docNumber,
        qboJournalEntryId: alreadyThere.journalEntryId,
      })
      await writeQuickbooksIdField({
        organizationId,
        installationId: ctx.installationId,
        connectionId: ctx.connectionId,
        appFieldKey: QBO_JOURNAL_ENTRY_ID_FIELD_KEY,
        entityType: GL_POSTING_ENTITY_TYPE,
        entityInstanceId: glPostingInstanceId,
        externalId: String(alreadyThere.journalEntryId),
        userId: ctx.userId,
      })
      return {
        status: 'healed',
        qboJournalEntryId: String(alreadyThere.journalEntryId),
        docNumber,
      }
    }

    // ── Layer 3 (requestid) + layer 4 (the forensic note) ───────────────────
    const created = await ctx.callTool('create_quickbooks_journal_entry', {
      lines,
      txnDate,
      docNumber,
      privateNote: `auxx:gl:${postingType}:${periodKey}:${glPostingInstanceId}`,
      requestId: buildRequestId({
        organizationId,
        postingType,
        periodKey,
        glPostingInstanceId,
      }),
    })

    const qboJournalEntryId = created?.journalEntry?.journalEntryId
    if (!qboJournalEntryId) {
      return {
        status: 'error',
        docNumber,
        error: 'QuickBooks returned no journal entry id',
      }
    }

    await writeQuickbooksIdField({
      organizationId,
      installationId: ctx.installationId,
      connectionId: ctx.connectionId,
      appFieldKey: QBO_JOURNAL_ENTRY_ID_FIELD_KEY,
      entityType: GL_POSTING_ENTITY_TYPE,
      entityInstanceId: glPostingInstanceId,
      externalId: String(qboJournalEntryId),
      userId: ctx.userId,
    })

    logger.info('Journal entry posted', {
      organizationId,
      glPostingInstanceId,
      docNumber,
      qboJournalEntryId,
      lineCount: lines.length,
    })

    return { status: 'posted', qboJournalEntryId: String(qboJournalEntryId), docNumber }
  } catch (error) {
    // The QuickBooks fault code is kept because it is what separates a
    // retryable failure from a permanent one — '2300' (imbalance) will never
    // succeed on retry, a 5xx will.
    const faultCode =
      error && typeof error === 'object' && 'quickbooksFault' in error
        ? ((error as { quickbooksFault?: { code?: string | null } }).quickbooksFault?.code ??
          undefined)
        : undefined

    const message = error instanceof Error ? error.message : String(error)
    logger.error('Journal entry post failed', {
      organizationId,
      glPostingInstanceId,
      docNumber,
      faultCode,
      error: message,
    })
    return { status: 'error', docNumber, error: message, faultCode: faultCode ?? undefined }
  }
}
