import React from 'react'
import { ProductsOverview } from '../_components/products-overview'
import { api } from '~/trpc/server'
import NoShopifyIntegration from '../_components/no-shopify-integration'

async function ProductsPage() {
  const data = await api.shopify.hasIntegration()
  if (!data.hasIntegration) {
    return <NoShopifyIntegration />
  }

  return <ProductsOverview />
}

export default ProductsPage
