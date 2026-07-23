// apps/web/src/components/permissions/ui/grantee-overrides-tab.tsx
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { Folder, Plus, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useActor } from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'
import { usePermissionGrants } from '../hooks/use-permission-grants'
import { LeveledAreaGrid } from './leveled-area-grid'

type OverrideType = 'group' | 'user'

const COPY: Record<OverrideType, { add: string; empty: string; icon: typeof Users }> = {
  group: {
    add: 'Add group',
    empty: 'Grant a group more access than the member baseline.',
    icon: Folder,
  },
  user: {
    add: 'Add member',
    empty: 'Grant one member more access than the baseline or their groups.',
    icon: Users,
  },
}

/**
 * The raise-only override surface for one grantee kind (groups or users). Each
 * grantee gets a card with the full leveled grid, floored at the member baseline
 * — overrides can only *raise* access (Camp-1, v1.5 §L3). Clearing every raised
 * area removes the grant row. New grantees are added via the actor picker and
 * persist on their first raised area.
 */
export function GranteeOverridesTab({
  granteeType,
  disabled = false,
}: {
  granteeType: OverrideType
  disabled?: boolean
}) {
  const { isLoading, roleDefaults, effectiveBaseline, groupGrants, userGrants, save, remove } =
    usePermissionGrants()
  const persisted = granteeType === 'group' ? groupGrants : userGrants
  const copy = COPY[granteeType]

  // Grantees picked but not yet raised on any area (no row persisted yet).
  const [pendingIds, setPendingIds] = useState<string[]>([])

  const rows = useMemo(() => {
    const ids = new Set(persisted.map((g) => g.granteeId))
    return [...persisted.map((g) => g.granteeId), ...pendingIds.filter((id) => !ids.has(id))]
  }, [persisted, pendingIds])

  const actorIds = useMemo(() => rows.map((id) => toActorId(granteeType, id)), [rows, granteeType])

  const handleAdd = (nextActorIds: ActorId[]) => {
    const existing = new Set(rows)
    const added = nextActorIds.map(getActorRawId).filter((id) => !existing.has(id))
    if (added.length > 0) setPendingIds((prev) => [...prev, ...added])
  }

  const handleChange = (granteeId: string, area: Area, level: Level | undefined) => {
    const current = persisted.find((g) => g.granteeId === granteeId)?.levels ?? {}
    const next = { ...current }
    if (level === undefined) delete next[area]
    else next[area] = level

    save(granteeType, granteeId, next)
    if (Object.keys(next).length === 0)
      setPendingIds((prev) => prev.filter((id) => id !== granteeId))
  }

  const handleRemove = (granteeId: string) => {
    remove(granteeType, granteeId)
    setPendingIds((prev) => prev.filter((id) => id !== granteeId))
  }

  if (isLoading || !roleDefaults) {
    return (
      <div className='space-y-2 p-3 sm:p-6'>
        <Skeleton className='h-16 w-full rounded-lg' />
        <Skeleton className='h-16 w-full rounded-lg' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3 p-3 sm:p-6'>
      <div className='flex items-center justify-between'>
        <p className='max-w-2xl text-sm text-muted-foreground'>{copy.empty}</p>
        <ActorPicker
          value={actorIds}
          onChange={handleAdd}
          target={granteeType}
          multi
          excludeIds={actorIds}
          disabled={disabled}>
          <Button variant='outline' size='sm' disabled={disabled}>
            <Plus />
            {copy.add}
          </Button>
        </ActorPicker>
      </div>

      {rows.length === 0 ? (
        <EmptySection
          icon={<copy.icon className='size-5' />}
          title='No overrides yet'
          description={copy.empty}
        />
      ) : (
        rows.map((granteeId) => (
          <GranteeOverrideCard
            key={granteeId}
            granteeType={granteeType}
            granteeId={granteeId}
            values={persisted.find((g) => g.granteeId === granteeId)?.levels ?? {}}
            roleDefaults={roleDefaults}
            baseline={effectiveBaseline}
            disabled={disabled}
            onChange={(area, level) => handleChange(granteeId, area, level)}
            onRemove={() => handleRemove(granteeId)}
          />
        ))
      )}
    </div>
  )
}

/** A single grantee's override card — resolved actor header + its leveled grid. */
function GranteeOverrideCard({
  granteeType,
  granteeId,
  values,
  roleDefaults,
  baseline,
  disabled,
  onChange,
  onRemove,
}: {
  granteeType: OverrideType
  granteeId: string
  values: Partial<Record<Area, Level>>
  roleDefaults: Record<Area, Level>
  baseline: Partial<Record<Area, Level>>
  disabled: boolean
  onChange: (area: Area, level: Level | undefined) => void
  onRemove: () => void
}) {
  const actorId = useMemo(() => toActorId(granteeType, granteeId), [granteeType, granteeId])
  const { actor, isLoading, isNotFound } = useActor({ actorId })
  const name = isNotFound
    ? 'Unknown'
    : actor?.name || (actor?.type === 'user' && actor?.email) || 'Unknown'

  return (
    <div className='flex flex-col gap-3 rounded-lg border p-3'>
      <div className='flex items-center justify-between'>
        <div className='flex min-w-0 items-center gap-2'>
          <ActorAvatar type={actor?.type ?? granteeType} avatarUrl={actor?.avatarUrl} />
          {isLoading && !actor ? (
            <Skeleton className='h-4 w-24 rounded-full' />
          ) : (
            <span
              className={cn('truncate text-sm font-medium', isNotFound && 'text-muted-foreground')}>
              {name}
            </span>
          )}
        </div>
        <Button
          variant='ghost'
          size='icon-sm'
          className='text-muted-foreground hover:text-destructive'
          aria-label='Remove override'
          disabled={disabled}
          onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <LeveledAreaGrid
        mode='override'
        values={values}
        roleDefaults={roleDefaults}
        baseline={baseline}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  )
}
