// apps/web/src/components/detail-view/components/app-record-actions.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Blocks, MoreHorizontal } from 'lucide-react'
import type { RecordId } from '~/components/resources'
import { useSurfaces } from '~/lib/extensions/use-surfaces'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

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
 * `ExtensionDialog`.
 *
 * v1 shows every installed app's record action on every record type — apps gate
 * applicability inside their own dialog. The overflow menu keeps N installed
 * apps from crowding the header.
 */
export function AppRecordActions({ recordId, recordType, compact }: AppRecordActionsProps) {
  const { store } = useInternalAppsContext()
  const { data: actions } = useSurfaces({
    surfaceType: 'record-action',
    context: { recordId, recordType },
  })

  if (actions.length === 0) return null

  const handleTrigger = (appId: string, appInstallationId: string, surfaceId: string) => {
    void store.triggerSurface({
      appId,
      appInstallationId,
      surfaceType: 'record-action',
      surfaceId,
      payload: { recordId, recordType },
    })
  }

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
