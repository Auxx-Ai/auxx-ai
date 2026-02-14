import { api } from '~/trpc/server'
import { CustomersOverview } from '../_components/customers-overview'
import NoShopifyIntegration from '../_components/no-shopify-integration'

async function CustomersPage() {
  const data = await api.shopify.hasIntegration()
  if (!data.hasIntegration) {
    return <NoShopifyIntegration />
  }
  return <CustomersOverview />
}

export default CustomersPage
