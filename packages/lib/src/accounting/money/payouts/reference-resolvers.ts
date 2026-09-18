// packages/lib/src/accounting/money/payouts/reference-resolvers.ts

/**
 * The per-provider seam for feeds whose items name a payment id rather than the
 * storefront transaction (`plans/accounting/payout-links.md` §7).
 *
 * Keyed on `FinancialSourceAccount.providerKey`, because both ingest lanes carry
 * it and the `PayoutSource` contract is unreachable for Affirm. Nothing is
 * registered: no Affirm or Stripe-as-gateway feed exists to verify an
 * implementation against, and a `providerKey` with no resolver is the visible
 * absence `no_reference` names.
 */

import type { Database, Transaction } from '@auxx/database'
import type { z } from 'zod'
import type { financialSourceReferenceSchema } from '../customer-money/record-contracts'

export type FinancialSourceReference = z.infer<typeof financialSourceReferenceSchema>

/** One item the matcher cannot key, handed to a resolver to name. */
export interface UnreferencedEntry {
  id: string
  sourceAccountId: string
  type: string
  /** The provider's own id for the payment behind the item, when it carries one. */
  sourceTransactionId: string | null
  sourceId: string | null
  sourceOrderId: string | null
}

/** Turns a feed's own item identifiers into the reference a receipt is filed under. */
export interface EntryReferenceResolver {
  readonly providerKey: string
  resolve(
    db: Database | Transaction,
    organizationId: string,
    entries: readonly UnreferencedEntry[]
  ): Promise<Map<string, FinancialSourceReference>>
}

const registry = new Map<string, EntryReferenceResolver>()

/** Register one resolver. Last registration for a `providerKey` wins, as the source registry does. */
export function registerEntryReferenceResolver(resolver: EntryReferenceResolver): void {
  registry.set(resolver.providerKey, resolver)
}

export function getEntryReferenceResolver(providerKey: string): EntryReferenceResolver | undefined {
  return registry.get(providerKey)
}

export function listEntryReferenceResolvers(): EntryReferenceResolver[] {
  return [...registry.values()]
}

/**
 * Resolve references for entries grouped by their feed's `providerKey`.
 *
 * A group with no resolver contributes nothing, so its entries stay unreferenced
 * and the caller writes `no_reference`. A resolver that throws is not caught
 * here: a broken resolver must not silently look like an absent one.
 */
export async function resolveEntryReferences(
  db: Database | Transaction,
  organizationId: string,
  byProviderKey: ReadonlyMap<string, readonly UnreferencedEntry[]>
): Promise<Map<string, FinancialSourceReference>> {
  const resolved = new Map<string, FinancialSourceReference>()
  for (const [providerKey, entries] of byProviderKey) {
    const resolver = registry.get(providerKey)
    if (!resolver || !entries.length) continue
    for (const [entryId, reference] of await resolver.resolve(db, organizationId, entries))
      resolved.set(entryId, reference)
  }
  return resolved
}
