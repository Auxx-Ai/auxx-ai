// apps/web/src/components/permissions/ui/grantee-instance-rows.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { type InstanceAccessKey, Level } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { AlertTriangle, Library } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import type { InstanceGranteeRow } from '../hooks/use-instance-grantee-rows'
import { AccessLevelSelect } from './access-level-select'
import { InstanceShareBody } from './instance-share-body'
import {
  deadGrantWarning,
  INSTANCE_ROW_COPY,
  INSTANCE_SHARE_COPY,
  INSTANCE_TYPE_META,
} from './instance-share-copy'

/** Indent of the instance rows under their Datasets / Knowledge base / Dashboards area row. */
const CHILD_DEPTH = 1

/**
 * The nested per-instance rows under a Datasets / Knowledge base / Dashboards
 * area row in a **grantee scope** (a member/team's own overrides — capability
 * layer v2 Part B): one dataset/KB/dashboard per row with THIS grantee's own
 * explicit grant — Inherit (no row) / Read / Read+write / Full / No Access.
 *
 * Unlike the area-level grid above it, this picker is **not raise-only**
 * (§B.2.6): it writes the grantee's raw `ResourceAccess` row through
 * `grantInstance`/`revokeInstance`, so it can restrict a specific instance for
 * one member even while their area level stays open. Copy therefore never uses
 * "override"/"raise" language — see `instance-share-copy.ts`'s `grantee` entry.
 *
 * Expanding a row lazily mounts `InstanceShareBody` — the same grantee list
 * the Share card and dialog show, covering every OTHER grantee on that
 * instance (not just this one).
 *
 * Dead-grant warning (§B.2.8): shown only for `user` grantees (`isUser`),
 * using the composed area level the HOST already knows from the same grid
 * (the area row sits directly above these rows) — no extra server call.
 */
export function GranteeInstanceRows({
  rows,
  isLoading = false,
  canEdit,
  isUser,
  areaLevel,
  areaLabel,
  onChange,
}: {
  rows: InstanceGranteeRow[]
  isLoading?: boolean
  canEdit: boolean
  /** Whether this grantee is a single member (vs. a team) — gates the dead-grant warning. */
  isUser: boolean
  /** This grantee's own composed level for the area these instances belong to. */
  areaLevel: Level
  areaLabel: string
  onChange: (
    key: InstanceAccessKey,
    instanceId: string,
    level: ResourcePermission | 'inherit'
  ) => void
}) {
  if (isLoading) {
    return (
      <div className='flex flex-col gap-0.5'>
        <TreeRowSkeleton depth={CHILD_DEPTH} />
        <TreeRowSkeleton depth={CHILD_DEPTH} />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptySection
        orientation='horizontal'
        icon={<Library />}
        title='No matches'
        description='No items match your search.'
      />
    )
  }

  const showDeadGrantWarning = isUser && areaLevel === Level.None

  return (
    <div className='flex flex-col gap-0.5'>
      {rows.map((row) => (
        <GranteeInstanceRowItem
          key={`${row.key}:${row.id}`}
          row={row}
          disabled={!canEdit}
          showDeadGrantWarning={showDeadGrantWarning}
          areaLabel={areaLabel}
          onChange={(level) => onChange(row.key, row.id, level)}
        />
      ))}
    </div>
  )
}

function GranteeInstanceRowItem({
  row,
  disabled,
  showDeadGrantWarning,
  areaLabel,
  onChange,
}: {
  row: InstanceGranteeRow
  disabled: boolean
  showDeadGrantWarning: boolean
  areaLabel: string
  onChange: (level: ResourcePermission | 'inherit') => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const meta = INSTANCE_TYPE_META[row.key]
  const recordId = toRecordId(row.key, row.id)
  const isDeadGrant = showDeadGrantWarning && row.grantLevel !== undefined

  return (
    <TreeRow
      depth={CHILD_DEPTH}
      rowClassName='bg-primary-50 hover:bg-primary-100'
      icon={<meta.icon className='size-4' />}
      title={<span className='truncate'>{row.name}</span>}
      description={INSTANCE_ROW_COPY.grantee.description(INSTANCE_SHARE_COPY[row.key].noun)}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((v) => !v)}
      actions={
        <>
          {isDeadGrant && (
            <Tooltip content={deadGrantWarning(areaLabel)}>
              <AlertTriangle className='size-3.5 text-amber-500' />
            </Tooltip>
          )}
          {row.badge === 'restricted' ? (
            <Badge variant='secondary' size='xs'>
              Restricted
            </Badge>
          ) : typeof row.badge === 'number' ? (
            <Badge variant='secondary' size='xs'>
              Shared · {row.badge}
            </Badge>
          ) : undefined}
          <AccessLevelSelect
            value={row.grantLevel}
            includeInherit
            includeNone
            onInherit={() => onChange('inherit')}
            onChange={(level) => onChange(level)}
            disabled={disabled}
            size='sm'
            variant='transparent'
            className='h-7 w-44'
          />
        </>
      }>
      {isOpen && <InstanceShareBody recordId={recordId} depth={CHILD_DEPTH + 1} />}
    </TreeRow>
  )
}
