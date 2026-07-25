// apps/web/src/components/permissions/ui/def-access-section.tsx
'use client'

import {
  ResourceGranteeType,
  type ResourcePermission,
  type SharingGranteeType,
} from '@auxx/database/enums'
import type { Resource } from '@auxx/lib/resources/client'
import { FeatureKey } from '@auxx/lib/types'
import { type ActorId, getActorRawId, isAgentActor, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertTriangle,
  Bot,
  Folder,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  User,
  type Users,
} from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { UpgradeBanner } from '~/components/banner/upgrade-banner'
import { Tooltip } from '~/components/global/tooltip'
import { ActorPicker } from '~/components/pickers/actor-picker'
import {
  useActor,
  useActorLoading,
  useAvailableActors,
} from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { type DefAccessGrant, useDefAccess } from '../hooks/use-def-access'
import { unmanageableGrantsNote } from '../utils/grantee'
import { AccessLevelSelect } from './access-level-select'

/**
 * The three grantee axes the Access tab renders. `agent` is NOT a storage
 * grantee type — an agent grant is a `user` row keyed on the agent's backing
 * `User.id` (agent plan §4.1); the kind only selects the copy, the picker
 * target, and the ActorId prefix used for display.
 *
 * A `profile` grantee is the opposite: a REAL storage kind with no actor and no
 * `user` row behind it, so it cannot be added as a fourth block by copying the
 * `agent` pattern — there is nothing to translate it into. Its rows are
 * disclosed via `unmanageableGrants` and edited from step 7's Profiles page.
 */
type GranteeKind = 'group' | 'user' | 'agent'

const GRANTEE_COPY: Record<
  GranteeKind,
  {
    title: string
    add: string
    remove: string
    emptyTitle: string
    empty: string
    icon: typeof Users
    /** Tooltip next to the section title (shown once the list is non-empty). */
    description?: string
  }
> = {
  group: {
    title: 'Teams',
    add: 'Add team',
    remove: 'Remove team',
    emptyTitle: 'No teams yet',
    empty: 'Grant a team access to these records.',
    icon: Folder,
  },
  user: {
    title: 'Individual members',
    add: 'Add member',
    remove: 'Remove member',
    emptyTitle: 'No members yet',
    empty: 'Grant an individual member access to these records.',
    icon: User,
  },
  agent: {
    title: 'Agents',
    add: 'Add agent',
    remove: 'Remove agent',
    emptyTitle: 'No agents yet',
    empty: 'Agents inherit their own base access. Grant or restrict this object per agent.',
    icon: Bot,
    description: 'Agents inherit their own base access. Grant or restrict this object per agent.',
  },
}

/**
 * The entity-def **Access** surface (capability layer v2 phase 3): a workspace
 * baseline ("Default for all members"), raise-only **team** grants,
 * **individual member** grants, and per-**agent** grants (agent plan §4.1) —
 * modeled on Attio's object-permissions screen.
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
    unmanageableGrants,
    setBaseline,
    addGrant,
    setGrant,
    removeGrant,
    resetToDefault,
    isIgnored,
  } = useDefAccess(resource.entityDefinitionId)

  // Rows none of the three blocks below can render (a `profile` grant today).
  // Via 19a finding 1 a single one keeps the def restricted org-wide, so a
  // silent drop here would leave an admin staring at a restricted def with no
  // visible cause.
  const hiddenGrantsNote = useMemo(
    () => unmanageableGrantsNote(unmanageableGrants),
    [unmanageableGrants]
  )

  // Agents are org members backed by a synthetic User row, so their def grants
  // are `user`-type rows keyed on `AgentActor.userId` — indistinguishable from a
  // human grant in the stored rows. The actor store (hydrated org-wide by
  // `ResourceProvider` with `target: 'all'`) is the only place both ids live, so
  // it drives BOTH directions of the id seam:
  //   - write: picked `agent:<Agent.id>` → the agent's `User.id` (the grantee).
  //   - read:  a granted `User.id` → `agent:<Agent.id>` (the display ActorId —
  //     `useActor('user:<agentUserId>')` resolves to NOT-FOUND, since the batch
  //     resolver keys results by the canonical `agent:` ActorId).
  const agentActors = useAvailableActors({ target: 'agent' })
  const actorsLoading = useActorLoading()
  const { agentUserIdByActorId, agentActorIdByUserId } = useMemo(() => {
    const byActorId = new Map<ActorId, string>()
    const byUserId = new Map<string, ActorId>()
    for (const actor of agentActors) {
      if (!isAgentActor(actor) || !actor.userId) continue
      byActorId.set(actor.actorId, actor.userId)
      byUserId.set(actor.userId, actor.actorId)
    }
    return { agentUserIdByActorId: byActorId, agentActorIdByUserId: byUserId }
  }, [agentActors])

  // Partition the `user` rows: a grantee that maps to a known agent belongs to
  // the Agents section and must not double-render under Individual members.
  const { memberGrants, agentGrants } = useMemo(() => {
    const members: DefAccessGrant[] = []
    const agents: DefAccessGrant[] = []
    for (const grant of userGrants) {
      if (agentActorIdByUserId.has(grant.granteeId)) agents.push(grant)
      else members.push(grant)
    }
    return { memberGrants: members, agentGrants: agents }
  }, [userGrants, agentActorIdByUserId])

  /** Picked `agent:<Agent.id>` → grant on the agent's backing `User.id`. */
  const addAgents = useCallback(
    (nextActorIds: ActorId[]) => {
      const present = new Set(agentGrants.map((g) => g.granteeId))
      for (const actorId of nextActorIds) {
        const agentUserId = agentUserIdByActorId.get(actorId)
        // No `getActorRawId` here — that yields the `Agent.id`, which would
        // write a grant row no composition path can ever match.
        if (!agentUserId || present.has(agentUserId)) continue
        addGrant(ResourceGranteeType.user, agentUserId)
      }
    },
    [addGrant, agentGrants, agentUserIdByActorId]
  )

  const resolveAgentActorId = useCallback(
    (granteeUserId: string) => agentActorIdByUserId.get(granteeUserId),
    [agentActorIdByUserId]
  )

  if (isLoading || actorsLoading) {
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

      {hiddenGrantsNote && (
        <p className='rounded-xl border border-dashed px-3 py-2 text-muted-foreground text-xs'>
          {hiddenGrantsNote}
        </p>
      )}

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
        grants={memberGrants}
        baselineLevel={baselineLevel}
        canEdit={canEdit}
        isIgnored={isIgnored}
        onAdd={(actorIds) => addActors(actorIds, memberGrants, ResourceGranteeType.user, addGrant)}
        onChange={(granteeId, level) => setGrant(ResourceGranteeType.user, granteeId, level)}
        onRemove={(granteeId) => removeGrant(ResourceGranteeType.user, granteeId)}
      />

      {/* Agents (plan §4.1) — hidden entirely for orgs with no agents. */}
      {agentActorIdByUserId.size > 0 && (
        <GranteeAccessBlock
          kind='agent'
          grants={agentGrants}
          baselineLevel={baselineLevel}
          canEdit={canEdit}
          isIgnored={isIgnored}
          resolveActorId={resolveAgentActorId}
          onAdd={addAgents}
          onChange={(granteeId, level) => setGrant(ResourceGranteeType.user, granteeId, level)}
          onRemove={(granteeId) => removeGrant(ResourceGranteeType.user, granteeId)}
        />
      )}
    </div>
  )
}

