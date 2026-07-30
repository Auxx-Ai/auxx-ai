// apps/web/src/components/permissions/ui/grantee-instance-rows.tsx
'use client'

import { ResourcePermission } from '@auxx/database/enums'
import { type InstanceAccessKey, Level } from '@auxx/lib/permissions/client'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { TreeRowButton, TreeRowEmpty, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Library, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { ACCESS_ROW_DEPTH, AccessRowSelect, AccessTreeRow } from './access-tree-row'
import type { AccessRowsEmptyState } from './grantee-def-access-rows'
import { INSTANCE_SHARE_COPY, INSTANCE_TYPE_META } from './instance-share-copy'
import { InstanceShareDialog } from './instance-share-dialog'
import { InstanceTruncationNote } from './instance-truncation-note'
import { effectiveLevelLabel, LEVEL_OF_PERMISSION } from './level-labels'

/**
 * One instance row, in the vocabulary the ROW needs (plan 33 §2). Both callers
 * pre-compose it: the human hosts through `useInstanceGranteeRows`, the agent
 * editor in its own `renderChildren`.
 *
 * `key` is the resource TYPE, not this row's identity — `id` is. The two words
 * are load-bearing and its def sibling ({@link DefAccessRow}) spends `id` the
 * same way on purpose.
 */
export interface InstanceAccessRow {
  key: InstanceAccessKey
  id: string
  name: string
  /** Help text beside the title. Scope-specific, so the composer supplies it. */
  description?: string
  /** This row's own explicit rule; `undefined` = no row, falls through. */
  grantLevel: ResourcePermission | undefined
  /**
   * What a row with no rule of its own resolves to, shown on the fall-through
   * option. The agent surface passes its type default; the HUMAN surface
   * deliberately passes nothing — see the note on {@link GranteeInstanceRows}.
   */
  inheritedLevel?: ResourcePermission
  /** Name for that option — the agent surface passes `'Default'`, not "Inherit". */
  inheritLabelText?: string
  /**
   * Human only — what this grantee can ACTUALLY open, composed server-side.
   * `null` = no access, absent = not applicable (a team/profile has none).
   */
  effectiveLevel?: ResourcePermission | null
  /** The rule names an instance that is gone, or outside the fetched page. */
  isOrphan?: boolean
}

/** Orphan copy is constant per family, so the row owns it rather than every host. */
const ORPHAN_SECONDARY = 'Unknown item'
const ORPHAN_DESCRIPTION =
  'This rule names an item that no longer exists (or is outside the first page listed here). It is kept until you clear it.'

const SEARCH_MISS: AccessRowsEmptyState = {
  icon: <Library />,
  title: 'No matches',
  description: 'No items match your search.',
}

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
 * Workflows / Agents area row — **the only per-instance child-row renderer**
 * (plan 33 §1). Four hosts drive it: the profile editor, the grantee overrides
 * tab, a member/team's Access levels section, and the agent policy editor, whose
 * own row file this replaced.
 *
 * In a **grantee scope** (a member/team/profile's own overrides — capability
 * layer v2 Part B) each row carries THIS grantee's own explicit grant: Inherit
 * (no row) / Read / Read+write / Full / No Access. Unlike the area-level grid
 * above it, this picker is **not raise-only** (§B.2.6): it writes the raw
 * `ResourceAccess` row through `grantInstance`/`revokeInstance`, so it can
 * restrict one instance for one member while their area level stays open. Copy
 * therefore never uses "override"/"raise" language — see `instance-share-copy.ts`.
 *
 * **The deny option is intrinsic here**, not a prop: on both surfaces an
 * instance row is exactly how access is taken away, which is not true one level
 * over on the def rows (plan 33 §7.2 / D4, and the reason `includeNone` is a prop
 * THERE and absent here).
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
 * the whole list, so N rows do not mount N dialogs. `showSharing` turns it off
 * for the agent policy, whose rows author a profile's rule and have no instance
 * whose *sharing* they could manage.
 *
 * The `Shared · N` / `Restricted` badge went with the expand (§2.2): it is
 * org-scope information (how many *other* people hold this instance) on a page
 * about one person. `InstanceBaselineRows` keeps its own, where that count is
 * the point of the row.
 *
 * Dead-row warning (§B.2.8, re-aimed by plan 25 §2): the HOST decides whether it
 * applies at all and hands in the tooltip; this renders it on the rows that are
 * actually inert. An explicit row now beats the area floor, so a positive grant
 * on a `None`-area member is a real single-instance share; only an explicit
 * `No access` row on such a member is dead, because it takes away access they
 * never had.
 *
 * **`inheritedLevel` is optional and the human hosts leave it unset** (plan 33
 * D1/§7.1). The correct value there is *what this grantee reaches without their
 * own row*, and it is not available client-side: `effective.instances[id]`
 * includes the grant, and `effective.instanceFallback[key]` is the org-wide
 * row-less fallback, wrong whenever a group grant exists. Either would trade a
 * missing label for a lying one on the surface where the fall-through is least
 * obvious. Closing it needs a second composed level from `permissions.granteeAccess`.
 */
export function GranteeInstanceRows({
  rows,
  isLoading = false,
  truncated = false,
  canEdit,
  depth = ACCESS_ROW_DEPTH,
  showSharing = true,
  deadGrantTooltip,
  leadingRow,
  emptyState = SEARCH_MISS,
  onChange,
}: {
  rows: InstanceAccessRow[]
  isLoading?: boolean
  /** More instances exist than were fetched — see {@link InstanceTruncationNote}. */
  truncated?: boolean
  canEdit: boolean
  /** Row indent. Defaults to nesting one level under the parent area row. */
  depth?: number
  /** Offer "Manage sharing" (and mount its dialog). Off for the agent policy. */
  showSharing?: boolean
  /**
   * Tooltip for a rule this grantee cannot possibly feel, or `undefined` when the
   * concept does not apply. Replaced `isUser` + `areaLevel` + `areaLabel`, which
   * existed only to compute this one string from inputs the host already holds.
   */
  deadGrantTooltip?: string
  /**
   * Rendered above the list and OUTSIDE the loading/empty branches — the agent's
   * *"All X"* type default, which is what a row reading *"Default · None"* falls
   * through to and so is needed most when the list is empty.
   */
  leadingRow?: ReactNode
  emptyState?: AccessRowsEmptyState
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

  return (
    <div className='flex flex-col gap-0.5'>
      {leadingRow}

      {isLoading ? (
        <>
          <TreeRowSkeleton depth={depth} />
          <TreeRowSkeleton depth={depth} />
        </>
      ) : rows.length === 0 ? (
        <TreeRowEmpty
          depth={depth}
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
        />
      ) : (
        rows.map((row) => (
          <InstanceAccessRowItem
            key={`${row.key}:${row.id}`}
            row={row}
            depth={depth}
            disabled={!canEdit}
            deadGrantTooltip={deadGrantTooltip}
            onManageSharing={
              showSharing ? () => setSharingRecordId(toRecordId(row.key, row.id)) : undefined
            }
            onChange={(level) => onChange(row.key, row.id, level)}
          />
        ))
      )}

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

/** One instance row: type icon + name, dead-rule warning, sharing, picker. */
function InstanceAccessRowItem({
  row,
  depth,
  disabled,
  deadGrantTooltip,
  onManageSharing,
  onChange,
}: {
  row: InstanceAccessRow
  depth: number
  disabled: boolean
  deadGrantTooltip?: string
  /** Absent = this surface offers no sharing action. */
  onManageSharing?: () => void
  onChange: (level: ResourcePermission | 'inherit') => void
}) {
  const meta = INSTANCE_TYPE_META[row.key]
  const isDeadRow = deadGrantTooltip !== undefined && row.grantLevel === ResourcePermission.none

  return (
    <AccessTreeRow
      depth={depth}
      muted={row.isOrphan}
      icon={<meta.icon className={cn('size-4', row.isOrphan && 'text-muted-foreground')} />}
      title={row.name}
      description={row.isOrphan ? ORPHAN_DESCRIPTION : row.description}
      secondary={
        row.isOrphan ? (
          <span className='text-muted-foreground text-xs'>{ORPHAN_SECONDARY}</span>
        ) : row.effectiveLevel !== undefined ? (
          <span className='whitespace-nowrap text-xs'>{effectiveLabel(row.effectiveLevel)}</span>
        ) : undefined
      }
      actions={
        <>
          {isDeadRow && (
            <Tooltip content={deadGrantTooltip}>
              <AlertTriangle className='size-3.5 text-amber-500' />
            </Tooltip>
          )}
          {onManageSharing && (
            <TreeRowButton
              tooltipText={`Manage who else can reach this ${INSTANCE_SHARE_COPY[row.key].noun}`}
              aria-label='Manage sharing'
              onClick={onManageSharing}>
              <Users />
            </TreeRowButton>
          )}
          <AccessRowSelect
            value={row.grantLevel}
            includeInherit
            includeNone
            inheritedLevel={row.inheritedLevel}
            inheritLabelText={row.inheritLabelText}
            onInherit={() => onChange('inherit')}
            onChange={(level) => onChange(level)}
            disabled={disabled}
          />
        </>
      }
    />
  )
}
