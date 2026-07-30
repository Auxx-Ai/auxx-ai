// apps/web/src/components/permissions/ui/def-baseline-rows.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { EntityIcon } from '@auxx/ui/components/icons'
import { TreeRowEmpty, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { Lock, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Tooltip } from '~/components/global/tooltip'
import type { DefBaselineRow } from '../hooks/use-def-baselines'
import { ACCESS_ROW_DEPTH, AccessRowSelect, AccessTreeRow } from './access-tree-row'

/** Indent of the def rows under their collection row. */
const CHILD_DEPTH = ACCESS_ROW_DEPTH

/**
 * The per-def rows under the Record types collection on the Workspace
 * defaults tab:
 * one CRM record type per row with its **workspace baseline** picker (the same
 * "Default for all members" value the def's own Permissions tab writes).
 *
 * "Inherit" means no `role:org_member` row exists — the def falls through to its
 * base area's level on the Member permission profile, named inline on the option
 * so the two never look out of sync. **No Access** restricts the def for everyone but
 * admins and explicit grantees, marked with the same lock the grantee-centric
 * Access section uses. The trailing chevron drills into the def's Permissions
 * tab, where per-team / per-member grants live.
 *
 * Presentational: filtering, loading and persistence are owned by the host
 * (`WorkspaceDefaultsTab` + `useDefBaselines`).
 */
export function DefBaselineRows({
  rows,
  isLoading = false,
  disabled = false,
  onChange,
}: {
  rows: DefBaselineRow[]
  isLoading?: boolean
  disabled?: boolean
  onChange: (entityDefinitionId: string, level: ResourcePermission | 'inherit') => void
}) {
  const router = useRouter()

  if (isLoading) {
    return (
      <div className='flex flex-col gap-0.5'>
        <TreeRowSkeleton depth={CHILD_DEPTH} />
        <TreeRowSkeleton depth={CHILD_DEPTH} />
        <TreeRowSkeleton depth={CHILD_DEPTH} />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <TreeRowEmpty
        depth={CHILD_DEPTH}
        icon={<ShieldCheck />}
        title='No matches'
        description='No record types match your search.'
      />
    )
  }

  return (
    <div className='flex flex-col gap-0.5'>
      {rows.map((row) => (
        <AccessTreeRow
          key={row.resource.entityDefinitionId}
          depth={CHILD_DEPTH}
          icon={<EntityIcon iconId={row.resource.icon} color={row.resource.color} size='xs' />}
          title={row.resource.plural}
          secondary={
            row.isLockedDown ? (
              <Tooltip content='Restricted: hidden from everyone by default. Only members you grant access (directly or via a team) can see this type.'>
                <Lock className='size-3 text-muted-foreground' />
              </Tooltip>
            ) : undefined
          }
          actions={
            <AccessRowSelect
              value={row.baselineLevel}
              includeInherit
              includeNone
              inheritedLevel={row.inheritedLevel}
              inheritLabelText={row.inheritLabelText}
              onInherit={() => onChange(row.resource.entityDefinitionId, 'inherit')}
              onChange={(level) => onChange(row.resource.entityDefinitionId, level)}
              disabled={disabled}
            />
          }
          onDrill={() =>
            router.push(`/app/settings/custom-fields/${row.resource.apiSlug}?tab=permissions`)
          }
        />
      ))}
    </div>
  )
}
