// packages/lib/src/shopify/utils.ts
import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'

export async function isShopifyConnected(organizationId: string) {
  const [integration] = await db
    .select({ id: schema.ShopifyIntegration.id })
    .from(schema.ShopifyIntegration)
    .where(
      and(
        eq(schema.ShopifyIntegration.organizationId, organizationId),
        eq(schema.ShopifyIntegration.enabled, true)
      )
    )
    .limit(1)
  return !!integration
}

export const extractShopifyId = (gid: string | null | number): number | null => {
  if (!gid || typeof gid === 'number') return null
  // Split the string by "/" and return the last segment
  return parseInt(gid.split('/').pop(), 10)
}
