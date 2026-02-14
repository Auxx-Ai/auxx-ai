import React from 'react'
import { api } from '~/trpc/server'
import NoShopifyIntegration from '../_components/no-shopify-integration'
import { OrdersOverview } from '../_components/orders-overview'

async function OrdersPage() {
  const data = await api.shopify.hasIntegration()
  if (!data.hasIntegration) {
    return <NoShopifyIntegration />
  }

  return <OrdersOverview />
}

export default OrdersPage
