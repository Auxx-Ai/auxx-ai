import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { ShopifyIcon } from '~/constants/icons'

type Props = {}

function NoShopifyIntegration({}: Props) {
  return (
    <EmptyState
      icon={ShopifyIcon}
      title='No Shopify integration'
      description={
        <div className='max-w-sm'>
          Connect your Shopify account to sync customers, orders, and products.
        </div>
      }
      button={
        <Link href='/app/settings/shopify'>
          <Button size='sm' variant='outline'>
            <Plus className='h-4 w-4' />
            Connect Shopify
          </Button>
        </Link>
      }
    />
  )
}

export default NoShopifyIntegration
