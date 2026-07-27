// apps/web/src/components/permissions/ui/agent-policy-resources-grid.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  PERMISSION_AREAS,
} from '@auxx/lib/permissions/client'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { BookOpen, Database, LayoutDashboard, Library } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import type { NormalizedAgentPolicy } from '../hooks/use-agent-policy'
import { useInstanceResourceLists } from '../hooks/use-instance-resource-lists'
import { AGENT_LEVEL_LABELS, AGENT_LEVEL_RANK, RESOURCE_AREA_CLAMP } from './agent-policy-copy'
import { AgentPolicyDefaultRow, AgentPolicyLevelControl } from './agent-policy-level-control'

/** Display metadata per shareable resource type. */
const TYPE_META: Record<InstanceAccessKey, { label: string; icon: ReactNode }> = {
  dataset: { label: 'Datasets', icon: <Database className='size-4' /> },
  kb: { label: 'Knowledge bases', icon: <BookOpen className='size-4' /> },
  dashboard: { label: 'Dashboards', icon: <LayoutDashboard className='size-4' /> },
}

const CHILD_DEPTH = 1

/**
 * The exact per-resource grid: a global default, a default per resource type, and
 * sparse per-instance overrides.
 *
 * Per-instance rules exist for a reason the plan states directly (§0.28): without
 * them an agent profile could *add* a dataset/KB/dashboard grant but could never
 * reliably *remove* access inherited from an open baseline — which is the whole
 * point of SET semantics.
 *
 * Two behaviours here follow the runtime rather than the storage shape:
 *  - a resource rule is intersected with its L2 area, so the grid shows when an
 *    area rung is the thing actually deciding (`AgentPolicyCapabilities.instanceLevel`);
 *  - a type that follows the global default has no entry at all, so "follow the
 *    default" on a type row drops its instance rules too — confirmed, never silent.
 */
