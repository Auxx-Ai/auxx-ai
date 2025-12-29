import { ShopifyIntegrationModel } from '@auxx/database/models'

export async function isShopifyConnected(organizationId: string) {
  const model = new ShopifyIntegrationModel(organizationId)
  const res = await model.findEnabled()
  if (!res.ok) return false
  return !!res.value
}

export const extractShopifyId = (gid: string | null | number): number | null => {
  if (!gid || typeof gid === 'number') return null
  // Split the string by "/" and return the last segment
  return parseInt(gid.split('/').pop())
}
