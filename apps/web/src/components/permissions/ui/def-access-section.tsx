// apps/web/src/components/permissions/ui/def-access-section.tsx
'use client'

import { ResourceGranteeType, type ResourcePermission } from '@auxx/database/enums'
import type { Resource } from '@auxx/lib/resources/client'
import { FeatureKey } from '@auxx/lib/types'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertTriangle,
  Folder,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  User,
  type Users,
} from 'lucide-react'
import { useMemo } from 'react'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import { Tooltip } from '~/components/global/tooltip'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { useActor } from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { type DefAccessGrant, useDefAccess } from '../hooks/use-def-access'
import { AccessLevelSelect } from './access-level-select'

type GranteeKind = 'group' | 'user'

const GRANTEE_COPY: Record<
  GranteeKind,
  { title: string; add: string; remove: string; empty: string; icon: typeof Users }
> = {
  group: {
    title: 'Teams',
    add: 'Add team',
    remove: 'Remove team',
    empty: 'Grant a team access to these records.',
    icon: Folder,
  },
  user: {
    title: 'Individual members',
    add: 'Add member',
    remove: 'Remove member',
    empty: 'Grant an individual member access to these records.',
    icon: User,
  },
}

/**
 * The entity-def **Access** surface (capability layer v2 phase 3): a workspace
 * baseline ("Default for all members"), raise-only **team** grants, and
 * **individual member** grants — modeled on Attio's object-permissions screen.
 *
 * Composition is baseline-floor + raise-only-grants, so adding a team/member
 * never locks others out; only Workspace access = No Access restricts
 * non-grantees. Editing is gated on `granularPermissions`; admins always retain
 * access regardless of baseline. All writes carry the def's
 * `entityDefinitionId` CUID (never a slug).
 */
