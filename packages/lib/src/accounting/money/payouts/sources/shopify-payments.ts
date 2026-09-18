// packages/lib/src/accounting/money/payouts/sources/shopify-payments.ts

/**
 * Shopify Payments as a {@link PayoutSource}
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §5).
 *
 * No HTTP lives here. The Shopify Payments REST calls are two tools in the
 * installed Shopify app (`auxxai-apps/apps/shopify/src/tools/`,
 * `list_shopify_payouts` and `list_shopify_payout_transactions`), reached
 * through the same installation -> deployment -> connection -> Lambda chain the
 * QuickBooks adapter uses, resolved once per org by `resolveAppToolContext` and
 * carried as the context's handle. The tools page to exhaustion and refuse on
 * any short read, so what arrives here is the whole answer or a throw.
 *
 * ## Recognition is by ORDER, not by charge (27 §4 rule 1, R3)
 *
 * No connector writes `PaymentTransaction`, so a Shopify item recognised on a
 * charge id would recognise nothing and credit the whole deposit to `2450`.
 * Each balance transaction names `source_order_id`, the numeric REST `Order.id`
 * the Shopify connector writes as the order's `externalId`; that is the ref.
 * A row with no order (a fee, an adjustment, a reserve) is `none`.
 *
 * ## Which record is the Shopify Payments rail (task 58 §5.5)
 *
 * One Shopify store per org, so at most one live `FinancialSourceAccount` of
 * `providerKey: 'shopify_payments'` - and a context is built only once a
 * person has linked it to a `payment_gateway` record
 * (`listLinkedFeedAccounts`), never off the retired `settlementSource` enum.
 * Nothing linked is nothing to poll: a payout with no rail has no bank account
 * to debit (§5.4) and an org that has not linked a Shopify rail never asked
 * for its payouts.
 *
 * ## The scope
 *
 * The app's tools refuse before any HTTP when the store's recorded grant lacks
 * `read_shopify_payments_payouts`. That refusal reaches this file as an error
 * carrying `code: 'INSUFFICIENT_PERMISSIONS'`, and is rethrown as ONE sentence
 * naming the scope and the remedy; `syncPayouts` catches it per context and
 * lands it in `result.failed`, so a store that has not re-consented never stops
 * the rail behind it.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, eq, isNull } from 'drizzle-orm'
import { type AppToolContext, resolveAppToolContext } from '../../../../apps/invoke-app-tool'
import { BadRequestError, ForbiddenError, UnprocessableEntityError } from '../../../../errors'
import type { PaymentGatewayRow } from '../../../rails/client'
import { listLinkedFeedAccounts } from '../reads'
import type { PayoutHeader, PayoutItem, PayoutSource, PayoutSourceCtx } from '../source'

const logger = createScopedLogger('payouts:shopify-payments')

/** The registry id, and the `providerKey` a linked feed carries for this rail. */
export const SHOPIFY_PAYMENTS_SOURCE_ID = 'shopify_payments' as const

/** The installed app whose tools read Shopify Payments. */
export const SHOPIFY_APP_SLUG = 'shopify'
const SHOPIFY_APP_LABEL = 'Shopify'

/** The Admin API scope the two tools need; the platform asks for it in `connections/providers/defs.ts`. */
export const SHOPIFY_PAYMENTS_PAYOUTS_SCOPE = 'read_shopify_payments_payouts'

const LIST_PAYOUTS_TOOL = 'list_shopify_payouts'
const LIST_PAYOUT_TRANSACTIONS_TOOL = 'list_shopify_payout_transactions'

/** Shopify's payout `status` vocabulary, as the app's `payments-api.ts` projects it. */
type ShopifyPayoutStatus = 'scheduled' | 'in_transit' | 'paid' | 'failed' | 'canceled'

/** `list_shopify_payouts` output row (`PayoutRecord` in the apps repo), the fields this source reads. */
interface ShopifyPayoutRecord {
  id: string
  status: ShopifyPayoutStatus
  /** YYYY-MM-DD */
  date: string
  currency: string
  /** The deposit, integer minor units, transcribed by the app from Shopify's decimal string. */
  amountMinor: number
}

/** `list_shopify_payout_transactions` output row (`PayoutTransactionRecord` in the apps repo). */
interface ShopifyPayoutTransactionRecord {
  id: string
  type: string
  /** Gross, integer minor units. Negative for a refund or dispute. */
  amountMinor: number
  feeMinor: number
  /** Same numeric keyspace as REST `Order.id`, already stringified by the app. */
  sourceOrderId: string | null
}