/** Add every newly-picked actor as a `view` grant (skips ones already present). */
function addActors(
  nextActorIds: ActorId[],
  existing: DefAccessGrant[],
  granteeType: SharingGranteeType,
  addGrant: (
    granteeType: SharingGranteeType,
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

/** One grantee-kind block (Teams, Individual members or Agents): add button + row list. */
function GranteeAccessBlock({
  kind,
  grants,
  baselineLevel,
  canEdit,
  isIgnored,
  resolveActorId,
  onAdd,
  onChange,
  onRemove,
}: {
  kind: GranteeKind
  grants: DefAccessGrant[]
  baselineLevel: ResourcePermission
  canEdit: boolean
  isIgnored: (permission: ResourcePermission) => boolean
  /**
   * Map a stored `granteeId` to the ActorId used for display. Defaults to
   * `<kind>:<granteeId>`; the Agents block overrides it because its rows store
   * the agent's `User.id` while the actor system addresses agents by `Agent.id`.
   */
  resolveActorId?: (granteeId: string) => ActorId | undefined
  onAdd: (actorIds: ActorId[]) => void
  onChange: (granteeId: string, level: ResourcePermission) => void
  onRemove: (granteeId: string) => void
}) {
  const copy = GRANTEE_COPY[kind]
  const actorIds = useMemo(
    () =>
      grants
        .map((g) => resolveActorId?.(g.granteeId) ?? toActorId(kind, g.granteeId))
        .filter((id): id is ActorId => !!id),
    [grants, kind, resolveActorId]
  )

  return (
    <Section
      title={copy.title}
      description={copy.description}
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
          title={copy.emptyTitle}
          description={copy.empty}
        />
      ) : (
        <div className='flex flex-col gap-0.5 border rounded-xl p-0.5'>
          {grants.map((grant) => (
            <GranteeRow
              key={grant.granteeId}
              kind={kind}
              actorId={resolveActorId?.(grant.granteeId) ?? toActorId(kind, grant.granteeId)}
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
  actorId,
  grant,
  ignored,
  baselineLevel,
  canEdit,
  onChange,
  onRemove,
}: {
  kind: GranteeKind
  /** Display ActorId — for agents this is `agent:<Agent.id>`, not the grantee id. */
  actorId: ActorId
  grant: DefAccessGrant
  ignored: boolean
  baselineLevel: ResourcePermission
  canEdit: boolean
  onChange: (level: ResourcePermission) => void
  onRemove: () => void
}) {
  const { userId } = useUser()
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
          {/* The "ignored" flag is as true for agents as for humans: an agent's
              all-Full base (agent plan §0.3) is an AREA-level default, but any
              type row makes the def restricted, and `defAccess` then resolves to
              the HIGHEST row matching the grantee — and the `role:org_member`
              baseline row matches agents too (they are ACTIVE members;
              `compute-user-capabilities.ts` applies no `userType` filter to the
              ResourceAccess grantee union). So a grant at or below the baseline
              lifts nothing for an agent either. Note a `none` baseline never
              trips this — `PERMISSION_RANK` puts every positive grant above it,
              which is exactly the restricted-def case where the grant is the
              load-bearing one. */}
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
