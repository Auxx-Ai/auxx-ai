// apps/web/src/components/agents/ui/detail/permissions/agent-policy-view.tsx
'use client'

import type { AgentPermissionPolicy } from '@auxx/database'
import type { ResourcePermission } from '@auxx/database/enums'
import { AREA_ORDER, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { isAccessManageable } from '@auxx/lib/resources/client'
import { EntityIcon } from '@auxx/ui/components/icons'
import { useMemo } from 'react'
import { INSTANCE_TYPE_META } from '~/components/permissions/ui/instance-share-copy'
import { AGENT_POLICY_INSTANCE_KEYS } from '~/components/permissions/ui/profile-copy'
import {
  ResolvedAccessBadge,
  ResolvedAccessDialog,
  type ResolvedAccessDomain,
  type ResolvedAccessLevel,
  type ResolvedAccessLevelMetaMap,
  type ResolvedAccessRow,
} from '~/components/permissions/ui/resolved-access-dialog'
import { useResources } from '~/components/resources/hooks'
import { AGENT_ACCESS_LEVEL_META, hasAgentOverride, resolveAgentLevel } from './agent-access-level'

/**
 * Stored rungs onto {@link ResolvedAccessDialog}'s own presentation keyspace.
 * That union (`none/read/write/full`) is a shared dialog's internal shape, not a
 * storage vocabulary, so plan 26 Phase 2 left it alone — this stays a real map,
 * not an identity.
 */
const AGENT_LEVEL: Record<ResourcePermission, ResolvedAccessLevel> = {
  none: 'none',
  view: 'read',
  edit: 'write',
  admin: 'full',
}

/** The agent ladder's names — `None / Read / Edit / Full`, never "Inherit" (§7). */
export const AGENT_LEVEL_META: ResolvedAccessLevelMetaMap = {
  none: AGENT_ACCESS_LEVEL_META.none,
  read: AGENT_ACCESS_LEVEL_META.view,
  write: AGENT_ACCESS_LEVEL_META.edit,
  full: AGENT_ACCESS_LEVEL_META.admin,
}

/** The four-level badge — never rendered as "Inherit" (§7: agent `None` is a deny). */
export function AgentLevelBadge({
  level,
  isOverride,
}: {
  level: ResourcePermission
  isOverride?: boolean
}) {
  return (
    <ResolvedAccessBadge
      level={AGENT_LEVEL[level]}
      levelMeta={AGENT_LEVEL_META}
      isOverride={isOverride}
    />
  )
}

interface AgentDomainDefault {
  key: string
  title: string
  defaultLabel: string
  level: ResourcePermission
}

/**
 * The three domains the runtime enforces and the rung every key in each one falls
 * back to (§2.3). Single source for both the tab's summary line and the dialog's
 * `Default` rows.
 */
export function agentPolicyDomainDefaults(
  policy: AgentPermissionPolicy
): [AgentDomainDefault, AgentDomainDefault, AgentDomainDefault] {
  return [
    { key: 'areas', title: 'Areas', defaultLabel: 'Default', level: policy.areas.default },
    {
      key: 'definitions',
      title: 'Record types',
      defaultLabel: 'Default · incl. created later',
      level: policy.definitions.default,
    },
    {
      key: 'resources',
      title: 'Resources',
      defaultLabel: 'Default',
      level: policy.resourceDefault,
    },
  ]
}

/** One line of the three domain defaults — the tab's answer to "what does this agent get?". */
export function AgentPolicySummary({ policy }: { policy: AgentPermissionPolicy | null }) {
  if (!policy) return <p className='text-sm text-muted-foreground'>No policy resolved.</p>

  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm'>
      {agentPolicyDomainDefaults(policy).map(({ key, title, level }) => (
        <span key={key} className='flex items-center gap-1.5'>
          <span className='text-muted-foreground'>{title}</span>
          <AgentLevelBadge level={level} />
        </span>
      ))}
    </div>
  )
}

