// apps/web/src/components/permissions/ui/agent-policy-instance-rows.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { BookOpen, Database, LayoutDashboard, Library, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import type { InstanceResourceItem } from '../hooks/use-instance-resource-lists'
import { AccessLevelSelect } from './access-level-select'
import { allInstancesTitle } from './agent-policy-copy'
import { permissionLabel } from './level-labels'
import type { AgentPolicyInstanceKey } from './profile-copy'

/** Indent of every agent-policy child row under its area row. */
const CHILD_DEPTH = 1

/**
 * Display metadata per shareable resource type. The plural label is what the
 * "All X" row is named after, so it also reaches the host's destructive-confirm
 * copy — exported rather than duplicated there.
 *
 * Keyed by {@link AgentPolicyInstanceKey}, NOT `InstanceAccessKey`: `agent`
 * joined the instance-access registry in 2026-07-28's agents slice, and an
 * agent policy has nothing to say about which agents an agent may reach. See
 * that type for why the exclusion is structural rather than a runtime filter.
 */
export const RESOURCE_TYPE_META: Record<
  AgentPolicyInstanceKey,
  { label: string; icon: ReactNode }
> = {
  dataset: { label: 'Datasets', icon: <Database className='size-4' /> },
  kb: { label: 'Knowledge bases', icon: <BookOpen className='size-4' /> },
  dashboard: { label: 'Dashboards', icon: <LayoutDashboard className='size-4' /> },
  workflow: { label: 'Workflows', icon: <Workflow className='size-4' /> },
}

interface AgentPolicyInstanceRowsProps {
  type: AgentPolicyInstanceKey
  /** `resources[type].default`, or `undefined` when the type has no entry at all. */
  typeDefault: ResourcePermission | undefined
  /** `resourceDefault` — what a type with no entry of its own resolves to. */
  resourceDefault: ResourcePermission
  /** The sparse per-instance rules of this type. */
  overrides: Partial<Record<string, ResourcePermission>>
  /** Instances that survived the host's filter. */
  items: InstanceResourceItem[]
  /** Override ids naming an instance that is gone (or outside the first page). */
  orphans: string[]
  isLoading?: boolean
  /** More instances exist than were listed — say so rather than implying totality. */
  truncated?: boolean
  /**
   * The "All X" row changed. `undefined` means *follow the resource default*,
   * which DROPS this type's per-item rules — the host confirms before calling.
   */
  onTypeDefaultChange: (level: ResourcePermission | undefined) => void
  onInstanceChange: (instanceId: string, level: ResourcePermission | undefined) => void
  disabled?: boolean
}

/**
 * The child block under one instance-access area (Datasets / Knowledge bases /
 * Dashboards / Workflows) in the unified agent-policy tree (plan 29 §1.1): the
 * **"All X"** type-default row, then one row per listed instance, then the
 * orphan rows, then the truncation note.
 *
 * Per-instance rules exist for the reason plan 19 §0.28 states directly: without
 * them an agent profile could *add* a dataset/KB/dashboard grant but could never
 * reliably *remove* access, which is the whole point of SET semantics.
 *
 * The area rung above these rows is the ceiling every one of them is `min`'d
 * with at run time (`AgentPolicyCapabilities.instanceLevel`). That used to need a
 * *"Clamped by Knowledge base"* badge because the rung lived on another screen;
 * with the rows nested under the area row, the nesting states it (§1.2).
 *
 * **The "All X" row is destructive in one direction.** Setting it back to
 * `Default` removes the type's entry, and its per-item rules go with it because
 * the stored shape has nowhere to keep them. The row says so, and the host
 * confirms before the call lands.
 */
export function AgentPolicyInstanceRows({
  type,
  typeDefault,
  resourceDefault,
  overrides,
  items,
  orphans,
  isLoading = false,
  truncated = false,
  onTypeDefaultChange,
  onInstanceChange,
  disabled = false,
}: AgentPolicyInstanceRowsProps) {
  const meta = RESOURCE_TYPE_META[type]
  /** What an instance with no rule of its own resolves to. */
  const typeLevel = typeDefault ?? resourceDefault
  const overrideCount = Object.keys(overrides).length

  return (
    <div className='flex flex-col gap-0.5'>
      <TreeRow
        depth={CHILD_DEPTH}
        rowClassName='bg-primary-50 hover:bg-primary-100'
        icon={meta.icon}
        title={allInstancesTitle(meta.label)}
        description={
          overrideCount > 0
            ? `What a ${meta.label.toLowerCase().replace(/s$/, '')} with no rule of its own resolves to, including ones created later. Choosing Default follows the resource default (${permissionLabel(resourceDefault)}) and removes the ${overrideCount} per-item rule${overrideCount === 1 ? '' : 's'} below with it.`
            : `What a ${meta.label.toLowerCase().replace(/s$/, '')} with no rule of its own resolves to, including ones created later.`
        }
        trailing={
          <AccessLevelSelect
            value={typeDefault}
            includeInherit
            includeNone
            inheritLabelText='Default'
            inheritedLevel={resourceDefault}
            onInherit={() => onTypeDefaultChange(undefined)}
            onChange={onTypeDefaultChange}
            disabled={disabled}
            size='sm'
            variant='transparent'
            className='h-7 w-44'
          />
        }
      />

      {isLoading ? (
        <>
          <TreeRowSkeleton depth={CHILD_DEPTH} />
          <TreeRowSkeleton depth={CHILD_DEPTH} />
        </>
      ) : items.length === 0 && orphans.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<Library />}
          title={`No ${meta.label.toLowerCase()}`}
          description={`Nothing to rule on yet. Anything created later resolves to ${permissionLabel(typeLevel)}.`}
        />
      ) : (
        <>
          {items.map((item) => (
            <TreeRow
              key={item.id}
              depth={CHILD_DEPTH}
              rowClassName='bg-primary-50 hover:bg-primary-100'
              title={<span className='truncate'>{item.name}</span>}
              trailing={
                <AccessLevelSelect
                  value={overrides[item.id]}
                  includeInherit
                  includeNone
                  inheritLabelText='Default'
                  inheritedLevel={typeLevel}
                  onInherit={() => onInstanceChange(item.id, undefined)}
                  onChange={(level) => onInstanceChange(item.id, level)}
                  disabled={disabled}
                  size='sm'
                  variant='transparent'
                  className='h-7 w-44'
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
              secondary={<span className='text-xs text-muted-foreground'>Unknown item</span>}
              trailing={
                <AccessLevelSelect
                  value={overrides[id]}
                  includeInherit
                  includeNone
                  inheritLabelText='Default'
                  inheritedLevel={typeLevel}
                  onInherit={() => onInstanceChange(id, undefined)}
                  onChange={(level) => onInstanceChange(id, level)}
                  disabled={disabled}
                  size='sm'
                  variant='transparent'
                  className='h-7 w-44'
                />
              }
            />
          ))}

          {truncated ? (
            <p className='px-1 py-1 text-xs text-muted-foreground'>
              Showing the first page only. Rule on anything not listed here from that resource’s own
              page.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
