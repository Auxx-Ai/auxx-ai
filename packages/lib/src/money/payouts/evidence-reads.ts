// packages/lib/src/money/payouts/evidence-reads.ts
import { type Database, schema } from '@auxx/database'
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { BadRequestError, ConflictError } from '../../errors'
import { exactEvidenceMinor } from '../customer-money/evidence-contracts'
import { payoutRecordEvidenceSchema } from '../customer-money/record-contracts'
import { matchProcessorEntries } from './match-entries'

type PageInput = { organizationId: string; limit: number; cursor?: string }
/**
 * Optional narrowing for the payout evidence list. Every filter is an extra
 * `WHERE` term on the same keyset page, so paging is unaffected by them.
 *
 * ⚠️ No amount range, deliberately. `MoneyTransfer` carries a per-row
 * `sourceCurrency` and `sourceCurrencyExponent`, so a single min/max across the
 * list would compare 100 JPY against 100 USD against 100 EUR. The bank review
 * queue can offer one only because it is pinned to a single display currency.
 */
type EvidenceFilters = {
  /** `MoneyTransfer.externalId`, case-insensitive contains. Trimmed; blank is unset. */
  search?: string
  /** `FinancialSourceAccount.id` — narrows to one source account. */
  sourceAccountId?: string
  /** `MoneyTransfer.status`, exact. Omit for every status. */
  status?: string
  /** `YYYY-MM-DD`, inclusive. Both optional and independently usable. */
  from?: string
  to?: string
}
type Transfer = typeof schema.MoneyTransfer.$inferSelect
type Account = Pick<
  typeof schema.FinancialSourceAccount.$inferSelect,
  'providerKey' | 'externalAccountId' | 'environment'
>
type Entry = typeof schema.ProcessorBalanceEntry.$inferSelect
type ActivityRow = Pick<
  Entry,
  | 'id'
  | 'externalId'
  | 'type'
  | 'grossMinor'
  | 'feeMinor'
  | 'netMinor'
  | 'currency'
  | 'currencyExponent'
  | 'transactionDate'
  | 'payoutExternalId'
  | 'sourceTransactionId'
  | 'sourceOrderId'
  | 'sourceReference'
  | 'isOutgoingTransfer'
  | 'sourceAccountId'
>
const pageSize = (limit: number) => Math.min(100, Math.max(1, limit))
const resultSchema = z.object({
  state: z.enum(['complete', 'incomplete', 'unsupported']),
  providerReady: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  constituentNetMinor: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  differenceMinor: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  reason: z.string().nullable(),
  blockers: z.array(z.string()),
  nextActions: z.array(z.string()),
  unmatchedCount: z.number().int().nonnegative(),
})
function rejectionReason(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('rejectionReason' in value)) return null
  return typeof value.rejectionReason === 'string' ? value.rejectionReason : null
}
function connectorId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('connectorId' in value)) return null
  return typeof value.connectorId === 'string' ? value.connectorId : null
}
function transferDto(row: Transfer, account: Account, snapshot: unknown) {
  const result = resultSchema.safeParse(row.reconciliationResult)
  const current = row.reconciliationState !== 'pending' && result.success ? result.data : null
  return {
    id: row.id,
    externalId: row.externalId,
    providerKey: account.providerKey,
    sourceAccountId: row.sourceAccountId,
    externalAccountId: account.externalAccountId,
    // The third leg of `FinancialSourceAccount`'s identity tuple. Already
    // selected for the drift check below; carried out so a badge can say `test`
    // rather than letting a sandbox payout look like a real one.
    environment: account.environment,
    status: row.status,
    sourceAmountMinor: row.sourceAmountMinor.toString(),
    sourceCurrency: row.sourceCurrency,
    sourceCurrencyExponent: row.sourceCurrencyExponent,
    destinationAmountMinor: row.destinationAmountMinor.toString(),
    destinationCurrency: row.destinationCurrency,
    destinationCurrencyExponent: row.destinationCurrencyExponent,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    occurredOn: row.occurredOn,
    datePrecision: row.datePrecision,
    updatedAt: row.updatedAt.toISOString(),
    membershipState: current?.state ?? 'incomplete',
    reconciliationState: row.reconciliationState,
    reconciledAt: row.reconciledAt?.toISOString() ?? null,
    providerReady: current?.providerReady ?? false,
    entryCount: current?.entryCount ?? 0,
    constituentNetMinor: current?.constituentNetMinor ?? null,
    differenceMinor: current?.differenceMinor ?? null,
    blockers: current?.blockers ?? ['The current source evidence is waiting for reconciliation.'],
    nextActions: current?.nextActions ?? [
      'Refresh evidence after the import has finished processing.',
    ],
    sourceConnectionId: connectorId(snapshot),
    accountingState: 'not_enabled' as const,
  }
}
function transferQuery(db: Database) {
  return db
    .select({
      transfer: schema.MoneyTransfer,
      account: {
        providerKey: schema.FinancialSourceAccount.providerKey,
        externalAccountId: schema.FinancialSourceAccount.externalAccountId,
        environment: schema.FinancialSourceAccount.environment,
      },
      snapshot: schema.FinancialSourceObservation.reportingInstallationSnapshot,
      acquisitionId: sql<
        string | null
      >`${schema.FinancialSourceObservation.payload}->'acquisition'->>'id'`,
    })
    .from(schema.MoneyTransfer)
    .innerJoin(
      schema.FinancialSourceAccount,
      and(
        eq(schema.FinancialSourceAccount.organizationId, schema.MoneyTransfer.organizationId),
        eq(schema.FinancialSourceAccount.id, schema.MoneyTransfer.sourceAccountId)
      )
    )
    .innerJoin(
      schema.FinancialSourceObservation,
      and(
        eq(schema.FinancialSourceObservation.organizationId, schema.MoneyTransfer.organizationId),
        eq(schema.FinancialSourceObservation.id, schema.MoneyTransfer.currentObservationId)
      )
    )
}

