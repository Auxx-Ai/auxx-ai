import React from 'react'
import { OrdersOverview } from '../_components/orders-overview'
import { api } from '~/trpc/server'
import NoShopifyIntegration from '../_components/no-shopify-integration'

async function OrdersPage() {
  const data = await api.shopify.hasIntegration()
  if (!data.hasIntegration) {
    return <NoShopifyIntegration />
  }

  return <OrdersOverview />
}

export default OrdersPage
