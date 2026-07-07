// apps/web/src/components/mail-permissions/ui/grantee-list.tsx
'use client'

import type { LensChoice } from '@auxx/lib/permissions/visibility/client'
import { LENS_LABELS } from '@auxx/lib/permissions/visibility/client'
import type { ActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { Plus, X } from 'lucide-react'
import { useMemo } from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { LensSelect } from './lens-select'

export interface GranteeListProps {
  grants: Array<{ actorId: ActorId; choice: LensChoice }>
  onGrant: (actorId: ActorId, choice: LensChoice) => void
  onChangeLens: (actorId: ActorId, choice: LensChoice) => void
  onRevoke: (actorId: ActorId) => void
  /** Renders the Manager entry in each row's picker (inbox surface only). */
  includeManager?: boolean
  disabled?: boolean
  emptyHint?: string
  /**
   * Rows that render muted with a fixed level and no remove/change controls —
   * the inbox creator's Manager grant, so the list never lies.
   */
  lockedActorIds?: ActorId[]
}

/**
 * The reusable "who has access" list: `ActorBadge` + `LensSelect` rows with a
 * hover-revealed remove, and an ActorPicker "+ Add" trigger. Controlled and
 * dumb — persistence lives in the hosting surface's hook. New grantees
 * default to Full access.
 */
export function GranteeList({
  grants,
  onGrant,
  onChangeLens,
  onRevoke,
  includeManager = false,
  disabled = false,
  emptyHint = 'Not shared with anyone yet.',
  lockedActorIds = [],
}: GranteeListProps) {
  const currentIds = useMemo(() => grants.map((g) => g.actorId), [grants])
  const locked = useMemo(() => new Set(lockedActorIds), [lockedActorIds])

  const handlePickerChange = (nextIds: ActorId[]) => {
    const existing = new Set(currentIds)
    for (const actorId of nextIds) {
      if (!existing.has(actorId)) onGrant(actorId, 'full')
    }
  }

  return (
    <div className='space-y-1'>
      {grants.length === 0 ? (
        <div className='px-1 py-2 text-muted-foreground text-sm'>{emptyHint}</div>
      ) : (
        grants.map(({ actorId, choice }) => {
          const isLocked = locked.has(actorId)
          return (
            <div
              key={actorId}
              className='group flex items-center justify-between gap-2 rounded-lg px-1 py-0.5'>
              <ActorBadge actorId={actorId} className={isLocked ? 'opacity-70' : undefined} />
              <div className='flex items-center gap-1'>
                {isLocked ? (
                  <span className='pr-2 text-muted-foreground text-xs'>
                    {LENS_LABELS[choice].label}
                  </span>
                ) : (
                  <>
                    <LensSelect
                      value={choice}
                      onChange={(next) => onChangeLens(actorId, next)}
                      includeManager={includeManager}
                      disabled={disabled}
                      size='sm'
                      className='h-7 w-32 border-none shadow-none'
                    />
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-6 opacity-0 group-hover:opacity-100'
                      disabled={disabled}
                      aria-label='Remove access'
                      onClick={() => onRevoke(actorId)}>
                      <X />
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })
      )}

      <ActorPicker
        value={currentIds}
        onChange={handlePickerChange}
        target='both'
        multi
        excludeIds={currentIds}
        disabled={disabled}>
        <Button variant='ghost' size='sm' className='text-muted-foreground' disabled={disabled}>
          <Plus />
          Add people or groups
        </Button>
      </ActorPicker>
    </div>
  )
}