/**
 * The calendar day a transfer is filed under, whichever precision it arrived at.
 *
 * 🛑 A row never carries both dates. `MoneyTransfer_date_check` ties
 * `datePrecision` to exactly one of `occurredOn` (a `date`) and `occurredAt` (a
 * `timestamptz`), so ranging on `occurredOn` alone would drop every `instant`
 * row out of every dated range — and a payout that vanishes from a date filter
 * reads as missing evidence, not as a filtered row. Collapsing both to one UTC
 * calendar day gives the range a single comparable value. `unknown` rows have
 * neither date, so they fall outside a dated range by construction, which is
 * the honest answer rather than a guessed one.
 *
 * Built per call rather than at module scope: under the unit-test config
 * `@auxx/database` is mocked and schema columns are `undefined`, and nothing
 * here should run at import time.
 */
const occurredDay = () =>
  sql`COALESCE(${schema.MoneyTransfer.occurredOn}, (${schema.MoneyTransfer.occurredAt} AT TIME ZONE 'UTC')::date)`

/** The same day {@link occurredDay} computes, read off a row already in hand. */
function evidenceDay(row: Pick<Transfer, 'occurredOn' | 'occurredAt'>): string | null {
  if (row.occurredOn) return row.occurredOn
  return row.occurredAt ? row.occurredAt.toISOString().slice(0, 10) : null
}

/**
 * The list's page cursor: `YYYY-MM-DD|<transfer id>`, the day left blank for an
 * undated payout.
 *
 * 🛑 It has to carry the DAY as well as the id. The list is ordered by the
 * payout's own date, and `MoneyTransfer.id` is a cuid2 — no time component and
 * no relation to that order — so an id-only cursor cannot say where in the sort
 * the previous page stopped.
 */
const encodePayoutCursor = (row: Pick<Transfer, 'id' | 'occurredOn' | 'occurredAt'>) =>
  `${evidenceDay(row) ?? ''}|${row.id}`

function decodePayoutCursor(raw: string): { day: string | null; id: string } {
  const split = raw.indexOf('|')
  const day = split === -1 ? '' : raw.slice(0, split)
  const id = split === -1 ? '' : raw.slice(split + 1)
  if (!id || (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))) {
    throw new BadRequestError('Invalid payout cursor')
  }
  return { day: day || null, id }
}

/**
 * Everything that sorts after the cursor row, in the list's own order.
 *
 * Undated rows sit at the very end (`NULLS LAST` below), so they are still
 * ahead of a cursor that is itself dated, and a cursor already among them pages
 * on the id alone.
 */
function afterCursor(cursor: { day: string | null; id: string }) {
  const day = occurredDay()
  const id = schema.MoneyTransfer.id
  return cursor.day
    ? sql`(${day} IS NULL OR ${day} < ${cursor.day}::date OR (${day} = ${cursor.day}::date AND ${id} < ${cursor.id}))`
    : sql`(${day} IS NULL AND ${id} < ${cursor.id})`
}

