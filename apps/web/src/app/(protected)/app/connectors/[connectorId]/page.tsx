// apps/web/src/app/(protected)/app/connectors/[connectorId]/page.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { AlertTriangle } from 'lucide-react'
import { use } from 'react'
import { ConnectorDetailView } from '~/components/data-connectors/ui/connector-detail-view'
import { MainPageLoading, MainPageNotFound } from '~/components/global/main-page-states'
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
