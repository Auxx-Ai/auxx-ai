// apps/web/src/components/permissions/ui/grantee-instance-rows.tsx
'use client'

import { ResourcePermission } from '@auxx/database/enums'
import { type InstanceAccessKey, Level } from '@auxx/lib/permissions/client'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { AlertTriangle, Library, Users } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import type { InstanceGranteeRow } from '../hooks/use-instance-grantee-rows'
import { AccessLevelSelect } from './access-level-select'
import {
  deadGrantWarning,
  INSTANCE_ROW_COPY,
  INSTANCE_SHARE_COPY,
  INSTANCE_TYPE_META,
} from './instance-share-copy'
import { InstanceShareDialog } from './instance-share-dialog'
import { InstanceTruncationNote } from './instance-truncation-note'
import { effectiveLevelLabel, LEVEL_OF_PERMISSION } from './level-labels'

/** Indent of the instance rows under their Datasets / Knowledge base / Dashboards area row. */
const CHILD_DEPTH = 1

/**
 * The effective-access line (plan 31 §2.5) — what this grantee can ACTUALLY
 * open, beside the grant they hold.
 *
 * Without it, plan 31 finding 4 is invisible: `instanceAccess` is `max` by
 * `PERMISSION_RANK` with `none` ranked 0, so a user-level `No access` LOSES to
 * any group's `view`. The admin sets No access, the select changes, nothing
 * happens, and the screen says nothing. `Effective: Read` beside a `No access`
 * select is what makes that legible — which is why §2.5 calls this the half that
 * is not optional polish.
 *
 * **Deviation from §2.5, which puts this in the row's `description` slot:** in
 * `TreeRow` that slot is a `TooltipExplanation` help icon, not visible text, so
 * it would hide the one thing this exists to show. It goes in `secondary`, the
 * visible slot beside the title. `description` keeps its existing row copy.
 *
 * **Unconditional**, on every row that has an effective level to report — the
 * same rule the area rows above now follow. Both surfaces once differed here
 * (the area grid showed its line only where composition disagreed with the
 * ladder), which made a missing line mean two different things depending on the
 * row it was missing from.
 *
 * Level only, no source attribution — that is phase 3, and it needs a
 * `user:capabilities` bump because composition discards which row won.
 */
function effectiveLabel(level: ResourcePermission | null): string {
  const rung = level === null ? Level.None : LEVEL_OF_PERMISSION[level]
  return `Effective · ${effectiveLevelLabel(rung)}`
}

/**
 * The nested per-instance rows under a Datasets / Knowledge base / Dashboards /
 * Workflows area row in a **grantee scope** (a member/team/profile's own
 * overrides — capability layer v2 Part B): one instance per row with THIS
 * grantee's own explicit grant — Inherit (no row) / Read / Read+write / Full /
 * No Access.
 *
 * Unlike the area-level grid above it, this picker is **not raise-only**
 * (§B.2.6): it writes the grantee's raw `ResourceAccess` row through
 * `grantInstance`/`revokeInstance`, so it can restrict a specific instance for
 * one member even while their area level stays open. Copy therefore never uses
 * "override"/"raise" language — see `instance-share-copy.ts`'s `grantee` entry.
 *
 * **These rows are leaves** (plan 31 §2.1). They used to expand into
 * `InstanceShareBody`, which lists *every* grantee on the instance — so a page
 * about Alice ran area level (Alice) → instance grant (Alice) → all grantees
 * (everyone), and let you edit and revoke Bob's access from Alice's screen. All
 * three call sites are single-grantee, so nothing wanted it. The rule that keeps
 * this from being arbitrary: *the expand belongs to a row whose subject is
 * everyone, because its children are the exceptions to that row.* Here the
 * children were a different subject, which is why it read as a scope jump.
 *
 * The capability survives as a **"Manage sharing"** action opening
 * `InstanceShareDialog` (§2.3) — the same scope switch, made explicit as a modal
 * titled *Share <noun>* rather than ambient tree depth. One dialog is hoisted for
 * the whole list, so N rows do not mount N dialogs.
 *
 * The `Shared · N` / `Restricted` badge went with the expand (§2.2): it is
 * org-scope information (how many *other* people hold this instance) on a page
 * about one person. `InstanceBaselineRows` keeps its own, where that count is
 * the point of the row.
 *
 * Dead-row warning (§B.2.8, re-aimed by plan 25 §2): shown only for `user`
 * grantees (`isUser`), using the composed area level the HOST already knows from
 * the same grid (the area row sits directly above these rows) — no extra server
 * call. An explicit row now beats the area floor, so a positive grant on a
 * `None`-area member is a real single-instance share; only an explicit
 * `No access` row on such a member is inert, because it takes away access they
 * never had.
 */