/** Read persisted assessments in one joined query; listing never reruns financial reconciliation. */
export async function listPayoutEvidence(db: Database, input: PageInput & EvidenceFilters) {
  const limit = pageSize(input.limit)
  const search = input.search?.trim()
  const rows = await transferQuery(db)
    .where(
      and(
        eq(schema.MoneyTransfer.organizationId, input.organizationId),
        input.cursor ? afterCursor(decodePayoutCursor(input.cursor)) : undefined,
        search ? sql`${schema.MoneyTransfer.externalId} ILIKE ${`%${search}%`}` : undefined,
        input.sourceAccountId
          ? eq(schema.MoneyTransfer.sourceAccountId, input.sourceAccountId)
          : undefined,
        input.status ? eq(schema.MoneyTransfer.status, input.status) : undefined,
        input.from ? sql`${occurredDay()} >= ${input.from}::date` : undefined,
        input.to ? sql`${occurredDay()} <= ${input.to}::date` : undefined
      )
    )
    /* Newest payout first, by the PROVIDER's date — the date the row leads
       with — with the id only as a tiebreaker inside a day. `NULLS LAST` keeps
       undated (`datePrecision = 'unknown'`) payouts at the bottom: Postgres
       sorts nulls FIRST under `DESC`, which would otherwise open the list on
       the rows that have no date at all. */
    .orderBy(sql`${occurredDay()} DESC NULLS LAST`, desc(schema.MoneyTransfer.id))
    .limit(limit + 1)
  return {
    items: rows
      .slice(0, limit)
      .map(({ transfer, account, snapshot }) => transferDto(transfer, account, snapshot)),
    nextCursor: rows.length > limit ? encodePayoutCursor(rows[limit - 1]!.transfer) : null,
  }
}

/**
 * The source accounts a payout picker may offer: only those with a
 * `MoneyTransfer` behind them in this organization.
 *
 * Built from the transfers rather than from `FinancialSourceAccount` itself, so
 * the picker cannot offer an account that answers with an empty list — a
 * connected-but-never-synced account looks like a broken filter, not an empty
 * one. Archived accounts stay listed while their payouts do; hiding the option
 * would hide rows that are still in the list.
 */
export async function listPayoutSourceAccounts(
  db: Database,
  input: { organizationId: string }
): Promise<
  Array<{ id: string; providerKey: string; externalAccountId: string; environment: string }>
> {
  return db
    .selectDistinct({
      id: schema.FinancialSourceAccount.id,
      providerKey: schema.FinancialSourceAccount.providerKey,
      externalAccountId: schema.FinancialSourceAccount.externalAccountId,
      environment: schema.FinancialSourceAccount.environment,
    })
    .from(schema.FinancialSourceAccount)
    .innerJoin(
      schema.MoneyTransfer,
      and(
        eq(schema.MoneyTransfer.organizationId, schema.FinancialSourceAccount.organizationId),
        eq(schema.MoneyTransfer.sourceAccountId, schema.FinancialSourceAccount.id)
      )
    )
    .where(eq(schema.FinancialSourceAccount.organizationId, input.organizationId))
    .orderBy(
      asc(schema.FinancialSourceAccount.providerKey),
      asc(schema.FinancialSourceAccount.externalAccountId)
    )
}

/** Inspect the current header and persisted assessment without loading all membership history. */
export async function getPayoutEvidence(
  db: Database,
  input: { organizationId: string; id: string }
) {
  const [row] = await transferQuery(db)
    .where(
      and(
        eq(schema.MoneyTransfer.organizationId, input.organizationId),
        eq(schema.MoneyTransfer.id, input.id)
      )
    )
    .limit(1)
  if (!row) return null
  const [observation] = await db
    .select({ payload: schema.FinancialSourceObservation.payload })
    .from(schema.FinancialSourceObservation)
    .where(
      and(
        eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
        eq(schema.FinancialSourceObservation.id, row.transfer.currentObservationId)
      )
    )
    .limit(1)
  return {
    ...transferDto(row.transfer, row.account, row.snapshot),
    sourceObservation: observation?.payload ?? null,
  }
}

