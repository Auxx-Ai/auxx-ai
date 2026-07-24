// apps/web/src/components/permissions/ui/def-baseline-rows.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { EntityIcon } from '@auxx/ui/components/icons'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { Lock, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Tooltip } from '~/components/global/tooltip'
import type { DefBaselineRow } from '../hooks/use-def-baselines'
import { AccessLevelSelect } from './access-level-select'

/** Indent of the def rows under the Records area row. */
const CHILD_DEPTH = 1

/**
 * The nested per-def rows under the Records area on the member-baseline grid:
 * one CRM record type per row with its **workspace baseline** picker (the same
 * "Default for all members" value the def's own Permissions tab writes).
 *
 * "Inherit" means no `role:org_member` row exists — the def falls through to the
 * Records level shown on the parent row, named inline on the option so the two
 * never look out of sync. **No Access** restricts the def for everyone but
 * admins and explicit grantees, marked with the same lock the grantee-centric
 * Access section uses. The trailing chevron drills into the def's Permissions
 * tab, where per-team / per-member grants live.
 *
 * Presentational: filtering, loading and persistence are owned by the host
 * (`MemberBaselineTab` + `useDefBaselines`).
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
      <EmptySection
        orientation='horizontal'
        icon={<ShieldCheck />}
        title='No matches'
        description='No record types match your search.'
      />
    )
  }

  return (
    <div className='flex flex-col gap-0.5'>
      {rows.map((row) => (
        <TreeRow
          key={row.resource.entityDefinitionId}
          depth={CHILD_DEPTH}
          rowClassName='bg-primary-50 hover:bg-primary-100'
          icon={<EntityIcon iconId={row.resource.icon} color={row.resource.color} size='xs' />}
          title={<span className='truncate'>{row.resource.plural}</span>}
          secondary={
            row.isLockedDown ? (
              <Tooltip content='Restricted: hidden from everyone by default — only members you grant access (directly or via a team) can see this type.'>
                <Lock className='size-3 text-muted-foreground' />
              </Tooltip>
            ) : undefined
          }
          actions={
            <AccessLevelSelect
              value={row.baselineLevel}
              includeInherit
              includeNone
              inheritedLevel={row.inheritedLevel}
              onInherit={() => onChange(row.resource.entityDefinitionId, 'inherit')}
              onChange={(level) => onChange(row.resource.entityDefinitionId, level)}
              disabled={disabled}
              size='sm'
              variant='transparent'
              className='h-7 w-44'
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
