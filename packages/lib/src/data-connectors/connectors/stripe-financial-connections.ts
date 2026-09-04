// packages/lib/src/data-connectors/connectors/stripe-financial-connections.ts
//
// The bank feed (plans/bank-connection/01 §3, decision B12). A third built-in beside
// `generic-rest` and `fixture`.
//
// 🛑 It drives NO HTTP transport. Stripe Financial Connections runs on the platform
// secret key, so there is no stored token, no `authApply`, and no base URL for the
// generic transport to interpolate: the connector reads the `fca_...` account off the
// bound credential's `metadata.providerAccountId` and calls the Stripe SDK through
// `getStripeConnectClient()`. `config.endpoint` is still set at provision time and is
// honest about which host is called, because `getConnectorReadiness` reads it and a
// connector with no endpoint refuses to sync.
//
// 🛑 CONTRIBUTING MODE ONLY, and orphan-archive is structurally unavailable
// (plans/bank-connection/02 §5.1). A bank transaction accumulates auxx-owned state the
// moment a bookkeeper touches it - a GL code, a match to a document, a review status, a
// posted `GlPosting` - so a reconciliation sweep that archived a row because it fell out
// of the upstream window would be deleting a posted journal entry's source document.
// Both streams are declared `incremental`, which is what stops `reconcileOrphans`
// archiving on absence, and the provisioner writes `targetMode: 'contributing'` and
// `orphanBehavior: 'ignore'` on both mappings.
//
// ⚠️ TWO UNRELATED THINGS MEAN "PENDING" here (02 §6). A transaction's `status` is
// `pending | posted | void` at the BANK. The account's `transaction_refresh.status` is
// `pending | succeeded | failed` for the FETCH. They are never abbreviated in this file.

import { createScopedLogger } from '@auxx/logger'
import { normalizeMatchKey } from '../../banking/feed/match-key'
import { getStripeConnectClient } from '../../money/payments/connect-client'
import { periodKeyForDate } from '../../postings/periods'
import type { SyncCursor } from '../../sync-core/contracts'
import type {
  ConnectorFetchArgs,
  ConnectorYield,
  DataConnectorDefinition,
  FetchResult,
} from './types'
import { ConnectorRateLimitError } from './types'

const logger = createScopedLogger('data-connector-stripe-fc')

/** The connector `type` string. One connector row is ONE Financial Connections account. */
export const STRIPE_FC_CONNECTOR_TYPE = 'stripe-financial-connections'

/** The account stream: one row, the `bank_account` this connector feeds. */
export const FC_ACCOUNTS_STREAM = 'accounts'
/** The transaction stream: the statement lines. */
export const FC_TRANSACTIONS_STREAM = 'transactions'

/** Stripe's own page cap for this endpoint. */
const PAGE_SIZE = 100

/**
 * Connector-level config the provisioner stamps under `config.filters`, read here.
 *
 * ⚠️ `bankAccountRecordId` and `connectorId` are stamped in a SECOND write after
 * `createConnector` returns, because neither exists before the row does. They are
 * config, not record data: the connector needs to say which `bank_account` its rows
 * belong to (a RELATIONSHIP value the sink writes) and which connector row the
 * `accounts` stream is re-identifying (the `match` key the sink adopts the existing
 * record by, instead of creating a second one beside it).
 */
export interface FinancialConnectionsFilters {
  /** `<entityDefinitionId>:<entityInstanceId>` of the `bank_account` this feeds. */
  bankAccountRecordId: string
  /** This connector's own id - the `bank_account.connectorId` value, and its match key. */
  connectorId: string
  /**
   * The org's `accounting.bookTimeZone`, copied at connect time.
   *
   * 🛑 A transaction at 7pm on 31 January in `America/New_York` is already 1 February
   * in UTC (`inventory-costing-architecture-guide.md` §9.5). `postedAt` decides period
   * membership, so deriving it in UTC posts a line to the wrong month - invisible
   * except at a close, and uncorrectable once the period is locked.
   *
   * ⚠️ A COPY, and deliberately so: a connector `fetch` has no organization id and no
   * database. It cannot go stale in practice because `assertAccountingSetupUnfrozen`
   * refuses to change `accounting.bookTimeZone` once any `GlPosting` exists, and a
   * reconnect re-stamps it. Absent ⇒ UTC.
   */
  bookTimeZone?: string
  /** The `fca_...` account, mirrored from the credential so a test-fetch can run. */
  accountId?: string
}

