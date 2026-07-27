// apps/web/src/components/permissions/ui/grantee-def-access-rows.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Lock, ShieldCheck } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { GranteeDefAccessRow, useGranteeDefAccess } from '../hooks/use-grantee-def-access'
import { AccessLevelSelect } from './access-level-select'

/** Indent of the def rows under the Records area row (matches `DefBaselineRows`). */
const CHILD_DEPTH = 1

/**
 * The nested per-def rows under the Records area row in grantee scopes (member
 * detail, group detail, the overrides tab) — the grantee-centric twin of
 * `DefBaselineRows`. One CRM record type per row with this grantee's
 * `Inherit / Read / Edit / Full` picker, writing the same type-level
 * `ResourceAccess` rows `useGranteeDefAccess` composes.
 *
 * Presentational only — filtering, loading and persistence are owned by the
 * host, exactly like `DefBaselineRows` is host-driven by `MemberBaselineTab`.
 * Rows always nest under the Records area row (capability layer v2 Part B.0);
 * the flat standalone section they were extracted from is gone.
 */
export function GranteeDefAccessRows({
  rows,
  isLoading = false,
  canEdit,
  depth = CHILD_DEPTH,
  onChange,
}: {
  rows: GranteeDefAccessRow[]
  isLoading?: boolean
  canEdit: boolean
  /** Row indent. Defaults to nesting one level under the parent area row. */
  depth?: number
  onChange: (
    entityDefinitionId: string,
    level: Parameters<ReturnType<typeof useGranteeDefAccess>['setLevel']>[1]
  ) => void
}) {
  if (isLoading) {
    return (
      <div className='flex flex-col gap-0.5'>
        <TreeRowSkeleton depth={depth} />
        <TreeRowSkeleton depth={depth} />
        <TreeRowSkeleton depth={depth} />
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
        <DefAccessRow
          key={row.resource.entityDefinitionId}
          row={row}
          canEdit={canEdit}
          depth={depth}
          onChange={(level) => onChange(row.resource.entityDefinitionId, level)}
        />
      ))}
    </div>
  )
}

/** One record-type row: def icon + name, restriction lock, override pill, picker. */
function DefAccessRow({
  row,
  canEdit,
  depth,
  onChange,
}: {
  row: GranteeDefAccessRow
  canEdit: boolean
  depth: number
  onChange: (level: Parameters<ReturnType<typeof useGranteeDefAccess>['setLevel']>[1]) => void
}) {
  const { resource, isLockedDown, grantLevel, inheritedLevel, inheritLabelText, isNoEffect } = row
  const isOverridden = grantLevel !== undefined
  return (
    <TreeRow
      depth={depth}
      rowClassName='bg-primary-50 hover:bg-primary-100'
      icon={<EntityIcon iconId={resource.icon} color={resource.color} size='xs' />}
      title={<span className='truncate'>{resource.plural}</span>}
      secondary={
        isLockedDown ? (
          <Tooltip content='Restricted: hidden from everyone by default. Only members you grant access (directly or via a team) can see this type.'>
            <Lock className='size-3 text-muted-foreground' />
          </Tooltip>
        ) : undefined
      }
      actions={
        <>
          {isOverridden && (
            <Tooltip
              content={
                isNoEffect
                  ? 'This override is at or below the default, so it changes nothing.'
                  : 'Overrides the default for this record type.'
              }>
              <Badge
                variant='secondary'
                size='xs'
                className={cn(isNoEffect && 'border-amber-300 text-amber-600')}>
                Override
              </Badge>
            </Tooltip>
          )}
          <AccessLevelSelect
            value={grantLevel}
            includeInherit
            inheritedLevel={inheritedLevel}
            inheritLabelText={inheritLabelText}
            onInherit={() => onChange('inherit')}
            onChange={(level) => onChange(level)}
            disabled={!canEdit}
            size='sm'
            variant='transparent'
            className='h-7 w-44'
          />
        </>
      }
    />
  )
}
