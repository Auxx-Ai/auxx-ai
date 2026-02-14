import React from 'react'
import { api } from '~/trpc/server'
import NoShopifyIntegration from '../_components/no-shopify-integration'
import { ProductsOverview } from '../_components/products-overview'

async function ProductsPage() {
  const data = await api.shopify.hasIntegration()
  if (!data.hasIntegration) {
    return <NoShopifyIntegration />
  }

  return <ProductsOverview />
}

export default ProductsPage