/** Page immutable source observations independently of payout membership and current assessment. */
export async function listPayoutEvidenceHistory(
  db: Database,
  input: PageInput & { transferId: string }
) {
  const limit = pageSize(input.limit)
  const rows = await db
    .select({ observation: schema.FinancialSourceObservation })
    .from(schema.FinancialSourceObservation)
    .innerJoin(
      schema.MoneyTransfer,
      and(
        eq(schema.MoneyTransfer.organizationId, schema.FinancialSourceObservation.organizationId),
        eq(schema.MoneyTransfer.sourceObjectId, schema.FinancialSourceObservation.sourceObjectId)
      )
    )
    .where(
      and(
        eq(schema.MoneyTransfer.organizationId, input.organizationId),
        eq(schema.MoneyTransfer.id, input.transferId),
        input.cursor ? lt(schema.FinancialSourceObservation.id, input.cursor) : undefined
      )
    )
    .orderBy(desc(schema.FinancialSourceObservation.id))
    .limit(limit + 1)
  return {
    items: rows.slice(0, limit).map(({ observation }) => {
      const parsed = payoutRecordEvidenceSchema.safeParse(observation.payload)
      const evidence = parsed.success ? parsed.data : null
      return {
        id: observation.id,
        createdAt: observation.observedAt.toISOString(),
        acquisitionId: evidence?.acquisition.id ?? null,
        pageIndex: evidence?.membership.page?.index ?? null,
        providerReady: evidence?.membership.providerReady ?? false,
        entryCount: evidence?.membership.entries.length ?? 0,
        reason:
          evidence?.rejectionReason ??
          evidence?.membership.reason ??
          (evidence ? null : 'Source evidence does not match the supported contract.'),
        rejections: evidence?.membership.rejections ?? [],
        rawEvidence: observation.payload,
      }
    }),
    nextCursor: rows.length > limit ? rows[limit - 1]!.observation.id : null,
  }
}

async function entryDtos(
  db: Database,
  organizationId: string,
  rows: ActivityRow[],
  accounts: Map<string, Account>
) {
  const matches = await matchProcessorEntries(db, organizationId, rows)
  return rows.map((row) => {
    const account = accounts.get(row.sourceAccountId)
    if (!account) throw new ConflictError('Processor source account is missing. Refresh evidence.')
    const matchedMoneyTransactionId = matches.get(row.id) ?? null
    return {
      id: row.id,
      externalId: row.externalId,
      type: row.type,
      grossMinor: row.grossMinor.toString(),
      feeMinor: row.feeMinor.toString(),
      netMinor: row.netMinor.toString(),
      currency: row.currency,
      currencyExponent: row.currencyExponent,
      transactionDate: row.transactionDate?.toISOString() ?? null,
      payoutExternalId: row.payoutExternalId,
      sourceTransactionId: row.sourceTransactionId,
      sourceOrderId: row.sourceOrderId,
      sourceReference: row.sourceReference,
      matchedMoneyTransactionId,
      matchState: matchedMoneyTransactionId
        ? ('matched' as const)
        : ['charge', 'refund'].includes(row.type)
          ? ('unmatched' as const)
          : ('unsupported' as const),
      isOutgoingTransfer: row.isOutgoingTransfer,
      sourceAccountId: row.sourceAccountId,
      externalAccountId: account.externalAccountId,
      providerKey: account.providerKey,
      environment: account.environment,
    }
  })
}
const membershipCursorSchema = z.object({
  acquisitionId: z.string(),
  headerObservationId: z.string(),
  pageIndex: z.number().int().nonnegative(),
  offset: z.number().int().min(0).max(250),
})
const coverageSchema = z.object({
  acquisitionId: z.string(),
  headerObservationId: z.string(),
  pageObservations: z.array(
    z.object({
      id: z.string(),
      index: z.number().int().nonnegative(),
      pageId: z.string(),
      requestCursor: z.string().nullable(),
      nextCursor: z.string().nullable(),
      terminal: z.boolean(),
    })
  ),
})
function membershipCursor(cursor: string) {
  try {
    return membershipCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
  } catch {
    throw new BadRequestError('Invalid payout activity cursor. Refresh evidence.')
  }
}

