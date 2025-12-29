// app/(protected)/app/settings/plans/invoices/page.tsx
import { Suspense } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { InvoiceList } from '~/components/subscriptions/invoice-list'
import { Skeleton } from '@auxx/ui/components/skeleton'

export default function InvoicesPage() {
  return (
    <SettingsPage
      title="Invoices"
      description="View and download your invoices"
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Plans', href: '/app/settings/plans' },
        { title: 'Invoices' },
      ]}>
      <div className="flex-1 h-full flex flex-col">
        <Suspense fallback={<InvoiceListSkeleton />}>
          <InvoiceList />
        </Suspense>
      </div>
    </SettingsPage>
  )
}

function InvoiceListSkeleton() {
  return (
    <div className="rounded-lg border p-6">
      <div className="mb-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full align-middle">
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead>
                <tr>
                  <th scope="col" className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-32" />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-24" />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-24" />
                  </th>
                  <th scope="col" className="px-6 py-3 text-left">
                    <Skeleton className="h-4 w-20" />
                  </th>
                  <th scope="col" className="px-6 py-3 text-right">
                    <Skeleton className="ml-auto h-4 w-16" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {[1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Skeleton className="h-5 w-16" />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <Skeleton className="ml-auto h-9 w-9" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