// ── The narrow slice of the Stripe SDK this connector uses ────────────────────
//
// Declared structurally rather than imported from `stripe`, so the unit tests can hand
// in a fake with no network and no SDK. The real client is `getStripeConnectClient()
// .financialConnections`, resolved lazily below.

/** A Financial Connections Account, narrowed to what the feed reads. */
export interface FcAccount {
  id: string
  /** `active` | `inactive` | `disconnected`. */
  status?: string | null
  institution_name?: string | null
  display_name?: string | null
  last4?: string | null
  /** `cash` | `credit` | `investment` | `other`. */
  category?: string | null
  subcategory?: string | null
  balance?: { current?: Record<string, number> | null } | null
  transaction_refresh?: {
    id?: string | null
    /** `pending` | `succeeded` | `failed` - the FETCH's state, not a transaction's. */
    status?: string | null
    last_attempted_at?: number | null
    next_refresh_available_at?: number | null
  } | null
}

/** A Financial Connections Transaction, narrowed to what the feed reads. */
export interface FcTransaction {
  id: string
  account?: string
  /** Integer minor units, SIGNED. `-1000` is minus ten dollars, in cents. */
  amount: number
  currency?: string | null
  description?: string | null
  /** `pending` | `posted` | `void` at the BANK. */
  status?: string | null
  status_transitions?: { posted_at?: number | null; void_at?: number | null } | null
  /** Unix seconds - when the economic event happened. THE accounting date. */
  transacted_at?: number | null
  transaction_refresh?: string | null
}

/** Everything the connector asks of Stripe. */
export interface FinancialConnectionsClient {
  accounts: {
    retrieve(id: string): Promise<FcAccount>
  }
  transactions: {
    list(params: {
      account: string
      limit?: number
      starting_after?: string
      transaction_refresh?: { after: string }
    }): Promise<{ data: FcTransaction[]; has_more?: boolean }>
  }
}

/** How the definition gets a client. Overridden in tests; defaults to the platform key. */
export type FinancialConnectionsClientFactory = () => FinancialConnectionsClient

/**
 * The real client - the same platform Stripe instance Connect charges run on.
 *
 * ⚠️ `getStripeConnectClient` is itself lazy and memoized, so importing this module (as
 * `connectors/registry.ts` does, eagerly) constructs nothing and needs no
 * `STRIPE_SECRET_KEY`. The key is only read the first time a sync actually fetches.
 */
function defaultClientFactory(): FinancialConnectionsClient {
  return getStripeConnectClient().financialConnections as unknown as FinancialConnectionsClient
}

// ── Cursor + watermark codecs ─────────────────────────────────────────────────

/** The intra-slice resume point: where in the current page-set we stopped. */
interface FcCursor {
  /** Stripe `starting_after` - the last transaction id yielded. */
  startingAfter?: string
  /** The `transaction_refresh[after]` filter pinned for this whole page-set. */
  refreshAfter?: string
}

function encodeCursor(value: FcCursor): SyncCursor {
  return { kind: 'token', value: JSON.stringify(value) }
}

