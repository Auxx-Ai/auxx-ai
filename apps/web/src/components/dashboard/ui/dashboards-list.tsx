// apps/web/src/components/dashboard/ui/dashboards-list.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import { LayoutDashboard, Search } from 'lucide-react'
import { useEffect } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useListSelection } from '~/components/list-selection'
import { CreateDashboardButton } from './create-dashboard-button'
import { DashboardCard } from './dashboard-card'
import { useDashboards } from './dashboards-provider'

export function DashboardsList() {
  const { dashboards, isLoading, searchQuery } = useDashboards()
  const setItemIds = useListSelection((s) => s.setItemIds)

  useEffect(() => {
    setItemIds(dashboards.map((d) => d.id))
  }, [dashboards, setItemIds])

  if (isLoading) {
    return (
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {[...Array(8)].map((_, i) => (
          <ListCard key={`skeleton-${i}`} loading descriptionLines={2} />
        ))}
      </div>
    )
  }

  if (dashboards.length === 0) {
    return searchQuery ? (
      <EmptyState
        icon={Search}
        title='No dashboards found'
        description='No dashboards match your search. Try a different term.'
        button={<div className='h-12' />}
      />
    ) : (
      <EmptyState
        icon={LayoutDashboard}
        title='No dashboards yet'
        description='Create your first dashboard to visualize your data.'
        button={<CreateDashboardButton />}
      />
    )
  }

  return (
    <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {dashboards.map((d) => (
        <DashboardCard key={d.id} dashboard={d} />
      ))}
    </div>
  )
}
