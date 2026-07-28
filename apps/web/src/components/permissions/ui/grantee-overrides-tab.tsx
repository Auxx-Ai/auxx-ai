// apps/web/src/components/permissions/ui/grantee-overrides-tab.tsx
'use client'

import { Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { Folder, Plus, SlidersHorizontal, Trash2, Users } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useActor, useActors } from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'
import { useUser } from '~/hooks/use-user'
import { useGranteeAccess } from '../hooks/use-grantee-access'
import { useGranteeDefAccess } from '../hooks/use-grantee-def-access'
import { useInstanceGranteeRows } from '../hooks/use-instance-grantee-rows'
import { usePermissionGrants } from '../hooks/use-permission-grants'
import { GranteeDefAccessRows } from './grantee-def-access-rows'
import { GranteeInstanceRows } from './grantee-instance-rows'
import { AREA_TO_INSTANCE_KEY, deadGrantWarning } from './instance-share-copy'
import { type AreaChildFilter, type AreaChildren, LeveledAreaGrid } from './leveled-area-grid'

/**
 * The grantee kinds this tab edits.
 *
 * `PermissionGrant` also carries `'profile'` rows (plan 19 §0.1) — every org has
 * six after data migration 049 — but they are NOT overrides: a profile IS the
 * composition base, and its editor is step 7's Profiles page, not this raise-only
 * surface. `usePermissionGrants` exposes them separately as `profileGrants`; this
 * tab deliberately renders none of them. See {@link copyFor} for why the copy
 * lookup is still total.
 */
type OverrideType = 'group' | 'user'

/** Rows shown before the inline "Show N more" toggle takes over. */
const VISIBLE_GRANTEES = 5

interface OverrideCopy {
  add: string
  list: string
  remove: string
  empty: string
  search: string
  noMatches: string
  icon: typeof Users
}

const COPY: Record<OverrideType, OverrideCopy> = {
  group: {
    add: 'Add group',
    list: 'Groups',
    remove: 'Remove group',
    empty: 'Grant a group more access than the member baseline.',
    search: 'Search groups...',
    noMatches: 'No groups match your search.',
    icon: Folder,
  },
  user: {
    add: 'Add member',
    list: 'Members',
    remove: 'Remove member',
    empty: 'Grant one member more access than the baseline or their groups.',
    search: 'Search members...',
    noMatches: 'No members match your search.',
    icon: Users,
  },
}

/** Neutral copy for a grantee kind this tab does not model. */
const FALLBACK_COPY: OverrideCopy = {
  add: 'Add grantee',
  list: 'Grantees',
  remove: 'Remove grantee',
  empty: 'Grant more access than the member baseline.',
  search: 'Search grantees...',
  noMatches: 'No grantees match your search.',
  icon: Users,
}

/**
 * Total copy lookup. `COPY[granteeType]` was an unguarded index: widening the
 * grantee vocabulary (plan 19's `'profile'`) turned every read of `.add`/`.icon`
 * on the result into a `TypeError` at render, taking the whole tab down rather
 * than showing a generic label.
 */
