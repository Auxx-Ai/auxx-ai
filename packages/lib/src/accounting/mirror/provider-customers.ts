// packages/lib/src/accounting/mirror/provider-customers.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'

export type ProviderPartyKind = 'customer' | 'vendor'

/** Which of our records a provider party maps to, and the identity key its app writes the id under. */
const PARTY_IDENTITY: Record<
  ProviderPartyKind,
  { entitySlug: string; fieldKeyByProvider: Record<string, string> }
> = {
  customer: { entitySlug: 'contact', fieldKeyByProvider: { quickbooks: 'qboCustomerId' } },
  vendor: { entitySlug: 'company', fieldKeyByProvider: { quickbooks: 'qboVendorId' } },
}

/**
 * `providerPartyId -> our record id` for the parties our records are linked to, in one read of
 * `RecordIdentity`. A party created in the provider with no record of ours is absent.
 */
export async function resolveProviderParties(
  db: Database,
  organizationId: string,
  providerId: string,
  kind: ProviderPartyKind,
  providerPartyIds: readonly string[]
): Promise<Map<string, string>> {
  const byParty = new Map<string, string>()
  const identity = PARTY_IDENTITY[kind]
  const appFieldKey = identity.fieldKeyByProvider[providerId]
  if (!appFieldKey || providerPartyIds.length === 0) return byParty
  const entityDefId = await getCachedEntityDefId(organizationId, identity.entitySlug)
  if (!entityDefId) return byParty

  const rows = await db
    .select({
      externalId: schema.RecordIdentity.externalId,
      entityInstanceId: schema.RecordIdentity.entityInstanceId,
    })
    .from(schema.RecordIdentity)
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        eq(schema.RecordIdentity.entityDefinitionId, entityDefId),
        eq(schema.RecordIdentity.source, providerId),
        eq(schema.RecordIdentity.appFieldKey, appFieldKey),
        inArray(schema.RecordIdentity.externalId, [...new Set(providerPartyIds)])
      )
    )
  for (const row of rows) {
    if (row.externalId && !byParty.has(row.externalId))
      byParty.set(row.externalId, row.entityInstanceId)
  }
  return byParty
}

/** `providerCustomerId -> contact id`; see {@link resolveProviderParties}. */
export function resolveProviderCustomers(
  db: Database,
  organizationId: string,
  providerId: string,
  providerCustomerIds: readonly string[]
): Promise<Map<string, string>> {
  return resolveProviderParties(db, organizationId, providerId, 'customer', providerCustomerIds)
}
