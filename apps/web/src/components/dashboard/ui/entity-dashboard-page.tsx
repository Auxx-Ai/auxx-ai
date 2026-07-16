// apps/web/src/components/dashboard/ui/entity-dashboard-page.tsx
'use client'

// The shared entity-route dashboard surface (plan 02) — mounted by every entry
// point (tickets/contacts/companies dedicated routes, `/app/custom/[slug]`)
// with just an apiSlug. `api.dashboard.get`'s entity branch resolves the def
// server-side (`resolveEntityIdFromCache`); `null` means "no dashboard linked
// yet" — an empty-state signal, not an error. Feature-gated the same way
// `/app/dashboards` is: an org without `FeatureKey.dashboards` sees the locked
// state instead, regardless of which route got them here.

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { toastError } from '@auxx/ui/components/toast'
import { ChartColumn, Lock } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { LoadingSpinner } from '~/components/global/loading-content'
import { useResources } from '~/components/resources'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { DashboardDetailView } from './dashboard-detail-view'

export function EntityDashboardPage({ slug }: { slug: string }) {
  const { hasAccess } = useFeatureFlags()
  const utils = api.useUtils()
  const { getResourceById } = useResources()
  const resource = getResourceById(slug)

  // Tracks the dashboard this page itself just created, so the freshly-created
  // row drops straight into edit mode instead of view mode (plan 02 §b).
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null)

  const query = api.dashboard.get.useQuery({ slug }, { enabled: hasAccess(FeatureKey.dashboards) })

  const createDashboard = api.dashboard.create.useMutation({
    onSuccess: (created) => {
      setJustCreatedId(created.id)
      void utils.dashboard.get.invalidate({ slug })
    },
    onError: (error) => {
      // A concurrent create racing to the same entity 409s — the dashboard now
      // exists either way, so just refetch; that's not a failure worth a toast.
      if (error.data?.code !== 'CONFLICT') {
        toastError({ title: 'Failed to create dashboard', description: error.message })
      }
      void utils.dashboard.get.invalidate({ slug })
    },
  })

  if (!hasAccess(FeatureKey.dashboards)) {
    return (
      <MainPageContent>
        <EmptyState
          icon={Lock}
          title='Dashboards not available'
          description='Upgrade your plan to build dashboards.'
          button={<div className='h-12' />}
        />
      </MainPageContent>
    )
  }

  if (query.isLoading) {
    return (
      <MainPageContent>
        <LoadingSpinner />
      </MainPageContent>
    )
  }

  if (query.data) {
    return (
      <DashboardDetailView
        dashboard={query.data}
        variant='embedded'
        startInEditMode={query.data.id === justCreatedId}
      />
    )
  }

  const plural = resource?.plural?.toLowerCase() ?? 'records'
  return (
    <MainPageContent>
      <EmptyState
        icon={ChartColumn}
        title='No dashboard yet'
        description={`Create a dashboard to visualize your ${plural}.`}
        button={
          <Button
            onClick={() => {
              if (!resource) return
              createDashboard.mutate({
                name: `${resource.plural} Dashboard`,
                icon: { iconId: resource.icon, color: resource.color },
                entityDefinitionId: resource.id,
              })
            }}
            disabled={!resource}
            loading={createDashboard.isPending}
            loadingText='Creating...'>
            Create dashboard
          </Button>
        }
      />
    </MainPageContent>
  )
}
