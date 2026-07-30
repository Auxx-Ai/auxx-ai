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
  // **The route gate is `hasDefPresence`** (plan v3/03 §6.1, P5), not
  // `canViewEntity`: a member who was shared individual records of this
  // definition must be able to open its page. What they see there is scoped per
  // row in SQL (`recordVisibilityScope` arm 3), so the page renders exactly the
  // rows they hold and nothing else — while a member with neither def access nor
  // any grant still lands on `NoAccess`.
  const { hasDefPresence } = useAccess()

  if (isLoading) return null
  if (resource && !hasDefPresence(resource.entityDefinitionId)) {
    return <NoAccess area={resource.plural} />
  }

  return children
}
