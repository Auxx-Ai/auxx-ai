// packages/lib/src/accounting/ledger/builders/source-facts-memo.ts

/** Long enough for every fact and a leg label; well inside any provider's line description. */
export const LINE_MEMO_MAX_LENGTH = 200

const SEPARATOR = ' · '

/** The source facts a channel entry already holds. Every one is optional; blanks are omitted. */
export interface SourceFacts {
  /** The order's own number - `ORD-0012`, or Shopify's `#14271`. */
  order?: string | null
  /** The gateway's or processor's transaction id. */
  transactionId?: string | null
  /** The gateway or rail - `shopify_payments`. */
  gateway?: string | null
  /** The sales channel - `web`, `pos`. */
  channel?: string | null
  /** The storefront's name. */
  store?: string | null
}

/**
 * Render one line memo from source facts, then the leg's own label:
 * `Order #14271 · txn 9599427084464 · shopify_payments · web · Auxx-Lift Store · deposited`.
 */
export function sourceFactsMemo(facts: SourceFacts, detail?: string | null): string {
  const clean = (value: string | null | undefined): string | undefined => {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  }
  const order = clean(facts.order)
  const transactionId = clean(facts.transactionId)
  const parts = [
    order ? `Order ${order}` : undefined,
    transactionId ? `txn ${transactionId}` : undefined,
    clean(facts.gateway),
    clean(facts.channel),
    clean(facts.store),
    clean(detail),
  ].filter((part): part is string => part !== undefined)
  return parts.join(SEPARATOR).slice(0, LINE_MEMO_MAX_LENGTH)
}