/**
 * The **exact resolved** policy an agent draft runs under, as read-only reference:
 * capability areas, entity definitions, and shareable resource instances. Read-only
 * by design — the policy belongs to the *profile*, which other agents may share.
 */
export function AgentResolvedPolicyDialog({
  policy,
  open,
  onOpenChange,
}: {
  policy: AgentPermissionPolicy | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { resources, isLoading: resourcesLoading } = useResources()

  const defs = useMemo(
    () =>
      resources
        .filter(isAccessManageable)
        .slice()
        .sort((a, b) => a.plural.localeCompare(b.plural)),
    [resources]
  )

  const domains = useMemo<ResolvedAccessDomain[]>(() => {
    if (!policy) return []
    const [areas, definitions, instances] = agentPolicyDomainDefaults(policy)

    return [
      {
        key: areas.key,
        title: areas.title,
        defaultRow: { label: areas.defaultLabel, level: AGENT_LEVEL[areas.level] },
        groups: groupAreaRows(policy),
      },
      {
        key: definitions.key,
        title: definitions.title,
        defaultRow: { label: definitions.defaultLabel, level: AGENT_LEVEL[definitions.level] },
        isLoading: resourcesLoading,
        loadingLabel: 'Loading record types…',
        rows: defs.map((resource) => ({
          id: resource.entityDefinitionId,
          label: resource.plural,
          description: resource.apiSlug,
          icon: <EntityIcon iconId={resource.icon} color={resource.color} size='xs' />,
          level:
            AGENT_LEVEL[
              resolveAgentLevel(policy.definitions, resource.apiSlug, policy.definitions.default)
            ],
          isOverride: hasAgentOverride(policy.definitions, resource.apiSlug),
        })),
      },
      {
        key: instances.key,
        title: instances.title,
        defaultRow: { label: instances.defaultLabel, level: AGENT_LEVEL[instances.level] },
        // Driven off `AGENT_POLICY_INSTANCE_KEYS`, not `INSTANCE_ACCESS_KEYS` —
        // the latter carries `agent`, which an agent policy never expresses.
        rows: AGENT_POLICY_INSTANCE_KEYS.map((type) => {
          const perType = policy.resources?.[type]
          const perTypeOverrides = Object.keys(perType?.overrides ?? {}).length
          const meta = INSTANCE_TYPE_META[type]
          return {
            id: type,
            label: meta.label,
            icon: <meta.icon className='size-4' />,
            description:
              perTypeOverrides > 0
                ? `${meta.description} ${perTypeOverrides} with a rule of their own.`
                : meta.description,
            level: AGENT_LEVEL[perType?.default ?? policy.resourceDefault],
            isOverride: perType !== undefined,
          }
        }),
      },
    ]
  }, [policy, defs, resourcesLoading])

  return (
    <ResolvedAccessDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Resolved policy'
      description='The exact rung for every area, record type, and resource.'
      levelMeta={AGENT_LEVEL_META}
      domains={domains}
      emptyTitle='No policy resolved'
      emptyDescription='Pick a profile first.'
    />
  )
}

/** Areas grouped by their registry group, matching the human permissions grid. */
function groupAreaRows(policy: AgentPermissionPolicy) {
  const groups: Array<{ label: string; rows: ResolvedAccessRow[] }> = []

  for (const area of AREA_ORDER) {
    const meta = PERMISSION_AREAS[area]
    if (meta.workerOnly) continue

    const row: ResolvedAccessRow = {
      id: area,
      label: meta.label,
      description: meta.description,
      level: AGENT_LEVEL[resolveAgentLevel(policy.areas, area, policy.areas.default)],
      isOverride: hasAgentOverride(policy.areas, area),
    }

    const bucket = groups.find((g) => g.label === meta.group)
    if (bucket) bucket.rows.push(row)
    else groups.push({ label: meta.group, rows: [row] })
  }

  return groups
}
