// apps/web/src/components/detail-view/components/app-record-actions.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Blocks, MoreHorizontal } from 'lucide-react'
import { useInternalAppsContext } from '~/components/apps/providers/internal-apps-context'
import { useSurfaces } from '~/components/apps/runtime/hooks/use-surfaces'
import type { RecordId } from '~/components/resources'

interface AppRecordActionsProps {
  /** Full record id (`<entityDefinitionId>:<entityInstanceId>`). */
  recordId: RecordId
  /** Entity slug of the record (e.g. `contact`, `ticket`). */
  recordType: string
  /** Icon-only trigger for tight headers like the record drawer. */
  compact?: boolean
}

/**
 * Renders record-action surfaces declared by installed apps in an overflow menu
 * on the detail-view header. Triggering an action posts to the app iframe via
 * `store.triggerSurface`; any `showDialog` the app opens is rendered globally by
 * `AppDialog`.
 *
 * v1 shows every installed app's record action on every record type — apps gate
 * applicability inside their own dialog. The overflow menu keeps N installed
 * apps from crowding the header.
 */
function useAppRecordActions({ recordId, recordType }: AppRecordActionsProps) {
  const { store } = useInternalAppsContext()
  const { data: actions } = useSurfaces({
    surfaceType: 'record-action',
    context: { recordId, recordType },
  })

  const trigger = (appId: string, appInstallationId: string, surfaceId: string) => {
    void store.triggerSurface({
      appId,
      appInstallationId,
      surfaceType: 'record-action',
      surfaceId,
      payload: { recordId, recordType },
    })
  }

  return { actions, trigger }
}

/** One app-declared record action as a menu row. */
function AppActionItem({
  surface,
  onSelect,
}: {
  surface: { id: string; label?: string; icon?: unknown }
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className='flex items-center gap-2'>
      {typeof surface.icon === 'string' && surface.icon.length <= 2 && <span>{surface.icon}</span>}
      <span className='truncate'>{surface.label ?? surface.id}</span>
    </DropdownMenuItem>
  )
}

/**
 * App actions as a SUBMENU of a caller-owned dropdown (`RecordActionsMenu`).
 *
 * Deliberately renders a DISABLED branch when no installed app declares a
 * record action, where {@link AppRecordActions} returns `null` — same reasoning
 * as `WorkflowSubMenu`. On a stock org that standalone "… More" button
 * simply never appeared, so nothing on this surface ever told a user that apps
 * can contribute actions here at all.
 */
export function AppRecordActionsSubmenu({ recordId, recordType }: AppRecordActionsProps) {
  const { actions, trigger } = useAppRecordActions({ recordId, recordType })

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={actions.length === 0}>
        <Blocks />
        App actions
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='w-56'>
        {actions.map(({ surface, appId, appInstallationId }) => (
          <AppActionItem
            key={`${appId}:${appInstallationId}:${surface.id}`}
            surface={surface}
            onSelect={() => trigger(appId, appInstallationId, surface.id)}
          />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function AppRecordActions({ recordId, recordType, compact }: AppRecordActionsProps) {
  const { actions, trigger: handleTrigger } = useAppRecordActions({ recordId, recordType })

  if (actions.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button variant='ghost' size='icon-xs' className='rounded-full' title='App actions'>
            <Blocks />
          </Button>
        ) : (
          <Button variant='outline' size='sm'>
            <MoreHorizontal /> More
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-56'>
        <DropdownMenuLabel>App actions</DropdownMenuLabel>
        {actions.map(({ surface, appId, appInstallationId }) => (
          <DropdownMenuItem
            key={`${appId}:${appInstallationId}:${surface.id}`}
            onSelect={() => handleTrigger(appId, appInstallationId, surface.id)}
            className='flex items-center gap-2'>
            {typeof surface.icon === 'string' && surface.icon.length <= 2 && (
              <span>{surface.icon}</span>
            )}
            <span className='truncate'>{surface.label ?? surface.id}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
