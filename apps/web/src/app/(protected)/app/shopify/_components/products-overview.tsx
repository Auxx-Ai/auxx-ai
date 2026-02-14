'use client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import React from 'react'
import { DataTable } from '~/components/data-table/data-table'
import useProducts from '~/hooks/use-products'
import { columns } from './products-columns'
import { Product } from './schema'
import { SyncShopifyButton } from './sync-button'

export function ProductsOverview() {
  const { products, isFetching, fetchNextPage, hasNextPage } = useProducts()

  return (
    <MainPage>
      <MainPageHeader action={<SyncShopifyButton type='products' label='Sync Products' />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Shopify' href='/app/shopify' />
          <MainPageBreadcrumbItem title='Products' href='/app/shopify/products' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <DataTable
          id='products'
          data={products}
          columns={columns}
          label='products'
          isFetching={isFetching}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}>
          {/* <DataTableToolbar label='product' /> */}
        </DataTable>
      </MainPageContent>
    </MainPage>
  )
}
