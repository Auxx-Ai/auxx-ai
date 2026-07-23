// apps/web/src/components/permissions/ui/grantee-overrides-tab.tsx
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Folder, Plus, SlidersHorizontal, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useActor } from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'
import { useUser } from '~/hooks/use-user'
import { usePermissionGrants } from '../hooks/use-permission-grants'
import { LeveledAreaGrid } from './leveled-area-grid'

type OverrideType = 'group' | 'user'

const COPY: Record<
  OverrideType,
  { add: string; list: string; remove: string; empty: string; icon: typeof Users }
> = {
  group: {
    add: 'Add group',
    list: 'Groups',
    remove: 'Remove group',
    empty: 'Grant a group more access than the member baseline.',
    icon: Folder,
  },
  user: {
    add: 'Add member',
    list: 'Members',
    remove: 'Remove member',
    empty: 'Grant one member more access than the baseline or their groups.',
    icon: Users,
  },
}

/** Resolve a grantee's display name from the actor cache (falls back to email / Unknown). */
function useGranteeName(granteeType: OverrideType, granteeId: string) {
  const { userId } = useUser()
  const actorId = useMemo(() => toActorId(granteeType, granteeId), [granteeType, granteeId])
  const { actor, isLoading, isNotFound } = useActor({ actorId })
  const base = isNotFound
    ? 'Unknown'
    : actor?.name || (actor?.type === 'user' && actor?.email) || 'Unknown'
  const name = granteeType === 'user' && granteeId === userId ? `${base} (You)` : base
  return { actor, isLoading, isNotFound, name }
}

/**
 * The raise-only override surface for one grantee kind (groups or users). A
 * `TreeRow` list of grantees on top; selecting one reveals its full leveled grid
 * below. Every rung is selectable, but overrides only *raise* above the member
 * baseline — the raise-only rule is enforced server-side (Camp-1, v1.5 §L3), and
 * an override that lifts nothing is flagged "ignored" on the grantee. Adding a
 * grantee immediately persists an empty grant row (composes to nothing but
 * survives reloads), and clearing every raised area keeps that row; only the
 * delete action removes the grant.
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

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const rows = useMemo(() => persisted.map((g) => g.granteeId), [persisted])

  const actorIds = useMemo(() => rows.map((id) => toActorId(granteeType, id)), [rows, granteeType])

  // Fall back to the first row when the selection is empty or was removed.
  const selectedGranteeId = selectedId && rows.includes(selectedId) ? selectedId : (rows[0] ?? null)

  const handleAdd = (nextActorIds: ActorId[]) => {
    const existing = new Set(rows)
    const added = nextActorIds.map(getActorRawId).filter((id) => !existing.has(id))
    // Persist each new grantee as an empty grant row right away, so the list
    // survives reloads even before any area is raised.
    for (const id of added) save(granteeType, id, {})
    if (added.length > 0) setSelectedId(added[0] ?? null)
  }

  const handleChange = (granteeId: string, area: Area, level: Level | undefined) => {
    const current = persisted.find((g) => g.granteeId === granteeId)?.levels ?? {}
    const next = { ...current }
    if (level === undefined) delete next[area]
    else next[area] = level

    save(granteeType, granteeId, next)
  }

  const handleRemove = (granteeId: string) => {
    remove(granteeType, granteeId)
    if (selectedId === granteeId) setSelectedId(null)
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
    <div className='flex flex-col p-3 sm:p-6'>
      <p className='mb-3 max-w-2xl text-sm text-muted-foreground'>{copy.empty}</p>

      {/* Grantee list */}
      <Section
        title={copy.list}
        icon={<copy.icon className='size-4' />}
        collapsible={false}
        actions={
          <ActorPicker
            value={actorIds}
            onChange={handleAdd}
            target={granteeType}
            multi
            excludeIds={actorIds}
            disabled={disabled}>
            <Button variant='ghost' size='xs' disabled={disabled}>
              <Plus />
              {copy.add}
            </Button>
          </ActorPicker>
        }>
        {rows.length === 0 ? (
          <EmptySection
            icon={<copy.icon className='size-5' />}
            title='No overrides yet'
            description={copy.empty}
          />
        ) : (
          <div className='flex flex-col gap-0.5'>
            {rows.map((granteeId) => (
              <GranteeListRow
                key={granteeId}
                granteeType={granteeType}
                granteeId={granteeId}
                selected={granteeId === selectedGranteeId}
                disabled={disabled}
                onSelect={() => setSelectedId(granteeId)}
                onRemove={() => handleRemove(granteeId)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Selected grantee's leveled grid */}
      {selectedGranteeId ? (
        <GranteeAccessDetail
          granteeType={granteeType}
          granteeId={selectedGranteeId}
          values={persisted.find((g) => g.granteeId === selectedGranteeId)?.levels ?? {}}
          roleDefaults={roleDefaults}
          baseline={effectiveBaseline}
          disabled={disabled}
          onChange={(area, level) => handleChange(selectedGranteeId, area, level)}
        />
      ) : (
        <Section title='Access' icon={<SlidersHorizontal className='size-4' />} collapsible={false}>
          <EmptySection
            icon={<SlidersHorizontal className='size-5' />}
            title={`No ${granteeType === 'group' ? 'group' : 'member'} selected`}
            description={`Add ${granteeType === 'group' ? 'a group' : 'a member'} above to grant more access.`}
          />
        </Section>
      )}
    </div>
  )
}

/** A single grantee row in the list — avatar + resolved name, selectable, hover-delete. */
function GranteeListRow({
  granteeType,
  granteeId,
  selected,
  disabled,
  onSelect,
  onRemove,
}: {
  granteeType: OverrideType
  granteeId: string
  selected: boolean
  disabled: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const { actor, isLoading, isNotFound, name } = useGranteeName(granteeType, granteeId)

  return (
    <TreeRow
      icon={<ActorAvatar type={actor?.type ?? granteeType} avatarUrl={actor?.avatarUrl} />}
      isOpen={selected}
      onToggleOpen={onSelect}
      rowClassName={
        selected ? 'bg-primary-150 hover:bg-primary-150' : 'bg-primary-50 hover:bg-primary-100'
      }
      title={
        isLoading && !actor ? (
          <Skeleton className='h-4 w-24 rounded-full' />
        ) : (
          <span className={cn('truncate', isNotFound && 'text-muted-foreground')}>{name}</span>
        )
      }
      actions={
        <TreeRowButton
          variant='destructive'
          tooltipText={COPY[granteeType].remove}
          disabled={disabled}
          onClick={onRemove}>
          <Trash2 />
        </TreeRowButton>
      }
    />
  )
}

/** The selected grantee's leveled grid, headed by its resolved name. */
function GranteeAccessDetail({
  granteeType,
  granteeId,
  values,
  roleDefaults,
  baseline,
  disabled,
  onChange,
}: {
  granteeType: OverrideType
  granteeId: string
  values: Partial<Record<Area, Level>>
  roleDefaults: Record<Area, Level>
  baseline: Partial<Record<Area, Level>>
  disabled: boolean
  onChange: (area: Area, level: Level | undefined) => void
}) {
  const { name } = useGranteeName(granteeType, granteeId)

  return (
    <Section
      title={`Access · ${name}`}
      icon={<SlidersHorizontal className='size-4' />}
      collapsible={false}>
      <LeveledAreaGrid
        mode='override'
        values={values}
        roleDefaults={roleDefaults}
        baseline={baseline}
        onChange={onChange}
        disabled={disabled}
      />
    </Section>
  )
}