async function membershipEntries(
  db: Database,
  input: PageInput & { transferId: string; unassignedOnly?: boolean }
) {
  const limit = pageSize(input.limit)
  const [joined] = await transferQuery(db)
    .where(
      and(
        eq(schema.MoneyTransfer.organizationId, input.organizationId),
        eq(schema.MoneyTransfer.id, input.transferId)
      )
    )
    .limit(1)
  if (!joined) return { items: [], nextCursor: null }
  const transfer = joined.transfer
  const coverage = await db
    .select({ fetchedBoundary: schema.FinancialSourceCoverage.fetchedBoundary })
    .from(schema.FinancialSourceCoverage)
    .where(
      and(
        eq(schema.FinancialSourceCoverage.organizationId, input.organizationId),
        eq(schema.FinancialSourceCoverage.sourceAccountId, transfer.sourceAccountId),
        eq(schema.FinancialSourceCoverage.streamKey, 'payout_membership'),
        eq(
          schema.FinancialSourceCoverage.windowKey,
          `payout:${transfer.externalId}:acquisition:${joined.acquisitionId}`
        )
      )
    )
    .limit(2)
  const parsed =
    coverage.length === 1 ? coverageSchema.safeParse(coverage[0]!.fetchedBoundary) : null
  if (!parsed?.success) return { items: [], nextCursor: null }
  const boundary = parsed.data
  const pages = [...boundary.pageObservations].sort((a, b) => a.index - b.index)
  const cursor = input.cursor ? membershipCursor(input.cursor) : null
  if (
    cursor &&
    (cursor.headerObservationId !== transfer.currentObservationId ||
      cursor.acquisitionId !== boundary.acquisitionId)
  )
    throw new ConflictError(
      'Payout membership changed. Refresh evidence before loading more activity.'
    )
  const pagePosition = cursor ? pages.findIndex((page) => page.index === cursor.pageIndex) : 0
  const page = pages[pagePosition]
  if (!page) return { items: [], nextCursor: null }
  const [observation] = await db
    .select({ payload: schema.FinancialSourceObservation.payload })
    .from(schema.FinancialSourceObservation)
    .where(
      and(
        eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
        eq(schema.FinancialSourceObservation.sourceObjectId, transfer.sourceObjectId),
        eq(schema.FinancialSourceObservation.id, page.id)
      )
    )
    .limit(1)
  const parsedEvidence = payoutRecordEvidenceSchema.safeParse(observation?.payload)
  if (!parsedEvidence.success)
    throw new ConflictError(
      'A saved membership page is unavailable. Refresh evidence and review import history.'
    )
  const evidence = parsedEvidence.data
  if (
    evidence.acquisition.id !== boundary.acquisitionId ||
    evidence.payout?.id !== transfer.externalId ||
    evidence.sourceAccount.providerKey !== joined.account.providerKey ||
    evidence.sourceAccount.externalAccountId !== joined.account.externalAccountId ||
    evidence.sourceAccount.environment !== joined.account.environment ||
    evidence.membership.page?.id !== page.pageId ||
    evidence.membership.page.index !== page.index
  )
    throw new ConflictError(
      'Payout membership page identity does not match its acquisition. Review import history.'
    )
  const offset = cursor?.offset ?? 0
  const selected = evidence.membership.entries.slice(offset, offset + limit)
  const rows: ActivityRow[] = []
  for (const entry of selected) {
    if (input.unassignedOnly && entry.payoutId !== null) continue
    try {
      rows.push({
        id: JSON.stringify([page.id, entry.id]),
        externalId: entry.id,
        sourceAccountId: transfer.sourceAccountId,
        type: entry.type,
        grossMinor: exactEvidenceMinor(entry.gross, entry.currency, entry.currencyExponent),
        feeMinor: exactEvidenceMinor(entry.fee, entry.currency, entry.currencyExponent),
        netMinor: exactEvidenceMinor(entry.net, entry.currency, entry.currencyExponent),
        currency: entry.currency,
        currencyExponent: entry.currencyExponent,
        transactionDate: entry.transactionDate ? new Date(entry.transactionDate) : null,
        payoutExternalId: entry.payoutId,
        sourceTransactionId: entry.sourceTransactionId,
        sourceOrderId: entry.sourceOrderId,
        sourceReference: entry.sourceReference ?? null,
        isOutgoingTransfer: entry.type === 'outgoing_transfer',
      })
    } catch {
      throw new ConflictError(
        'A membership amount is invalid. Review the raw source page in import history.'
      )
    }
  }
  const nextOffset = offset + selected.length
  const nextPage = nextOffset < evidence.membership.entries.length ? page : pages[pagePosition + 1]
  const nextCursor = nextPage
    ? Buffer.from(
        JSON.stringify({
          acquisitionId: boundary.acquisitionId,
          headerObservationId: transfer.currentObservationId,
          pageIndex: nextPage.index,
          offset: nextPage === page ? nextOffset : 0,
        })
      ).toString('base64url')
    : null
  return {
    items: await entryDtos(
      db,
      input.organizationId,
      rows,
      new Map([[transfer.sourceAccountId, joined.account]])
    ),
    nextCursor,
  }
}

