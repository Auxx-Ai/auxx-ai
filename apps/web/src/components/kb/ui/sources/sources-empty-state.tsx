// apps/web/src/components/kb/ui/sources/sources-empty-state.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Globe } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { useAccess } from '~/providers/capabilities-provider'
import { ConnectSourceButton } from './connect-source-button'
import { useSources } from './sources-provider'

/** Empty state for the Sources tab — distinguishes "no matches" from "no sources yet". */
export function SourcesEmptyState() {
  const { searchQuery, selectedStatus } = useSources()
  const { can } = useAccess()
  const canConnect = can(PermissionKey.knowledgeBaseEdit)
  const hasFilters = !!searchQuery || selectedStatus !== 'all'

  if (hasFilters) {
    return (
      <EmptyState
        icon={Globe}
        title='No sources found'
        description='Try adjusting your search or status filter.'
      />
    )
  }

  return (
    <EmptyState
      icon={Globe}
      title='No sources yet'
      description={
        canConnect
          ? 'Connect a website or other content source to keep a knowledge base in sync.'
          : 'No content sources have been connected yet. Ask an admin to add one.'
      }
      button={canConnect ? <ConnectSourceButton variant='outline' /> : undefined}
    />
  )
}