/** Tolerant of a malformed or legacy value - a bad cursor restarts, never fails a sync. */
function decodeCursor(cursor: SyncCursor | undefined): FcCursor | null {
  if (!cursor?.value) return null
  try {
    const parsed = JSON.parse(cursor.value) as FcCursor
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * The last CONSUMED `transaction_refresh`, encoded as `<paddedSeconds>:<refreshId>`.
 *
 * 🛑 The padding is not cosmetic. The engine folds watermarks with `maxWatermark`,
 * which compares two non-numeric strings LEXICALLY - and a Stripe object id
 * (`fctxnref_OcWmGrWpt…`) has a random suffix, so a newer refresh id is lexically
 * smaller about half the time and the fold would silently discard it, leaving the feed
 * pinned to an old cursor for good. Prefixing the refresh's own `last_attempted_at`,
 * zero-padded to a fixed width, makes the string monotonic by construction.
 *
 * The alternative - keeping the id in the CURSOR - does not work: the engine clears the
 * cursor on the terminal page of a slice chain (`cursor === undefined` IS the
 * exhausted signal), which is exactly the moment the id becomes worth keeping.
 */
const WATERMARK_WIDTH = 12

export function encodeRefreshWatermark(refreshId: string, lastAttemptedAt: number): string {
  return `${String(Math.max(0, Math.floor(lastAttemptedAt))).padStart(WATERMARK_WIDTH, '0')}:${refreshId}`
}

/** The refresh id out of a watermark, or null when there is none / it is malformed. */
export function decodeRefreshWatermark(watermark: string | undefined): string | null {
  if (!watermark) return null
  const at = watermark.indexOf(':')
  if (at < 0) return null
  const id = watermark.slice(at + 1)
  return id.length > 0 ? id : null
}

// ── Field shaping ─────────────────────────────────────────────────────────────

/**
 * The `bank_account.type` this FC account maps onto.
 *
 * 🛑 Asserted ONCE, here, from `category`/`subcategory` - never inferred per
 * transaction (plans/bank-connection/02 §6). A credit account is a LIABILITY whose
 * signs invert, and getting it wrong produces a balance sheet that still balances:
 * LFK's QuickBooks card sits at -$570,855.81 against a real $29,701.88, which is what
 * two years of that looks like.
 */
export function toBankAccountType(account: FcAccount): 'depository' | 'credit' {
  if (account.category === 'credit') return 'credit'
  if (account.subcategory === 'credit_card' || account.subcategory === 'line_of_credit') {
    return 'credit'
  }
  return 'depository'
}

/** The currency an account reports, from its balance keys. FC is US accounts only. */
export function toAccountCurrency(account: FcAccount): string {
  const codes = Object.keys(account.balance?.current ?? {})
  return (codes[0] ?? 'usd').toUpperCase()
}

/** `Bank of America ···5381`, minus whatever the institution did not send. */
export function toAccountLabel(account: FcAccount): string {
  const head = [account.institution_name, account.display_name].filter(Boolean).join(' · ')
  const name = head || 'Bank account'
  return account.last4 ? `${name} ···${account.last4}` : name
}

/**
 * The BANK's state, narrowed to the three values `bank_transaction.bankStatus` carries.
 *
 * 🛑 `void` is a state change on a row we already hold, never a deletion. The row
 * stays, and a posting it carried is REVERSED. That is the movement ledger's rule and
 * the reason Stripe's model suits an append-only ledger better than a `removed[]`
 * array - which hands you an id for a row that no longer exists upstream but has a
 * `GlPosting` behind it.
 */
export function toBankStatus(status: string | null | undefined): 'pending' | 'posted' | 'void' {
  return status === 'pending' || status === 'void' ? status : 'posted'
}

/**
 * The pre-shaped `bank_transaction` payload for one Stripe transaction.
 *
 * Exported for the tests: everything interesting this connector does to a transaction
 * happens here, and it is pure.
 */
export function toTransactionFields(
  txn: FcTransaction,
  opts: { bankAccountRecordId: string; bookTimeZone: string }
): Record<string, unknown> {
  // 🛑 `transacted_at`, never `status_transitions.posted_at`. The first is when the
  // economic event happened, which is what an accrual ledger records and how a bank
  // statement reads; the second is a processing artefact, and the two routinely differ
  // across a month boundary (plans/bank-connection/01 §4.2 (1)).
  const seconds = txn.transacted_at ?? txn.status_transitions?.posted_at ?? null
  const description = txn.description ?? ''
  return {
    externalId: txn.id,
    bankAccountRecordId: opts.bankAccountRecordId,
    postedAt:
      seconds == null ? null : periodKeyForDate(new Date(seconds * 1000), 'day', opts.bookTimeZone),
    description,
    // ✅ Already integer minor units, and SIGNED - the one signed money column in the
    // books. It mirrors the statement, and reconciling IS comparing the two. The split
    // into a positive amount plus a direction happens once, at the builder boundary.
    amountMinor: txn.amount,
    bankStatus: toBankStatus(txn.status),
    matchKey: normalizeMatchKey(description),
    source: 'feed',
  }
}

/** The pre-shaped `bank_account` payload for the account stream. */
export function toAccountFields(
  account: FcAccount,
  opts: { connectorId: string }
): Record<string, unknown> {
  return {
    externalId: account.id,
    connectorId: opts.connectorId,
    institution: account.institution_name ?? null,
    name: account.display_name ?? toAccountLabel(account),
    last4: account.last4 ?? null,
    type: toBankAccountType(account),
    currency: toAccountCurrency(account),
    // `inactive` is NOT "connected but quiet" - both subscribe and refresh refuse on
    // it, so the feed is dead until somebody re-authenticates.
    status: account.status === 'active' ? 'connected' : 'disconnected',
  }
}

// ── The connector ─────────────────────────────────────────────────────────────

/** Read the `fca_...` id: the credential is authoritative, config is the fallback. */
function resolveAccountId(args: ConnectorFetchArgs): string {
  const fromCredential = (args.credential?.metadata as { providerAccountId?: unknown } | undefined)
    ?.providerAccountId
  if (typeof fromCredential === 'string' && fromCredential.length > 0) return fromCredential
  const filters = readFilters(args)
  if (filters.accountId) return filters.accountId
  throw new Error(
    'This bank connection has no Financial Connections account on it. Reconnect the bank to restore the credential.'
  )
}

function readFilters(args: ConnectorFetchArgs): FinancialConnectionsFilters {
  const raw = args.config.filters?.financialConnections as
    | Partial<FinancialConnectionsFilters>
    | undefined
  if (!raw?.bankAccountRecordId || !raw?.connectorId) {
    throw new Error(
      'This bank feed is not fully provisioned: it has no bank account to write into. Reconnect the bank.'
    )
  }
  return raw as FinancialConnectionsFilters
}

/** Map Stripe's throttle onto the engine's, so a slice holds its cursor and backs off. */
function rethrowStripeError(error: unknown): never {
  const e = error as { statusCode?: number; type?: string; message?: string }
  if (e?.statusCode === 429 || e?.type === 'rate_limit_error') {
    throw new ConnectorRateLimitError(e.message ?? 'Stripe rate limit', undefined)
  }
  throw error
}

/**
 * Build the connector definition over an injected client.
 *
 * The factory exists for the tests, which pass a fake and touch no network. Production
 * uses {@link stripeFinancialConnectionsConnector}, which is this over the platform
 * Stripe client.
 */
export function createStripeFinancialConnectionsConnector(
  clientFactory: FinancialConnectionsClientFactory = defaultClientFactory
): DataConnectorDefinition {
  return {
    type: STRIPE_FC_CONNECTOR_TYPE,
    schemaVersion: 1,
    // The request is baked into this code - there is no HTTP request to author, so the
    // detail view must not offer the generic-REST builder over it.
    requestModel: 'fixed',
    streams: [],

    async fetch(args: ConnectorFetchArgs): Promise<FetchResult> {
      const client = clientFactory()
      const accountId = resolveAccountId(args)
      const filters = readFilters(args)
      const account = await client.accounts.retrieve(accountId).catch(rethrowStripeError)

      // 🛑 An `inactive` account is never read as "nothing to sync"
      // (plans/bank-connection/01 §4.2 (5)). Both subscribe and refresh refuse on it,
      // so a silent success here is a feed that has stopped and says so nowhere - the
      // most expensive bug in this subsystem. The word "reconnect" in the message is
      // load-bearing: `classifyConnectorError` reads it and puts the connector in
      // `action-needed` with the non-dismissible banner, rather than a generic error
      // with a Retry button that cannot possibly work.
      if (account.status && account.status !== 'active') {
        throw new Error(
          `This bank account is ${account.status} at Stripe and cannot be read. Reconnect the bank to restore the feed.`
        )
      }

      if (args.streamKey === FC_ACCOUNTS_STREAM) {
        return {
          records: accountStream(account, filters),
          nextState: { ...args.state },
        }
      }

      return {
        records: transactionStream(client, account, args, filters),
        nextState: { ...args.state },
      }
    },
  }
}

/** One record: the account itself, so the `bank_account` row tracks what the bank says. */
async function* accountStream(
  account: FcAccount,
  filters: FinancialConnectionsFilters
): AsyncIterable<ConnectorYield> {
  yield {
    streamKey: FC_ACCOUNTS_STREAM,
    externalId: account.id,
    displayName: toAccountLabel(account),
    fields: toAccountFields(account, { connectorId: filters.connectorId }),
  }
  // Terminal: one page, no cursor.
  yield { __checkpoint: true }
}

/**
 * The statement lines, paged and resumable.
 *
 * The delta mechanism is `transaction_refresh[after]`, which returns every transaction
 * that is NEW OR UPDATED since a given refresh - a real change feed, so there is no
 * overlap window, no re-sink of ten days and no fuzzy duplicate sweep (the three
 * workarounds that existed only because the previous candidate had no change feed).
 * A `pending → void` transition is an UPDATE, so it arrives on this filter, which is
 * what makes `void` safe to model as a state change on a row we keep.
 *
 * On a BACKFILL (`mode: 'snapshot'`) the filter is deliberately omitted: the first run
 * takes everything Stripe will give (up to 180 days) and only then pins a watermark.
 */
async function* transactionStream(
  client: FinancialConnectionsClient,
  account: FcAccount,
  args: ConnectorFetchArgs,
  filters: FinancialConnectionsFilters
): AsyncIterable<ConnectorYield> {
  const resumed = decodeCursor(args.state.backfillCursor)
  const refreshAfter =
    resumed?.refreshAfter ??
    (args.mode === 'incremental'
      ? (decodeRefreshWatermark(args.state.watermark) ?? undefined)
      : undefined)

  const bookTimeZone = filters.bookTimeZone || 'UTC'
  let startingAfter = resumed?.startingAfter

  for (;;) {
    const page = await client.transactions
      .list({
        account: account.id,
        limit: PAGE_SIZE,
        ...(refreshAfter && { transaction_refresh: { after: refreshAfter } }),
        ...(startingAfter && { starting_after: startingAfter }),
      })
      .catch(rethrowStripeError)

    for (const txn of page.data) {
      yield {
        streamKey: FC_TRANSACTIONS_STREAM,
        externalId: txn.id,
        displayName: txn.description ?? txn.id,
        fields: toTransactionFields(txn, {
          bankAccountRecordId: filters.bankAccountRecordId,
          bookTimeZone,
        }),
      }
    }

    const last = page.data[page.data.length - 1]
    if (page.has_more && last) {
      startingAfter = last.id
      yield { __checkpoint: true, cursor: encodeCursor({ startingAfter, refreshAfter }) }
      continue
    }

    // Exhausted. No cursor ⇒ the engine ends the chain; the watermark is the ONLY
    // thing that survives, which is why the consumed refresh id rides on it.
    //
    // ⚠️ Only a `succeeded` refresh is consumed. Pinning a `pending` or `failed` one
    // would advance past rows Stripe has not finished fetching, and they would never
    // be asked for again.
    const refresh = account.transaction_refresh
    const consumable =
      refresh?.id && refresh.status === 'succeeded'
        ? encodeRefreshWatermark(refresh.id, refresh.last_attempted_at ?? 0)
        : undefined
    if (!consumable) {
      logger.debug('no consumable transaction_refresh - the next run re-lists', {
        accountId: account.id,
        refreshStatus: refresh?.status ?? null,
      })
    }
    yield { __checkpoint: true, ...(consumable && { watermark: consumable }) }
    return
  }
}

/** The production connector, over the platform Stripe client. */
export const stripeFinancialConnectionsConnector: DataConnectorDefinition =
  createStripeFinancialConnectionsConnector()