function copyFor(granteeType: string): OverrideCopy {
  return COPY[granteeType as OverrideType] ?? FALLBACK_COPY
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
  const copy = copyFor(granteeType)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const rows = useMemo(() => persisted.map((g) => g.granteeId), [persisted])

  const actorIds = useMemo(() => rows.map((id) => toActorId(granteeType, id)), [rows, granteeType])

  // Names live on the actor store (bulk-hydrated by `ResourceProvider`), so the
  // list can filter on them without waiting for each row's own `useActor`.
  const actors = useActors(actorIds)
  const query = search.trim().toLowerCase()

  /**
   * Grantees narrowed by the search query. A grantee whose actor hasn't resolved
   * yet is KEPT — it can't be judged, and hiding it would silently shrink the
   * list. Only the list is filtered; the selection below is unaffected.
   */
  const filteredRows = useMemo(() => {
    if (!query) return rows
    return rows.filter((granteeId) => {
      const actor = actors.get(toActorId(granteeType, granteeId))
      if (!actor) return true
      const name = actor.name || (actor.type === 'user' ? actor.email : '') || ''
      return name.toLowerCase().includes(query)
    })
  }, [rows, actors, granteeType, query])

  // Fall back to the first row when the selection is empty or was removed. Based
  // on the unfiltered list — searching narrows the list, never the selection.
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
          <div className='flex flex-col gap-2'>
            <InputSearch
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={copy.search}
            />
            {filteredRows.length === 0 ? (
              <EmptySection
                orientation='horizontal'
                icon={<copy.icon />}
                title='No matches'
                description={copy.noMatches}
              />
            ) : (
              <TreeRowList
                items={filteredRows}
                getKey={(granteeId) => granteeId}
                visibleLimit={VISIBLE_GRANTEES}
                className='gap-0.5'
                renderRow={(granteeId) => (
                  <GranteeListRow
                    granteeType={granteeType}
                    granteeId={granteeId}
                    selected={granteeId === selectedGranteeId}
                    disabled={disabled}
                    onSelect={() => setSelectedId(granteeId)}
                    onRemove={() => handleRemove(granteeId)}
                  />
                )}
              />
            )}
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
          tooltipText={copyFor(granteeType).remove}
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
  const {
    isLoading: defAccessLoading,
    rows: defRows,
    setLevel: setDefLevel,
  } = useGranteeDefAccess(granteeType, granteeId)
  const {
    isLoading: instanceRowsLoadingAll,
    lists: instanceLists,
    rowsByKey: instanceRowsByKey,
    setGrant: setInstanceGrant,
  } = useInstanceGranteeRows(granteeType, granteeId)
  // Deduped by React Query with the call inside `useInstanceGranteeRows`, so the
  // area rows' effective line costs no extra request. Null for a team, which is
  // exactly when it must not render.
  const { effective } = useGranteeAccess(granteeType, granteeId)

  /**
   * Per-def overrides nested under Records (capability layer v2 Part B.0), and
   * per-instance grants nested under Datasets / Knowledge base / Dashboards
   * (Part B) — the grantee-scoped twin of the Workspace defaults tab's own
   * per-def / per-instance rows. "Overrides only" means "has an explicit grant for this
   * grantee"; a def/instance-name match keeps (and expands) the parent area
   * row even when the area label itself didn't match.
   */
  const renderChildren = useCallback(
    (area: Area, filter: AreaChildFilter): AreaChildren | undefined => {
      if (area === Area.records) {
        if (defAccessLoading)
          return {
            matchCount: 0,
            rows: (
              <GranteeDefAccessRows
                rows={[]}
                isLoading
                canEdit={!disabled}
                onChange={setDefLevel}
              />
            ),
          }

        const matched = defRows.filter((row) => {
          if (filter.overridesOnly && row.grantLevel === undefined) return false
          if (!filter.query) return true
          const { plural, label } = row.resource
          return (
            plural.toLowerCase().includes(filter.query) ||
            label.toLowerCase().includes(filter.query)
          )
        })

        return {
          matchCount: matched.length,
          rows: <GranteeDefAccessRows rows={matched} canEdit={!disabled} onChange={setDefLevel} />,
        }
      }

      const instanceKey = AREA_TO_INSTANCE_KEY[area]
      if (!instanceKey) return undefined

      // This grantee's composed level for the area shown right above these
      // rows — the raise-only override grid's own inherited-value formula
      // (`LeveledAreaGrid`'s `override` mode), re-derived here so the
      // dead-grant warning needs no extra server call (§B.2.8).
      const areaLevel = values[area] ?? baseline[area] ?? roleDefaults[area] ?? Level.None

      const instanceLoading = instanceRowsLoadingAll || instanceLists[instanceKey].isLoading
      if (instanceLoading)
        return {
          matchCount: 0,
          rows: (
            <GranteeInstanceRows
              rows={[]}
              isLoading
              canEdit={!disabled}
              onChange={setInstanceGrant}
            />
          ),
        }

      const matched = instanceRowsByKey[instanceKey].filter((row) => {
        if (filter.overridesOnly && row.grantLevel === undefined) return false
        if (!filter.query) return true
        return row.name.toLowerCase().includes(filter.query)
      })

      return {
        matchCount: matched.length,
        rows: (
          <GranteeInstanceRows
            rows={matched}
            truncated={instanceLists[instanceKey].truncated}
            canEdit={!disabled}
            deadGrantTooltip={
              granteeType === 'user' && areaLevel === Level.None
                ? deadGrantWarning(PERMISSION_AREAS[area].label)
                : undefined
            }
            onChange={setInstanceGrant}
          />
        ),
      }
    },
    [
      defAccessLoading,
      defRows,
      disabled,
      setDefLevel,
      values,
      baseline,
      roleDefaults,
      instanceRowsLoadingAll,
      instanceLists,
      instanceRowsByKey,
      granteeType,
      setInstanceGrant,
    ]
  )

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
        renderChildren={renderChildren}
        effectiveLevels={effective?.areas}
      />
    </Section>
  )
}