export function DefAccessSection({ resource }: { resource: Resource }) {
  const { hasAccess } = useFeatureFlags()
  const { canAdministerDef } = useAccess()
  // Editing the Access tab is def administration (the `Full`/`admin` rung), AND
  // the plan must include granular permissions. Server enforces both regardless.
  const canEdit =
    hasAccess(FeatureKey.granularPermissions) && canAdministerDef(resource.entityDefinitionId)
  const {
    isLoading,
    baselineLevel,
    isConfigured,
    teamGrants,
    userGrants,
    setBaseline,
    addGrant,
    setGrant,
    removeGrant,
    resetToDefault,
    isIgnored,
  } = useDefAccess(resource.entityDefinitionId)

  if (isLoading) {
    return (
      <div className='space-y-2 p-3 sm:p-6'>
        <Skeleton className='h-16 w-full rounded-lg' />
        <Skeleton className='h-24 w-full rounded-lg' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4 p-3 sm:p-6 sm:pt-0 pt-0'>
      {!canEdit && (
        <UpgradeBanner
          title='Upgrade to configure record access'
          description='Granular permissions let you set a workspace baseline and grant teams and members access per record type.'
        />
      )}

      {/* Workspace access */}
      <Section
        title='Workspace access'
        className='[&_[data-slot=section]]:p-0! [&_[data-slot=section]]:border-b-0!'
        icon={<ShieldCheck className='size-4' />}
        collapsible={false}
        actions={
          isConfigured ? (
            <Button variant='ghost' size='xs' disabled={!canEdit} onClick={() => resetToDefault()}>
              <RotateCcw />
              Reset to default
            </Button>
          ) : undefined
        }>
        <div className='flex items-center justify-between gap-4 rounded-xl border bg-primary-50 px-3 py-2.5'>
          <div className='flex flex-col'>
            <span className='font-medium text-sm'>Default for all members</span>
            <span className='text-muted-foreground text-xs'>
              The default access level for everyone. Admins always retain access.
            </span>
          </div>
          <AccessLevelSelect
            value={baselineLevel}
            onChange={setBaseline}
            includeNone
            disabled={!canEdit}
            className='h-8 w-40 shrink-0'
          />
        </div>
      </Section>

      <GranteeAccessBlock
        kind='group'
        grants={teamGrants}
        baselineLevel={baselineLevel}
        canEdit={canEdit}
        isIgnored={isIgnored}
        onAdd={(actorIds) => addActors(actorIds, teamGrants, ResourceGranteeType.group, addGrant)}
        onChange={(granteeId, level) => setGrant(ResourceGranteeType.group, granteeId, level)}
        onRemove={(granteeId) => removeGrant(ResourceGranteeType.group, granteeId)}
      />

      <GranteeAccessBlock
        kind='user'
        grants={userGrants}
        baselineLevel={baselineLevel}
        canEdit={canEdit}
        isIgnored={isIgnored}
        onAdd={(actorIds) => addActors(actorIds, userGrants, ResourceGranteeType.user, addGrant)}
        onChange={(granteeId, level) => setGrant(ResourceGranteeType.user, granteeId, level)}
        onRemove={(granteeId) => removeGrant(ResourceGranteeType.user, granteeId)}
      />
    </div>
  )
}

/** Add every newly-picked actor as a `view` grant (skips ones already present). */
function addActors(
  nextActorIds: ActorId[],
  existing: DefAccessGrant[],
  granteeType: ResourceGranteeType,
  addGrant: (
    granteeType: ResourceGranteeType,
    granteeId: string,
    permission?: ResourcePermission
  ) => void
) {
  const present = new Set(existing.map((g) => g.granteeId))
  for (const actorId of nextActorIds) {
    const granteeId = getActorRawId(actorId)
    if (!present.has(granteeId)) addGrant(granteeType, granteeId)
  }
}

/** One grantee-kind block (Teams or Individual members): add button + row list. */
function GranteeAccessBlock({
  kind,
  grants,
  baselineLevel,
  canEdit,
  isIgnored,
  onAdd,
  onChange,
  onRemove,
}: {
  kind: GranteeKind
  grants: DefAccessGrant[]
  baselineLevel: ResourcePermission
  canEdit: boolean
  isIgnored: (permission: ResourcePermission) => boolean
  onAdd: (actorIds: ActorId[]) => void
  onChange: (granteeId: string, level: ResourcePermission) => void
  onRemove: (granteeId: string) => void
}) {
  const copy = GRANTEE_COPY[kind]
  const actorIds = useMemo(() => grants.map((g) => toActorId(kind, g.granteeId)), [grants, kind])

  return (
    <Section
      title={copy.title}
      icon={<copy.icon className='size-4' />}
      className='[&_[data-slot=section]]:p-0! [&_[data-slot=section]]:border-b-0!'
      collapsible={false}
      actions={
        <ActorPicker
          value={actorIds}
          onChange={onAdd}
          target={kind}
          multi
          excludeIds={actorIds}
          disabled={!canEdit}>
          <Button variant='ghost' size='xs' disabled={!canEdit}>
            <Plus />
            {copy.add}
          </Button>
        </ActorPicker>
      }>
      {grants.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<copy.icon className='size-5' />}
          title={`No ${kind === 'group' ? 'teams' : 'members'} yet`}
          description={copy.empty}
        />
      ) : (
        <div className='flex flex-col gap-0.5 border rounded-xl p-0.5'>
          {grants.map((grant) => (
            <GranteeRow
              key={grant.granteeId}
              kind={kind}
              grant={grant}
              ignored={isIgnored(grant.permission)}
              baselineLevel={baselineLevel}
              canEdit={canEdit}
              onChange={(level) => onChange(grant.granteeId, level)}
              onRemove={() => onRemove(grant.granteeId)}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

/** A single grantee row: avatar + resolved name + level select + remove. */
function GranteeRow({
  kind,
  grant,
  ignored,
  baselineLevel,
  canEdit,
  onChange,
  onRemove,
}: {
  kind: GranteeKind
  grant: DefAccessGrant
  ignored: boolean
  baselineLevel: ResourcePermission
  canEdit: boolean
  onChange: (level: ResourcePermission) => void
  onRemove: () => void
}) {
  const { userId } = useUser()
  const actorId = useMemo(() => toActorId(kind, grant.granteeId), [kind, grant.granteeId])
  const { actor, isLoading, isNotFound } = useActor({ actorId })
  const base = isNotFound
    ? 'Unknown'
    : actor?.name || (actor?.type === 'user' && actor?.email) || 'Unknown'
  const name = kind === 'user' && grant.granteeId === userId ? `${base} (You)` : base

  return (
    <TreeRow
      icon={<ActorAvatar type={actor?.type ?? kind} avatarUrl={actor?.avatarUrl} />}
      rowClassName='bg-primary-50 hover:bg-primary-100'
      title={
        isLoading && !actor ? (
          <Skeleton className='h-4 w-24 rounded-full' />
        ) : (
          <span className={cn('truncate', isNotFound && 'text-muted-foreground')}>{name}</span>
        )
      }
      actions={
        <>
          {ignored && (
            <Tooltip
              content={`Ignored — this grant is at or below the workspace baseline (${baselineLevel}).`}>
              <AlertTriangle className='size-4 text-amber-500' />
            </Tooltip>
          )}
          <AccessLevelSelect
            value={grant.permission}
            onChange={onChange}
            disabled={!canEdit}
            size='sm'
            variant='transparent'
            className='h-7 w-32'
          />
          <TreeRowButton
            variant='destructive'
            tooltipText={GRANTEE_COPY[kind].remove}
            disabled={!canEdit}
            onClick={onRemove}>
            <Trash2 />
          </TreeRowButton>
        </>
      }
    />
  )
}
