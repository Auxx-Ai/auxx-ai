// apps/web/src/app/(protected)/app/connectors/[connectorId]/page.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { AlertTriangle } from 'lucide-react'
import { use } from 'react'
import { ConnectorDetailView } from '~/components/data-connectors/ui/connector-detail-view'
import { EmptyState } from '~/components/global/empty-state'
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
  const connector = api.dataConnector.getById.useQuery({ id: connectorId })

  if (connector.isError || (!connector.isLoading && !connector.data)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
            <MainPageBreadcrumbItem title='Not found' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={AlertTriangle}
            title='Connector not found'
            description='This connector does not exist or you do not have access to it.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  if (connector.isLoading || !connector.data) {
    return (
      <MainPage loading>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Connectors' href='/app/connectors' />
            <MainPageBreadcrumbItem title='Loading…' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='h-full w-full animate-pulse bg-muted/20' />
        </MainPageContent>
      </MainPage>
    )
  }

  return <ConnectorDetailView connector={connector.data} />
}