export function AgentPolicyResourcesGrid({
  policy,
  onDefaultChange,
  onTypeDefaultChange,
  onClearType,
  onInstanceChange,
  disabled = false,
}: {
  policy: NormalizedAgentPolicy
  onDefaultChange: (level: AgentAccessLevel) => void
  onTypeDefaultChange: (type: string, level: AgentAccessLevel) => void
  onClearType: (type: string) => void
  onInstanceChange: (type: string, instanceId: string, level: AgentAccessLevel | undefined) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState<Partial<Record<InstanceAccessKey, boolean>>>({})
  const instances = useInstanceResourceLists(open)
  const [confirm, ConfirmDialog] = useConfirm()

  /** The rung each type's area allows — the ceiling every row below it is min'd with. */
  const areaCeiling = useMemo(() => {
    const ceilings = {} as Record<InstanceAccessKey, { label: string; level: AgentAccessLevel }>
    for (const key of INSTANCE_ACCESS_KEYS) {
      const area = INSTANCE_ACCESS_RESOURCES[key].area
      const level = policy.areas.overrides[area] ?? policy.areas.default
      ceilings[key] = { label: PERMISSION_AREAS[area].label, level }
    }
    return ceilings
  }, [policy.areas])

  const handleTypeChange = async (type: InstanceAccessKey, level: AgentAccessLevel | undefined) => {
    if (level !== undefined) {
      onTypeDefaultChange(type, level)
      return
    }
    const overrideCount = Object.keys(policy.resources[type]?.overrides ?? {}).length
    if (overrideCount > 0) {
      const confirmed = await confirm({
        title: `Follow the resource default for ${TYPE_META[type].label.toLowerCase()}?`,
        description: `This removes the ${overrideCount} per-item rule${overrideCount === 1 ? '' : 's'} on this type as well. The shape has nowhere to keep them once the type follows the default.`,
        confirmText: 'Remove rules',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }
    onClearType(type)
  }

  return (
    <div className='flex flex-col gap-3'>
      <ConfirmDialog />

      <AgentPolicyDefaultRow
        title='Default for every resource'
        description='What a resource type with no rule of its own resolves to, including types added later.'
        value={policy.resourceDefault}
        onChange={onDefaultChange}
        disabled={disabled}
      />

      <div className='flex flex-col gap-0.5'>
        {INSTANCE_ACCESS_KEYS.map((type) => {
          const entry = policy.resources[type]
          const typeLevel = entry?.default ?? policy.resourceDefault
          const ceiling = areaCeiling[type]
          const clamped = AGENT_LEVEL_RANK[ceiling.level] < AGENT_LEVEL_RANK[typeLevel]
          const list = instances[type]
          const isOpen = open[type] === true
          const knownIds = new Set(list.items.map((i) => i.id))
          const orphans = Object.keys(entry?.overrides ?? {})
            .filter((id) => !knownIds.has(id))
            .sort()

          return (
            <TreeRow
              key={type}
              rowClassName='bg-primary-50 hover:bg-primary-100'
              icon={TYPE_META[type].icon}
              title={TYPE_META[type].label}
              description={`Per-item rules live under this row. Effective access is the lower of this rule and the ${ceiling.label} area.`}
              secondary={
                clamped ? (
                  <Tooltip
                    content={`The ${ceiling.label} area is set to ${AGENT_LEVEL_LABELS[ceiling.level]}, so every item here resolves to at most ${AGENT_LEVEL_LABELS[ceiling.level]} whatever these rules say.`}>
                    <span className='rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'>
                      Clamped by {ceiling.label}
                    </span>
                  </Tooltip>
                ) : undefined
              }
              expandable
              isOpen={isOpen}
              onToggleOpen={() => setOpen((prev) => ({ ...prev, [type]: !isOpen }))}
              actions={
                <AgentPolicyLevelControl
                  label={TYPE_META[type].label}
                  value={entry?.default}
                  fallback={policy.resourceDefault}
                  resetTooltip={`Follow the resource default (${AGENT_LEVEL_LABELS[policy.resourceDefault]}), removing this type's per-item rules`}
                  onChange={(level) => void handleTypeChange(type, level)}
                  disabled={disabled}
                />
              }>
              {list.isLoading ? (
                <div className='flex flex-col gap-0.5'>
                  <TreeRowSkeleton depth={CHILD_DEPTH} />
                  <TreeRowSkeleton depth={CHILD_DEPTH} />
                </div>
              ) : list.items.length === 0 && orphans.length === 0 ? (
                <EmptySection
                  orientation='horizontal'
                  icon={<Library />}
                  title={`No ${TYPE_META[type].label.toLowerCase()}`}
                  description={`Nothing to rule on yet. Anything created later resolves to ${AGENT_LEVEL_LABELS[typeLevel]}.`}
                />
              ) : (
                <div className='flex flex-col gap-0.5'>
                  {list.items.map((item) => (
                    <TreeRow
                      key={item.id}
                      depth={CHILD_DEPTH}
                      rowClassName='bg-primary-50 hover:bg-primary-100'
                      title={<span className='truncate'>{item.name}</span>}
                      trailing={
                        <AgentPolicyLevelControl
                          label={item.name}
                          value={entry?.overrides[item.id]}
                          fallback={typeLevel}
                          onChange={(level) => onInstanceChange(type, item.id, level)}
                          disabled={disabled}
                        />
                      }
                    />
                  ))}
                  {orphans.map((id) => (
                    <TreeRow
                      key={id}
                      depth={CHILD_DEPTH}
                      rowClassName='bg-primary-50 hover:bg-primary-100'
                      title={<span className='truncate text-muted-foreground'>{id}</span>}
                      description='This rule names an item that no longer exists (or is outside the first page listed here). It is kept until you clear it.'
                      secondary={
                        <span className='text-xs text-muted-foreground'>Unknown item</span>
                      }
                      trailing={
                        <AgentPolicyLevelControl
                          label={id}
                          value={entry?.overrides[id]}
                          fallback={typeLevel}
                          onChange={(level) => onInstanceChange(type, id, level)}
                          disabled={disabled}
                        />
                      }
                    />
                  ))}
                  {list.truncated ? (
                    <p className='px-1 py-1 text-xs text-muted-foreground'>
                      Showing the first page only. Rule on anything not listed here from that
                      resource’s own page.
                    </p>
                  ) : null}
                </div>
              )}
            </TreeRow>
          )
        })}
      </div>

      <p className='px-1 text-xs text-muted-foreground'>{RESOURCE_AREA_CLAMP}</p>
    </div>
  )
}