/** The context handle: the resolved app-tool context, narrowed to what this source calls. */
type ShopifyPayoutsHandle = Pick<AppToolContext, 'callTool'>

function handleOf(ctx: PayoutSourceCtx): ShopifyPayoutsHandle {
  const handle = ctx.handle as Partial<ShopifyPayoutsHandle> | null | undefined
  if (!handle || typeof handle.callTool !== 'function') {
    throw new BadRequestError(
      'The Shopify Payments payout source needs a resolved Shopify app tool context as its handle',
      { organizationId: ctx.organizationId }
    )
  }
  return { callTool: handle.callTool }
}

/**
 * Every org with a live Shopify app installation: one row per installed store,
 * so a scan of a few hundred rows. Whether the store is connected and whether
 * a rail claims the stream is decided per org in {@link resolveContexts}, where
 * the rail records have already been read once and the connection resolution
 * is paid for only when a rail exists.
 */
async function listOrganizations(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ organizationId: schema.AppInstallation.organizationId })
    .from(schema.AppInstallation)
    .innerJoin(schema.App, eq(schema.App.id, schema.AppInstallation.appId))
    .where(and(eq(schema.App.slug, SHOPIFY_APP_SLUG), isNull(schema.AppInstallation.uninstalledAt)))
  return rows.map((row) => row.organizationId)
}

/**
 * One context per linked feed, when the Shopify app is installed with a
 * connection. The linked feeds are checked FIRST, off the org's own
 * `FinancialSourceAccount` rows, so an org that has not linked a Shopify rail
 * never pays for the installation/deployment/connection resolution.
 */
async function resolveContexts(
  db: Database,
  organizationId: string,
  rails: readonly PaymentGatewayRow[]
): Promise<PayoutSourceCtx[]> {
  const linked = await listLinkedFeedAccounts(db, organizationId, SHOPIFY_PAYMENTS_SOURCE_ID)
  if (linked.length === 0) return []

  const resolved = await resolveAppToolContext({
    organizationId,
    appSlug: SHOPIFY_APP_SLUG,
    appLabel: SHOPIFY_APP_LABEL,
  })
  if (!resolved.connected) {
    logger.info('A Shopify Payments rail is linked but the Shopify app is not connected', {
      organizationId,
      paymentGatewayIds: linked.map((feed) => feed.paymentGatewayId),
    })
    return []
  }

  const contexts: PayoutSourceCtx[] = []
  for (const feed of linked) {
    const rail = rails.find((row) => row.id === feed.paymentGatewayId)
    if (!rail) continue
    contexts.push({
      organizationId,
      sourceId: SHOPIFY_PAYMENTS_SOURCE_ID,
      rail,
      handle: resolved.context,
    })
  }
  return contexts
}

/** Every payout dated on or after `since`, oldest first (the tool sorts by date, then id). */
async function listPayouts(ctx: PayoutSourceCtx, since: Date): Promise<PayoutHeader[]> {
  const output = await callShopifyTool(ctx, LIST_PAYOUTS_TOOL, { since: toDateKey(since) })
  const payouts = collectionOf<ShopifyPayoutRecord>(output, 'payouts', LIST_PAYOUTS_TOOL)
  return payouts.map(toHeader)
}

/**
 * Every balance transaction inside one payout, reduced to {@link PayoutItem}.
 * The tool has already paged to exhaustion and refused any row from another
 * payout, so nothing here is a page.
 */
async function listItems(ctx: PayoutSourceCtx, payout: PayoutHeader): Promise<PayoutItem[]> {
  const output = await callShopifyTool(ctx, LIST_PAYOUT_TRANSACTIONS_TOOL, {
    payoutId: payout.providerPayoutId,
  })
  const transactions = collectionOf<ShopifyPayoutTransactionRecord>(
    output,
    'transactions',
    LIST_PAYOUT_TRANSACTIONS_TOOL
  )

  const items: PayoutItem[] = []
  for (const txn of transactions) {
    // The payout itself is a balance transaction of type `payout`, with the
    // deposit as a negative amount. Counting it would net the unrecognised
    // side to zero and hide every item the split should have named; the Stripe
    // source skips the same row for the same reason. A `payout_failure` or
    // `payout_cancellation` row is NOT skipped: it is money returned to the
    // balance and re-settled by the payout that lists it, a real item that
    // holds no order and lands on the unrecognised side.
    if (txn.type === 'payout') continue
    items.push(toItem(txn))
  }
  return items
}

