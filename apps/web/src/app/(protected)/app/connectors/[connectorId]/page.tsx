// apps/web/src/app/(protected)/app/connectors/[connectorId]/page.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { AlertTriangle, Lock } from 'lucide-react'
import { use } from 'react'
import { ConnectorDetailView } from '~/components/data-connectors/ui/connector-detail-view'
import { EmptyState } from '~/components/global/empty-state'
import { MainPageLoading, MainPageNotFound } from '~/components/global/main-page-states'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

interface ConnectorDetailPageProps {
  params: Promise<{ connectorId: string }>
}

/**
 * Connector detail view — the single page serving both first-time setup and
 * ongoing editing (connection, streams, mappings, schedule, runs).
 * See plans/data-connectors/claude/05-frontend.md §2-6.
 */
export default function ConnectorDetailPage({ params }: ConnectorDetailPageProps) {
  const { connectorId } = use(params)
  const { can } = useAccess()
  const canManage = can(PermissionKey.connectorsManage)
  const connector = api.dataConnector.getById.useQuery({ id: connectorId }, { enabled: canManage })

  // Layer-2 permission gate: skip the (doomed) query and show a denied state.
  if (!canManage) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='No Access to Connectors'
            description="You don't have permission to manage connectors. Ask an admin for access."
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  if (connector.isError || (!connector.isLoading && !connector.data)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
            <MainPageBreadcrumbItem title='Not found' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageNotFound
          icon={AlertTriangle}
          title='Connector not found'
          description='This connector does not exist or you do not have access to it.'
        />
      </MainPage>
    )
  }

  if (connector.isLoading || !connector.data) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
            <MainPageBreadcrumbItem title='Loading…' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageLoading />
      </MainPage>
    )
  }

  return <ConnectorDetailView connector={connector.data} />
}
