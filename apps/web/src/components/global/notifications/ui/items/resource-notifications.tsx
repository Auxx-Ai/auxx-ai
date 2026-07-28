// apps/web/src/components/global/notifications/ui/items/resource-notifications.tsx
'use client'

import { Book, Database, LayoutDashboard, Workflow } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useFavoriteDashboard } from '~/components/favorites/hooks/use-favorite-dashboard'
import { useFavoriteDataset } from '~/components/favorites/hooks/use-favorite-dataset'
import { useFavoriteKnowledgeBase } from '~/components/favorites/hooks/use-favorite-knowledge-base'
import { useFavoriteWorkflow } from '~/components/favorites/hooks/use-favorite-workflow'
import { getNotificationCopy } from '../../copy/notification-copy'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRow, NotificationRowSkeleton } from '../notification-row'
import type { NotificationItemProps } from './item-props'
import { UnavailableNotification } from './static-notification'

export function DatasetNotification(props: NotificationItemProps<'DATASET'>) {
  const { notification } = props
  const { dataset, isLoading, isNotFound } = useFavoriteDataset(notification.targetIds.datasetId)
  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !dataset) return <NotificationRowSkeleton />
  const datasetName = (dataset as { name?: string }).name ?? 'Untitled dataset'
  return (
    <ResourceRow
      {...props}
      icon={<Database className='size-4' />}
      fallbackSubtitle={datasetName}
      href={`/app/datasets/${notification.targetIds.datasetId}`}
    />
  )
}

export function KnowledgeBaseNotification(props: NotificationItemProps<'KNOWLEDGE_BASE'>) {
  const { notification } = props
  const { knowledgeBase, isLoading, isNotFound } = useFavoriteKnowledgeBase(
    notification.targetIds.knowledgeBaseId
  )
  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !knowledgeBase) return <NotificationRowSkeleton />
  return (
    <ResourceRow
      {...props}
      icon={<Book className='size-4' />}
      fallbackSubtitle={knowledgeBase.name}
      href={`/app/kb/${knowledgeBase.id}/editor?panel=articles`}
    />
  )
}

export function DashboardNotification(props: NotificationItemProps<'DASHBOARD'>) {
  const { notification } = props
  const { dashboard, isLoading, isNotFound } = useFavoriteDashboard(
    notification.targetIds.dashboardId
  )
  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !dashboard) return <NotificationRowSkeleton />
  return (
    <ResourceRow
      {...props}
      icon={<LayoutDashboard className='size-4' />}
      fallbackSubtitle={dashboard.name}
      href={`/app/dashboards/${dashboard.id}`}
    />
  )
}

/**
 * Workflow share notifications (plan 30 §3 — `workflow` is an instance-access
 * resource, so `resourceAccess.grantInstance` now emits `RESOURCE_SHARED` for it).
 *
 * `useFavoriteWorkflow` reads `api.workflow.getById`, which gates on the
 * `workflowsView` rung plus `assertViewInstance` — and the share itself derives
 * that rung for the grantee (handoff item 5b), so the member the share was
 * just granted to resolves the name. A later revoke drops them to the
 * Unavailable row, same as the other three types.
 */
export function WorkflowNotification(props: NotificationItemProps<'WORKFLOW'>) {
  const { notification } = props
  const { workflow, isLoading, isNotFound } = useFavoriteWorkflow(
    notification.targetIds.workflowAppId
  )
  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !workflow) return <NotificationRowSkeleton />
  return (
    <ResourceRow
      {...props}
      icon={<Workflow className='size-4' />}
      fallbackSubtitle={workflow.name}
      href={`/app/workflows/${workflow.id}`}
    />
  )
}

function ResourceRow<T extends 'DATASET' | 'KNOWLEDGE_BASE' | 'DASHBOARD' | 'WORKFLOW'>({
  notification,
  icon,
  fallbackSubtitle,
  href,
  onDelete,
  onRead,
}: NotificationItemProps<T> & {
  icon: React.ReactNode
  fallbackSubtitle: string | null
  href: string
}) {
  const router = useRouter()
  const close = useNotificationPanelStore((state) => state.close)
  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle ?? fallbackSubtitle}
      actor={notification.actor}
      icon={icon}
      onOpen={() => {
        router.push(href)
        close()
      }}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