/** Read one bounded membership page or a current activity page with one batch payment match. */
export async function listProcessorBalanceEntries(
  db: Database,
  input: PageInput & { unassignedOnly?: boolean; transferId?: string }
) {
  if (input.transferId) return membershipEntries(db, { ...input, transferId: input.transferId })
  const limit = pageSize(input.limit)
  const rows = await db
    .select({
      entry: schema.ProcessorBalanceEntry,
      account: {
        providerKey: schema.FinancialSourceAccount.providerKey,
        externalAccountId: schema.FinancialSourceAccount.externalAccountId,
        environment: schema.FinancialSourceAccount.environment,
      },
    })
    .from(schema.ProcessorBalanceEntry)
    .innerJoin(
      schema.FinancialSourceAccount,
      and(
        eq(
          schema.FinancialSourceAccount.organizationId,
          schema.ProcessorBalanceEntry.organizationId
        ),
        eq(schema.FinancialSourceAccount.id, schema.ProcessorBalanceEntry.sourceAccountId)
      )
    )
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, input.organizationId),
        input.unassignedOnly ? isNull(schema.ProcessorBalanceEntry.payoutExternalId) : undefined,
        input.cursor ? lt(schema.ProcessorBalanceEntry.id, input.cursor) : undefined
      )
    )
    .orderBy(desc(schema.ProcessorBalanceEntry.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  return {
    items: await entryDtos(
      db,
      input.organizationId,
      page.map((row) => row.entry),
      new Map(page.map(({ entry, account }) => [entry.sourceAccountId, account]))
    ),
    nextCursor: rows.length > limit ? rows[limit - 1]!.entry.id : null,
  }
}

/** Inspect rejected current source rows without fabricating numeric processor activity. */
export async function listRejectedProcessorEvidence(db: Database, input: PageInput) {
  const limit = pageSize(input.limit)
  const rows = await db
    .select({
      observation: schema.FinancialSourceObservation,
      externalId: schema.FinancialSourceObject.externalId,
      account: schema.FinancialSourceAccount,
    })
    .from(schema.FinancialSourceObservation)
    .innerJoin(
      schema.FinancialSourceObject,
      and(
        eq(
          schema.FinancialSourceObject.organizationId,
          schema.FinancialSourceObservation.organizationId
        ),
        eq(schema.FinancialSourceObject.id, schema.FinancialSourceObservation.sourceObjectId)
      )
    )
    .innerJoin(
      schema.FinancialSourceAccount,
      and(
        eq(
          schema.FinancialSourceAccount.organizationId,
          schema.FinancialSourceObject.organizationId
        ),
        eq(schema.FinancialSourceAccount.id, schema.FinancialSourceObject.sourceAccountId)
      )
    )
    .where(
      and(
        eq(schema.FinancialSourceObservation.organizationId, input.organizationId),
        inArray(schema.FinancialSourceObject.objectType, ['balance_transaction', 'payout']),
        sql`COALESCE(${schema.FinancialSourceObservation.payload}->>'rejectionReason', ${schema.FinancialSourceObservation.reportingInstallationSnapshot}->>'rejectionReason') IS NOT NULL`,
        sql`NOT EXISTS (SELECT 1 FROM "FinancialSourceObservation" newer WHERE newer."organizationId" = ${schema.FinancialSourceObservation.organizationId} AND newer."sourceObjectId" = ${schema.FinancialSourceObservation.sourceObjectId} AND (newer."observedAt", newer."id") > (${schema.FinancialSourceObservation.observedAt}, ${schema.FinancialSourceObservation.id}))`,
        input.cursor ? lt(schema.FinancialSourceObservation.id, input.cursor) : undefined
      )
    )
    .orderBy(desc(schema.FinancialSourceObservation.id))
    .limit(limit + 1)
  return {
    items: rows.slice(0, limit).map(({ observation, externalId, account }) => ({
      observationId: observation.id,
      externalId,
      observedAt: observation.observedAt.toISOString(),
      reason:
        rejectionReason(observation.payload) ??
        rejectionReason(observation.reportingInstallationSnapshot) ??
        'Source evidence could not be processed.',
      rawEvidence: observation.payload,
      externalAccountId: account.externalAccountId,
      providerKey: account.providerKey,
      environment: account.environment,
      sourceAccountId: account.id,
    })),
    nextCursor: rows.length > limit ? rows[limit - 1]!.observation.id : null,
  }
}
