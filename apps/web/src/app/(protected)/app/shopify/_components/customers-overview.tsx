'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { SyncShopifyButton } from '~/app/(protected)/app/shopify/_components/sync-button'
// import { ProductNav } from './product-nav'
import { DataTable } from '~/components/data-table/data-table'
import useCustomers from '~/hooks/use-customers'
import { columns } from './customers-columns'

type Props = {}

export function CustomersOverview({}: Props) {
  // const customers = z.array(customerSchema).parse(SAMPLE_CUSTOMERS)
  const { customers, isFetching, fetchNextPage, hasNextPage } = useCustomers()
  return (
    <MainPage>
      <MainPageHeader action={<SyncShopifyButton type='customers' label='Sync Customers' />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Shopify' href='/app/shopify' />
          <MainPageBreadcrumbItem title='Customers' href='/app/shopify/customers' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <DataTable
          id='customers'
          data={customers}
          columns={columns}
          label='customers'
          isFetching={isFetching}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}
        />
      </MainPageContent>
    </MainPage>
  )
}
