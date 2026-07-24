// apps/web/src/components/records/record-route-guard.tsx
'use client'

import type { ReactNode } from 'react'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { useResource } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'

interface RecordRouteGuardProps {
  /** Resource slug, definition ID, or system type understood by `useResource`. */
  slug: string
  children: ReactNode
}

/**
 * Prevents a record route from mounting its query-owning children until the
 * resource is resolved, then renders an honest permission-denied surface when
 * the member cannot view that definition.
 */
export function RecordRouteGuard({ slug, children }: RecordRouteGuardProps) {
  const { resource, isLoading } = useResource(slug)
  const { canViewEntity } = useAccess()

  if (isLoading) return null
  if (resource && !canViewEntity(resource.entityDefinitionId)) {
    return <NoAccess area={resource.plural} />
  }

  return children
}
