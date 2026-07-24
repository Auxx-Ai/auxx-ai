// apps/web/src/components/permissions/ui/grantee-list.tsx
'use client'

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

/**
 * Render the level picker for one editable grantee row. The neutral list is
 * agnostic to what "level" means — mail passes a `LensSelect`, instance-access
 * passes a Read/Write/Full select (§4, resolved open item #1).
 */
export type RenderPicker<TChoice extends string> = (args: {
  value: TChoice
  onChange: (choice: TChoice) => void
  disabled: boolean
}) => ReactNode

export interface GranteeListProps<TChoice extends string> {
  grants: Array<{ actorId: ActorId; choice: TChoice }>
  onGrant: (actorId: ActorId, choice: TChoice) => void
  onChange: (actorId: ActorId, choice: TChoice) => void
  onRevoke: (actorId: ActorId) => void
  /** The level picker rendered in each editable row's actions slot. */
  renderPicker: RenderPicker<TChoice>
  /** The muted label shown in place of the picker for locked rows. */
  renderLockedLabel: (choice: TChoice) => ReactNode
  /** Level assigned to a newly picked grantee (mail: `full`; instance: `view`). */
  defaultChoice: TChoice
  disabled?: boolean
  emptyHint?: string
  /**
   * Rows that render muted with a fixed level and no remove/change controls —
   * e.g. the inbox creator's Manager grant, so the list never lies.
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
 * avatar in the leading icon slot, their name as the title, and a pluggable
 * level picker plus a hover-revealed remove in the actions slot. Capped off by a
 * {@link GranteeAddButton} unless `hideAddButton` is set. Controlled and dumb —
 * persistence lives in the hosting surface's hook.
 *
 * Lifted out of `mail-permissions/ui` (was mail-`LensSelect`-specific) to a
 * neutral home with a pluggable picker so both mail and instance-access sharing
 * share one list component with two pickers.
 */
export function GranteeList<TChoice extends string>({
  grants,
  onGrant,
  onChange,
  onRevoke,
  renderPicker,
  renderLockedLabel,
  defaultChoice,
  disabled = false,
  emptyHint = 'Not shared with anyone yet.',
  lockedActorIds = [],
  hideAddButton = false,
}: GranteeListProps<TChoice>) {
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
            disabled={disabled}
            renderPicker={renderPicker}
            renderLockedLabel={renderLockedLabel}
            onChange={onChange}
            onRevoke={onRevoke}
          />
        ))
      )}

      {!hideAddButton && (
        <GranteeAddButton
          grants={grants}
          onGrant={onGrant}
          defaultChoice={defaultChoice}
          disabled={disabled}
        />
      )}
    </div>
  )
}

/**
 * The "Add people or groups" trigger — an `ActorPicker` that grants any newly
 * picked actor `defaultChoice`. Extracted so surfaces can host it apart from the
 * list (e.g. an inbox dialog's `Section` header `actions`). Pass `children` to
 * override the default ghost button.
 */
export function GranteeAddButton<TChoice extends string>({
  grants,
  onGrant,
  defaultChoice,
  disabled = false,
  children,
}: Pick<GranteeListProps<TChoice>, 'grants' | 'onGrant' | 'defaultChoice' | 'disabled'> & {
  children?: ReactNode
}) {
  const currentIds = useMemo(() => grants.map((g) => g.actorId), [grants])

  const handlePickerChange = (nextIds: ActorId[]) => {
    const existing = new Set(currentIds)
    for (const actorId of nextIds) {
      if (!existing.has(actorId)) onGrant(actorId, defaultChoice)
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
function GranteeRow<TChoice extends string>({
  actorId,
  choice,
  isLocked,
  disabled,
  renderPicker,
  renderLockedLabel,
  onChange,
  onRevoke,
}: {
  actorId: ActorId
  choice: TChoice
  isLocked: boolean
  disabled: boolean
  renderPicker: RenderPicker<TChoice>
  renderLockedLabel: (choice: TChoice) => ReactNode
  onChange: (actorId: ActorId, choice: TChoice) => void
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
          <span className='pr-2 text-muted-foreground text-xs'>{renderLockedLabel(choice)}</span>
        ) : (
          <>
            {renderPicker({
              value: choice,
              onChange: (next) => onChange(actorId, next),
              disabled,
            })}
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
