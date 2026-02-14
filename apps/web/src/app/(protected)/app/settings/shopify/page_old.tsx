import { Badge } from '@auxx/ui/components/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { differenceInSeconds, format } from 'date-fns'
import { headers } from 'next/headers'
import { auth } from '~/auth/server'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/server'
import { SyncShopifyButton } from '../../shopify/_components/sync-button'
import AutoSyncSwitch from './_components/auto-sync-switch'

type Props = {}

export default async function ShopifyIntegrationPage({}: Props) {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session?.user.id

  const { data } = await api.syncHistory.getAll({ provider: 'shopify' })

  const settings = await api.user.settings()

  const syncHistory = data
  const breadcrumbs = [
    { title: 'Settings', href: `/app/settings` },
    // { title: 'Integrations', href: `/app/settings/integrations` },
    { title: 'Shopify Integration' },
  ]
  // const syncHistory = [
  //   {
  //     id: '1',
  //     type: 'shopify_sync_products',
  //     startTime: '2025-03-07T06:01:51.402Z',
  //     endTime: '2025-03-07T06:01:54.527Z',
  //     status: 'COMPLETED',
  //   },
  // ]
  return (
    <SettingsPage
      title='Shopify Integration'
      description='Sync with shopify and see your sync history .'
      breadcrumbs={breadcrumbs}>
      <div className='pb-10'>
        <h3 className='mb-2 text-lg font-medium'>Sync Settings</h3>
        <div className='space-y-5'>
          <div className='flex flex-row items-center justify-between rounded-lg border p-4'>
            <div className='space-y-0.5'>
              <div className='text-base text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                Sync Products
              </div>
              <div className='text-[0.8rem] text-muted-foreground'>
                Keep all your products in sync.
              </div>
            </div>
            <div>
              <SyncShopifyButton type='products' label='Sync Products' />
            </div>
          </div>
          <div className='flex flex-row items-center justify-between rounded-lg border p-4'>
            <div className='space-y-0.5'>
              <div className='text-base text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                Sync Customers
              </div>
              <div className='text-[0.8rem] text-muted-foreground'>Force Sync your customers</div>
            </div>
            <div>
              <SyncShopifyButton type='customers' label='Sync Customers' />
            </div>
          </div>
          <div className='flex flex-row items-center justify-between rounded-lg border p-4'>
            <div className='space-y-0.5'>
              <div className='text-base text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                Sync Orders
              </div>
              <div className='text-[0.8rem] text-muted-foreground'>Force Sync your orders</div>
            </div>
            <div>
              <SyncShopifyButton type='orders' label='Sync Orders' />
            </div>
          </div>

          <div className='flex flex-row items-center justify-between rounded-lg border p-3 shadow-xs'>
            <div className='space-y-0.5'>
              <div className='text-base text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                Auto Sync
              </div>
              <div className='text-[0.8rem] text-muted-foreground'>
                Automatically sync your data with your shopify store.
              </div>
            </div>
            <AutoSyncSwitch settings={settings} />
          </div>
        </div>
      </div>
      <div className=''>
        <h3 className='mb-2 text-lg font-medium'>Sync History</h3>

        <div className='rounded-md border'>
          {syncHistory.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[200px]'>Name</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className=''>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncHistory.map((history) => (
                  <TableRow key={history.id}>
                    <TableCell className='w-[300px] font-medium'>
                      <Badge variant='secondary'>{history.type}</Badge>
                    </TableCell>
                    <TableCell>{format(history.startTime, 'MM/dd/yyyy, h:mm a')}</TableCell>
                    <TableCell>
                      {differenceInSeconds(history.endTime, history.startTime)}s
                    </TableCell>

                    <TableCell className='font-bold'>{history.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className='p-4 text-muted-foreground'>No Sync history available.</div>
          )}
        </div>
      </div>
    </SettingsPage>
  )
}
