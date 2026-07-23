// apps/web/src/components/records/entity-route-layout.tsx

'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { getIcon } from '@auxx/ui/components/icons'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MainPageTabs, type MainPageTabsItem } from '@auxx/ui/components/main-page-tabs'
import { ChartColumn } from 'lucide-react'
import type { ReactNode } from 'react'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { useResources } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

interface EntityRouteLayoutProps {
  /** Resource slug (entityDefinitionId or apiSlug), resolved via `useResources()`. */
  slug: string
  /** Base path for the entity's list route — the List tab href + breadcrumb href. */
  basePath: string
  /** Extra tabs appended after List | Dashboard (e.g. tickets' Settings tab). */
  extraTabs?: MainPageTabsItem[]
  children: ReactNode
}

/**
 * Shared route shell for entity list routes (tickets, companies, contacts,
 * `custom/[slug]`) — owns `MainPage` + `MainPageHeader` with the entity
 * breadcrumb and List | Dashboard (+ extra) tabs. The Dashboard tab is
 * feature-gated on `FeatureKey.dashboards`.
 *
 * `children` (`RecordsView`, `EntityDashboardPage`, ...) render only their
 * own `MainPageContent` and contribute header actions / breadcrumb tails via
 * `MainPageAction` / `MainPageCrumbs` — they never own the shell.
 *
 * While the resource is still resolving, the breadcrumb shows a neutral
 * title rather than mounting a second `MainPage` tree.
 */
export function EntityRouteLayout({
  slug,
  basePath,
  extraTabs = [],
  children,
}: EntityRouteLayoutProps) {
  const { getResourceById } = useResources()
  const { hasAccess } = useFeatureFlags()
  const { deniedBy } = useAccess()
  const resource = getResourceById(slug)
  const ResourceIcon = resource ? getIcon(resource.icon)?.icon : undefined

  // Layer-2 read gate for direct-URL hits (e.g. a field seat deep-linking
  // `/app/tickets`): tickets ride the `tickets.view` capability, every other
  // entity list rides `records.view`. A `'permission'` denial (nothing to buy)
  // renders the friendly NoAccess surface instead of an empty/broken shell;
  // plan denials fall through so the existing upgrade surfaces still show.
  const viewKey = slug === 'tickets' ? PermissionKey.ticketsView : PermissionKey.recordsView
  if (deniedBy(viewKey) === 'permission') {
    return <NoAccess area={resource?.plural ?? undefined} />
  }

  const items: MainPageTabsItem[] = [
    {
      value: 'list',
      label: resource?.plural ?? 'List',
      icon: ResourceIcon ? <ResourceIcon /> : undefined,
      href: basePath,
    },
    {
      value: 'dashboard',
      label: 'Dashboard',
      icon: <ChartColumn />,
      href: `${basePath}/dashboard`,
      hidden: !hasAccess(FeatureKey.dashboards),
    },
    ...extraTabs,
  ]

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title={resource?.plural ?? '...'} href={basePath} />
        </MainPageBreadcrumb>
        <MainPageTabs items={items} />
      </MainPageHeader>
      {children}
    </MainPage>
  )
}