export function GranteeInstanceRows({
  rows,
  isLoading = false,
  truncated = false,
  canEdit,
  isUser,
  areaLevel,
  areaLabel,
  onChange,
}: {
  rows: InstanceGranteeRow[]
  isLoading?: boolean
  /** More instances exist than were fetched — see {@link InstanceTruncationNote}. */
  truncated?: boolean
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
  /**
   * The instance whose Share dialog is open, or `null`. Hoisted out of the row so
   * the list mounts exactly one dialog — and so opening it cannot be mistaken for
   * expanding the row it came from.
   */
  const [sharingRecordId, setSharingRecordId] = useState<RecordId | null>(null)

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

  const showDeadRowWarning = isUser && areaLevel === Level.None

  return (
    <div className='flex flex-col gap-0.5'>
      {rows.map((row) => (
        <GranteeInstanceRowItem
          key={`${row.key}:${row.id}`}
          row={row}
          disabled={!canEdit}
          showDeadRowWarning={showDeadRowWarning}
          areaLabel={areaLabel}
          onManageSharing={() => setSharingRecordId(toRecordId(row.key, row.id))}
          onChange={(level) => onChange(row.key, row.id, level)}
        />
      ))}
      {truncated ? <InstanceTruncationNote /> : null}

      {sharingRecordId && (
        <InstanceShareDialog
          recordId={sharingRecordId}
          open
          onOpenChange={(open) => {
            if (!open) setSharingRecordId(null)
          }}
        />
      )}
    </div>
  )
}

function GranteeInstanceRowItem({
  row,
  disabled,
  showDeadRowWarning,
  areaLabel,
  onManageSharing,
  onChange,
}: {
  row: InstanceGranteeRow
  disabled: boolean
  showDeadRowWarning: boolean
  areaLabel: string
  onManageSharing: () => void
  onChange: (level: ResourcePermission | 'inherit') => void
}) {
  const meta = INSTANCE_TYPE_META[row.key]
  const isDeadRow = showDeadRowWarning && row.grantLevel === ResourcePermission.none

  return (
    <TreeRow
      depth={CHILD_DEPTH}
      rowClassName='bg-primary-50 hover:bg-primary-100'
      icon={<meta.icon className='size-4' />}
      title={<span className='truncate'>{row.name}</span>}
      description={INSTANCE_ROW_COPY.grantee.description(INSTANCE_SHARE_COPY[row.key].noun)}
      secondary={
        row.effectiveLevel !== undefined ? (
          <span className='whitespace-nowrap text-xs'>{effectiveLabel(row.effectiveLevel)}</span>
        ) : undefined
      }
      actions={
        <>
          {isDeadRow && (
            <Tooltip content={deadGrantWarning(areaLabel)}>
              <AlertTriangle className='size-3.5 text-amber-500' />
            </Tooltip>
          )}
          <TreeRowButton
            tooltipText={`Manage who else can reach this ${INSTANCE_SHARE_COPY[row.key].noun}`}
            aria-label='Manage sharing'
            onClick={onManageSharing}>
            <Users />
          </TreeRowButton>
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
      }
    />
  )
}
