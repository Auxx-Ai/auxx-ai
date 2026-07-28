// apps/web/src/components/permissions/ui/instance-baseline-rows.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import type { InstanceAccessKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { Library } from 'lucide-react'
import { useState } from 'react'
import type { InstanceBaselineRow } from '../hooks/use-instance-baseline-rows'
import { ACCESS_ROW_DEPTH, AccessRowSelect } from './access-tree-row'
import { InstanceShareBody } from './instance-share-body'
import { INSTANCE_ROW_COPY, INSTANCE_TYPE_META } from './instance-share-copy'
import { InstanceTruncationNote } from './instance-truncation-note'

/** Indent of the instance rows under their collection row. */
const CHILD_DEPTH = ACCESS_ROW_DEPTH

/**
 * The per-instance rows under a Datasets / Knowledge bases / Dashboards /
 * Workflows collection on the Workspace defaults tab (capability layer v2
 * Part B) — the
 * instance twin of `DefBaselineRows`. One dataset/KB/dashboard per row with
 * its **workspace baseline** picker (the `role:org_member` row the standalone
 * Share card's own baseline row writes): Inherit (no row) / Read / Read+write /
 * Full / No Access ("Restricted"). Expanding a row lazily mounts
 * `InstanceShareBody` — the same grantee list the Share card and dialog show.
 *
 * Presentational: filtering, loading and persistence are owned by the host
 * (`WorkspaceDefaultsTab` + `useInstanceBaselineRows`), exactly like
 * `DefBaselineRows`.
 *
 * **Keeps its expand** where `GranteeInstanceRows` lost it (plan 31 §2.1): this
 * row's subject IS everyone, so the grantees nested under it are exactly the
 * exceptions to the level it sets. On a grantee row they would be a different
 * subject entirely.
 *
 * That is also why the row itself stays on `TreeRow` rather than `AccessTreeRow`
 * (plan 33 §7.3): the shared primitive deliberately offers no `expandable`, so
 * this family cannot collapse into it without putting that distinction behind a
 * boolean. Only the picker is shared, which is where the two genuinely agree.
 */
export function InstanceBaselineRows({
  rows,
  isLoading = false,
  disabled = false,
  truncated = false,
  onChange,
}: {
  rows: InstanceBaselineRow[]
  isLoading?: boolean
  disabled?: boolean
  /**
   * More instances exist than `useInstanceResourceLists` fetched. Says so rather
   * than implying the list is complete — the grid's search only ever matched
   * within the first page (plan 31 finding 5).
   */
  truncated?: boolean
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
      <>
        <EmptySection
          orientation='horizontal'
          icon={<Library />}
          title='No matches'
          description='No items match your search.'
        />
        {truncated ? <InstanceTruncationNote /> : null}
      </>
    )
  }

  return (
    <div className='flex flex-col gap-0.5'>
      {rows.map((row) => (
        <InstanceBaselineRowItem
          key={`${row.key}:${row.id}`}
          row={row}
          disabled={disabled}
          onChange={(level) => onChange(row.key, row.id, level)}
        />
      ))}
      {truncated ? <InstanceTruncationNote /> : null}
    </div>
  )
}

function InstanceBaselineRowItem({
  row,
  disabled,
  onChange,
}: {
  row: InstanceBaselineRow
  disabled: boolean
  onChange: (level: ResourcePermission | 'inherit') => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const meta = INSTANCE_TYPE_META[row.key]
  const recordId = toRecordId(row.key, row.id)

  return (
    <TreeRow
      depth={CHILD_DEPTH}
      rowClassName='bg-primary-50 hover:bg-primary-100'
      icon={<meta.icon className='size-4' />}
      title={<span className='truncate'>{row.name}</span>}
      description={INSTANCE_ROW_COPY.baseline.description}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((v) => !v)}
      actions={
        <>
          {row.badge === 'restricted' ? (
            <Badge variant='secondary' size='xs'>
              Restricted
            </Badge>
          ) : typeof row.badge === 'number' ? (
            <Badge variant='secondary' size='xs'>
              Shared · {row.badge}
            </Badge>
          ) : undefined}
          <AccessRowSelect
            value={row.baselineLevel}
            includeInherit
            includeNone
            inheritedLevel={row.inheritedLevel}
            onInherit={() => onChange('inherit')}
            onChange={(level) => onChange(level)}
            disabled={disabled}
          />
        </>
      }>
      {isOpen && (
        <InstanceShareBody
          recordId={recordId}
          depth={CHILD_DEPTH + 1}
          emptyHint={INSTANCE_ROW_COPY.baseline.emptyHint}
        />
      )}
    </TreeRow>
  )
}
