'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Laptop, Lock, Plus, RefreshCw, ShoppingBag, Store } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { ShopifyConnectDialog } from './_components/shopify-connect-dialog'
import { useShopifyIntegration } from './_components/use-shopify-integration'

const shopDomainSchema = z.object({
  shopDomain: z
    .string()
    .min(1, { error: 'Shop domain is required' })
    .regex(/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)?myshopify\.com$/, {
      error: 'Please enter a valid myshopify.com domain',
    }),
})

/** Integration data type from the API */
type ShopifyIntegration = { id: string; shopDomain: string; enabled: boolean; createdAt: Date }

/** Props for the ShopifyCardItem component */
interface ShopifyCardItemProps {
  integration: ShopifyIntegration
}

/**
 * Individual Shopify integration card component
 * Displays store information and provides action buttons
 */
function ShopifyCardItem({ integration }: ShopifyCardItemProps) {
  // Use the Shopify hook directly in the component
  const { isSyncing, handleToggle, handleSync, handleDeleteIntegration, ConfirmDialog } =
    useShopifyIntegration()
  return (
    <>
      <div className='w-full border-b'>
        <CardHeader>
          <CardTitle className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Store className='h-5 w-5' />
              {integration.shopDomain}
            </div>
            <div className='flex items-center text-sm'>
              <span
                className={`inline-block h-2 w-2 rounded-full ${integration.enabled ? 'bg-green-500' : 'bg-gray-400'} mr-2`}
              />
              {integration.enabled ? 'Active' : 'Inactive'}
            </div>
          </CardTitle>
          <CardDescription>
            Connected on {new Date(integration.createdAt).toLocaleDateString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-4'>
            <div className='flex items-center gap-2'>
              <ShoppingBag className='h-5 w-5 text-gray-500' />
              <span>Sync products, orders, and customers</span>
            </div>
            <div className='flex items-center gap-2'>
              <Laptop className='h-5 w-5 text-gray-500' />
              <span>Admin API access with webhooks for real-time updates</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className='flex flex-wrap justify-between gap-2'>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              onClick={() => handleToggle(integration.id, integration.enabled)}
              loading={isSyncing}
              loadingText={integration.enabled ? 'Disabling...' : 'Enabling...'}>
              {integration.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button
              variant='outline'
              onClick={() => handleSync(integration.id, 'products')}
              loading={isSyncing}
              loadingText='Syncing...'
              disabled={isSyncing || !integration.enabled}>
              Sync Products
            </Button>
            <Button
              variant='outline'
              onClick={() => handleSync(integration.id, 'orders')}
              loading={isSyncing}
              loadingText='Syncing...'
              disabled={isSyncing || !integration.enabled}>
              Sync Orders
            </Button>
            <Button
              variant='outline'
              onClick={() => handleSync(integration.id, 'customers')}
              loading={isSyncing}
              loadingText='Syncing...'
              disabled={isSyncing || !integration.enabled}>
              Sync Customers
            </Button>
          </div>
          <Button variant='destructive' onClick={() => handleDeleteIntegration(integration.id)}>
            Remove
          </Button>
        </CardFooter>
      </div>
      <ConfirmDialog />
    </>
  )
}

export default function ShopifyIntegrationPage() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const { hasAccess } = useFeatureFlags()
  const hasShopifyAccess = hasAccess(FeatureKey.shopify)

  // Use the custom Shopify hook
  const { integrations, isLoadingIntegrations, getAuthUrl } = useShopifyIntegration()

  // Form definition
  const form = useForm<z.infer<typeof shopDomainSchema>>({
    resolver: standardSchemaResolver(shopDomainSchema),
    defaultValues: { shopDomain: '' },
  })

  if (!hasShopifyAccess) {
    return (
      <SettingsPage
        title='Shopify Integration'
        description='Connect your Shopify store to sync products, orders, and inventory.'
        breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Shopify' }]}>
        <EmptyState
          icon={Lock}
          title='Shopify Integration Not Available'
          description={
            <>
              Shopify integration is not included in your current plan. Upgrade to connect your
              store.
            </>
          }
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title='Shopify Integration'
      description='Connect your Shopify store to sync products, orders, and inventory.'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Shopify' }]}
      button={
        <ShopifyConnectDialog getAuthUrl={getAuthUrl} open={isOpen} onOpenChange={setIsOpen} />
      }>
      {/* Connected Integrations */}
      {isLoadingIntegrations ? (
        <EmptyState
          icon={RefreshCw}
          iconClassName='animate-spin'
          title='Loading stores...'
          description={<>Hang on tight while we load your stores...</>}
          button={<div className='h-12'></div>}
        />
      ) : integrations && integrations.length > 0 ? (
        <div className=' gap-6'>
          {integrations.map((integration) => (
            <ShopifyCardItem key={integration.id} integration={integration} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Store}
          title='Connect your shopify store'
          description={
            <>
              The Shopify integration allows you to sync
              <br /> your products, orders, and customers.
            </>
          }
          button={
            <Button size='sm' variant='outline' onClick={() => setIsOpen(true)}>
              <Plus className='h-4 w-4' />
              Connect Store
            </Button>
          }
        />
      )}
    </SettingsPage>
  )
}
