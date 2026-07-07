// apps/web/src/components/mail-permissions/ui/grantee-list.tsx
'use client'

import type { LensChoice } from '@auxx/lib/permissions/visibility/client'
import { LENS_LABELS } from '@auxx/lib/permissions/visibility/client'
import type { ActorId } from '@auxx/types/actor'
import { parseActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Plus, Trash2, Users } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useActor } from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'
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
  /**
   * Hide the inline "Add people or groups" trigger — for surfaces that host
   * their own {@link GranteeAddButton} (e.g. the inbox dialog's Section header).
   */
  hideAddButton?: boolean
}

/**
 * The reusable "who has access" list: one `TreeRow` per grantee — the actor's
 * avatar in the leading icon slot, their name as the title, and a `LensSelect`
 * plus hover-revealed remove in the actions slot. Capped off by a
 * {@link GranteeAddButton} unless `hideAddButton` is set. Controlled and dumb —
 * persistence lives in the hosting surface's hook. New grantees default to Full
 * access.
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
  hideAddButton = false,
}: GranteeListProps) {
  const locked = useMemo(() => new Set(lockedActorIds), [lockedActorIds])

  return (
    <div className='space-y-0.5'>
      {grants.length === 0 ? (
        <EmptySection
          icon={<Users className='size-5' />}
          title='No one added yet'
          description={emptyHint}
        />
      ) : (
        grants.map(({ actorId, choice }) => (
          <GranteeRow
            key={actorId}
            actorId={actorId}
            choice={choice}
            isLocked={locked.has(actorId)}
            includeManager={includeManager}
            disabled={disabled}
            onChangeLens={onChangeLens}
            onRevoke={onRevoke}
          />
        ))
      )}

      {!hideAddButton && <GranteeAddButton grants={grants} onGrant={onGrant} disabled={disabled} />}
    </div>
  )
}

/**
 * The "Add people or groups" trigger — an `ActorPicker` that grants any newly
 * picked actor Full access. Extracted so surfaces can host it apart from the
 * list (e.g. an inbox dialog's `Section` header `actions`). Pass `children` to
 * override the default ghost button.
 */
export function GranteeAddButton({
  grants,
  onGrant,
  disabled = false,
  children,
}: Pick<GranteeListProps, 'grants' | 'onGrant' | 'disabled'> & { children?: ReactNode }) {
  const currentIds = useMemo(() => grants.map((g) => g.actorId), [grants])

  const handlePickerChange = (nextIds: ActorId[]) => {
    const existing = new Set(currentIds)
    for (const actorId of nextIds) {
      if (!existing.has(actorId)) onGrant(actorId, 'full')
    }
  }

  return (
    <ActorPicker
      value={currentIds}
      onChange={handlePickerChange}
      target='both'
      multi
      excludeIds={currentIds}
      disabled={disabled}>
      {children ?? (
        <Button variant='ghost' size='sm' className='text-muted-foreground' disabled={disabled}>
          <Plus />
          Add people or groups
        </Button>
      )}
    </ActorPicker>
  )
}

/** A single grantee row. Resolves the actor once for the avatar + name. */
function GranteeRow({
  actorId,
  choice,
  isLocked,
  includeManager,
  disabled,
  onChangeLens,
  onRevoke,
}: {
  actorId: ActorId
  choice: LensChoice
  isLocked: boolean
  includeManager: boolean
  disabled: boolean
  onChangeLens: (actorId: ActorId, choice: LensChoice) => void
  onRevoke: (actorId: ActorId) => void
}) {
  const { actor, isLoading, isNotFound } = useActor({ actorId })
  const type = actor?.type ?? parseActorId(actorId).type
  const showLoading = isLoading && !actor
  const name = isNotFound
    ? 'Unknown'
    : actor?.name || (actor?.type === 'user' && actor?.email) || 'Unknown'

  return (
    <TreeRow
      icon={<ActorAvatar type={type} avatarUrl={actor?.avatarUrl} />}
      title={showLoading ? <Skeleton className='h-4 w-24 rounded-full' /> : name}
      rowClassName={cn('bg-primary-50 hover:bg-primary-100', isLocked && 'opacity-70')}
      actions={
        isLocked ? (
          <span className='pr-2 text-muted-foreground text-xs'>{LENS_LABELS[choice].label}</span>
        ) : (
          <>
            <LensSelect
              value={choice}
              onChange={(next) => onChangeLens(actorId, next)}
              includeManager={includeManager}
              disabled={disabled}
              size='sm'
              variant='transparent'
              className='h-7 w-36'
            />
            <TreeRowButton
              variant='destructive'
              disabled={disabled}
              aria-label='Remove access'
              tooltipText='Remove access'
              onClick={() => onRevoke(actorId)}>
              <Trash2 />
            </TreeRowButton>
          </>
        )
      }
    />
  )
}
