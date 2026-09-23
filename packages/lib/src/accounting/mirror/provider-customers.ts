// packages/lib/src/accounting/mirror/provider-customers.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'

/** The identity key each provider's app writes its customer id under (`identity-field.ts`). */
const CUSTOMER_ID_FIELD_KEY: Record<string, string> = { quickbooks: 'qboCustomerId' }

/**
 * `providerCustomerId -> contact id` for the customers our contacts are linked to, in one read
 * of `RecordIdentity`. A customer created in the provider with no contact of ours is absent.
 */
export async function resolveProviderCustomers(
  db: Database,
  organizationId: string,
  providerId: string,
  providerCustomerIds: readonly string[]
): Promise<Map<string, string>> {
  const byCustomer = new Map<string, string>()
  const appFieldKey = CUSTOMER_ID_FIELD_KEY[providerId]
  if (!appFieldKey || providerCustomerIds.length === 0) return byCustomer
  const contactDefId = await getCachedEntityDefId(organizationId, 'contact')
  if (!contactDefId) return byCustomer

  const rows = await db
    .select({
      externalId: schema.RecordIdentity.externalId,
      entityInstanceId: schema.RecordIdentity.entityInstanceId,
    })
    .from(schema.RecordIdentity)
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        eq(schema.RecordIdentity.entityDefinitionId, contactDefId),
        eq(schema.RecordIdentity.source, providerId),
        eq(schema.RecordIdentity.appFieldKey, appFieldKey),
        inArray(schema.RecordIdentity.externalId, [...new Set(providerCustomerIds)])
      )
    )
  for (const row of rows) {
    if (row.externalId && !byCustomer.has(row.externalId))
      byCustomer.set(row.externalId, row.entityInstanceId)
  }
  return byCustomer
}
