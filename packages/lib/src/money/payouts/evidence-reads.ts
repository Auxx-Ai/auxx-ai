// packages/lib/src/money/payouts/evidence-reads.ts
import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { BadRequestError, ConflictError } from '../../errors'
import { exactEvidenceMinor } from './evidence-contracts'
import { matchProcessorEntries } from './match-entries'
import { payoutRecordEvidenceSchema } from './record-contracts'

type PageInput = { organizationId: string; limit: number; cursor?: string }
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

/** Read persisted assessments in one joined query; listing never reruns financial reconciliation. */
export async function listPayoutEvidence(db: Database, input: PageInput) {
  const limit = pageSize(input.limit)
  const rows = await transferQuery(db)
    .where(
      and(
        eq(schema.MoneyTransfer.organizationId, input.organizationId),
        input.cursor ? lt(schema.MoneyTransfer.id, input.cursor) : undefined
      )
    )
    .orderBy(desc(schema.MoneyTransfer.id))
    .limit(limit + 1)
  return {
    items: rows
      .slice(0, limit)
      .map(({ transfer, account, snapshot }) => transferDto(transfer, account, snapshot)),
    nextCursor: rows.length > limit ? rows[limit - 1]!.transfer.id : null,
  }
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
    })),
    nextCursor: rows.length > limit ? rows[limit - 1]!.observation.id : null,
  }
}