/** One Shopify payout as the pipeline sees it. `depositedMinor` is `amountMinor`, transcribed. */
export function toHeader(payout: ShopifyPayoutRecord): PayoutHeader {
  // No `destinationHint`: Shopify says nothing about the bank account a payout
  // reached, so the rail record has to (27 §6.3, decision 3 owed). Until it
  // does, `sync.ts` raises the record and blocks the entry naming this source.
  return {
    providerPayoutId: payout.id,
    paidAt: payout.date,
    currency: payout.currency.toLowerCase(),
    status: toHeaderStatus(payout.status),
    depositedMinor: payout.amountMinor,
  }
}

/**
 * Shopify's `scheduled` is a payout Shopify has dated but not yet sent, which
 * the pipeline treats exactly as `in_transit`: a record, no entry, until `paid`.
 */
export function toHeaderStatus(status: ShopifyPayoutStatus): PayoutHeader['status'] {
  switch (status) {
    case 'paid':
    case 'failed':
    case 'canceled':
    case 'in_transit':
      return status
    case 'scheduled':
      return 'in_transit'
    default: {
      // Fail closed: a status this build has never seen is money that has not
      // been shown to have landed, so it gets a record and no entry.
      const unknown: never = status
      logger.warn('Unknown Shopify payout status, treated as in transit', { status: unknown })
      return 'in_transit'
    }
  }
}

/** One balance transaction as a split item: the order it settled, or `none`. */
export function toItem(txn: ShopifyPayoutTransactionRecord): PayoutItem {
  return {
    externalId: txn.id,
    grossMinor: txn.amountMinor,
    // Shopify reports the fee as a positive number withheld; the entry wants
    // it positive too, and `direction` carries the sign.
    feeMinor: txn.feeMinor,
    ref: txn.sourceOrderId ? { kind: 'order', id: txn.sourceOrderId } : { kind: 'none' },
  }
}

/**
 * Call one Shopify app tool through the context's handle, turning the app's
 * missing-scope refusal into one sentence a person can act on. Every other
 * failure is rethrown as the app worded it.
 */
async function callShopifyTool(
  ctx: PayoutSourceCtx,
  toolId: string,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const { callTool } = handleOf(ctx)
  try {
    return await callTool(toolId, inputs)
  } catch (error) {
    const missingScopes = missingScopesOf(error)
    if (missingScopes) {
      throw new ForbiddenError(
        `Shopify has not granted ${missingScopes.join(', ')} for this store, so its payouts ` +
          'cannot be read. Reconnect the Shopify app to approve the scope; nothing else the ' +
          'app does is affected.',
        { organizationId: ctx.organizationId, paymentGatewayId: ctx.rail.id }
      )
    }
    throw error
  }
}

/**
 * The scopes an `INSUFFICIENT_PERMISSIONS` refusal named, or `null` when the
 * error is anything else. `details.requiredScopes` is what the Lambda forwards
 * off the SDK's `InsufficientPermissionsError`; a refusal that carries none is
 * still this source's one scope.
 */
function missingScopesOf(error: unknown): string[] | null {
  if (!error || typeof error !== 'object') return null
  const { code, details } = error as { code?: unknown; details?: unknown }
  if (code !== 'INSUFFICIENT_PERMISSIONS') return null
  const required = (details as { requiredScopes?: unknown } | undefined)?.requiredScopes
  if (Array.isArray(required) && required.length > 0 && required.every(isString)) {
    return required
  }
  return [SHOPIFY_PAYMENTS_PAYOUTS_SCOPE]
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** The named collection off a tool's output, or a refusal: a missing list is a wrong read, not an empty one. */
function collectionOf<T>(output: unknown, key: string, toolId: string): T[] {
  const collection = (output as Record<string, unknown> | null | undefined)?.[key]
  if (!Array.isArray(collection)) {
    throw new UnprocessableEntityError(
      `Shopify tool ${toolId} returned no "${key}" collection, so the payouts cannot be read`
    )
  }
  return collection as T[]
}

/** The Shopify Payments source, registered by `money/payout-sources.ts`. */
export const SHOPIFY_PAYMENTS_PAYOUT_SOURCE: PayoutSource = {
  id: SHOPIFY_PAYMENTS_SOURCE_ID,
  kind: 'api',
  listOrganizations,
  resolveContexts,
  listPayouts,
  listItems,
}
