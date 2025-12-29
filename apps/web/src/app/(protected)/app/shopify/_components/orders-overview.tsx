'use client'
import React from 'react'

// import { ProductNav } from './products/product-nav'
// import { DataTable } from '../data-table/data-table'
import { z } from 'zod'
import { orderSchema } from './schema'
import { columns } from './orders-columns'
import { DataTable } from '~/components/data-table/data-table'
import { SyncShopifyButton } from '~/app/(protected)/app/shopify/_components/sync-button'
import useOrders from '~/hooks/use-orders'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'

type Props = {}

export function OrdersOverview({}: Props) {
  // const orders = z.array(orderSchema).parse(SAMPLE_ORDERS)
  const { orders, isFetching, fetchNextPage, hasNextPage } = useOrders()

  return (
    <MainPage>
      <MainPageHeader action={<SyncShopifyButton type="orders" label="Sync Orders" />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title="Shopify" href="/app/shopify" />
          <MainPageBreadcrumbItem title="Orders" href="/app/shopify/orders" last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <DataTable
          id="orders"
          data={orders}
          columns={columns}
          label="orders"
          isFetching={isFetching}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}>
          {/* <DataTableToolbar label='product' /> */}
        </DataTable>
      </MainPageContent>
    </MainPage>
  )
}
