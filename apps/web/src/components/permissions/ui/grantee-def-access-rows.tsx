// apps/web/src/components/permissions/ui/grantee-def-access-rows.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { TreeRowEmpty, TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Lock, ShieldCheck, Table2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { ACCESS_ROW_DEPTH, AccessRowSelect, AccessTreeRow } from './access-tree-row'

/**
 * One record-type row, in the vocabulary the ROW needs — not the vocabulary
 * either host happens to hold. Both callers pre-compose it (plan 33 §2): the
 * human hosts through `useGranteeDefAccess`, the agent editor in its own
 * `renderChildren`, where the policy already is.
 *
 * **The identity field is `id`, not `key`.** Its instance sibling
 * ({@link InstanceAccessRow}) already spends `key` on the resource TYPE, so
 * reusing it here would make two neighbouring models disagree about one word —
 * and a field literally named `key` invites a `{...row}` spread that React
 * swallows as the reserved prop.
 */
export interface DefAccessRow {
  /** React key, and what `onChange` echoes back. Human: the def id. Agent: the `apiSlug`. */
  id: string
  /** `null` draws the generic record-type glyph — an orphan has no def to draw. */
  icon: { iconId: string; color: string } | null
  title: string
  /** `TooltipExplanation` help text (the agent surface names the policy key here). */
  description?: string
  /** This row's own explicit rule; `undefined` = follows {@link inheritedLevel}. */
  grantLevel: ResourcePermission | undefined
  /** What the row resolves to with no rule of its own — shown on the Inherit option. */
  inheritedLevel: ResourcePermission
  /** Name for that option. The agent surface passes `'Default'` (it inherits from nothing). */
  inheritLabelText?: string
  /** Human only — the def is restricted, so non-grantees cannot see it at all. */
  isLockedDown?: boolean
  /** Human only — the rule is at or below the default, so it changes nothing. */
  isNoEffect?: boolean
  /** The rule names a target this workspace no longer has. */
  isOrphan?: boolean
}

/** What a list says when it has nothing to show — four surfaces, four true things. */
export interface AccessRowsEmptyState {
  icon: ReactNode
  title: string
  description: string
}

const SEARCH_MISS: AccessRowsEmptyState = {
  icon: <ShieldCheck />,
  title: 'No matches',
  description: 'No record types match your search.',
}

/** Orphan copy is constant per family, so the row owns it rather than every host. */
const ORPHAN_SECONDARY = 'Unknown type'
const ORPHAN_DESCRIPTION =
  'This rule names a record type that no longer exists in this workspace. It is kept until you clear it, and does nothing meanwhile.'

/**
 * The nested per-record-type rows under a Records area row — **the only
 * per-def child-row renderer** (plan 33 §1). Four hosts drive it: the profile
 * editor, the grantee overrides tab, a member/team's Access levels section, and
 * the agent policy editor, whose own pair of row files this replaced.
 *
 * Presentational only — filtering, loading and persistence belong to the host,
 * exactly like `DefBaselineRows` is host-driven by `WorkspaceDefaultsTab`. Rows
 * always nest under the area row (capability layer v2 Part B.0).
 *
 * Two things the hosts disagree about on purpose, so they are props rather than
 * behaviour baked in here:
 *  - **`includeNone`.** An agent policy is a SET and must be able to DENY a
 *    record type. A human def grant composes max-wins with `'none'` skipped, so
 *    per-def restriction for one grantee is not expressible and the option must
 *    stay absent (plan 33 §7.2 — an asymmetry to keep, not to smooth over).
 *  - **`leadingRow`.** The agent's *"All record types"* collection default has no
 *    human counterpart: it is that policy's composition model made visible
 *    (§1/§4.1), so it is built by the host and rendered above the list.
 */
export function GranteeDefAccessRows({
  rows,
  isLoading = false,
  canEdit,
  depth = ACCESS_ROW_DEPTH,
  includeNone = false,
  leadingRow,
  emptyState = SEARCH_MISS,
  onChange,
}: {
  rows: DefAccessRow[]
  isLoading?: boolean
  canEdit: boolean
  /** Row indent. Defaults to nesting one level under the parent area row. */
  depth?: number
  /** Offer `No access` — SET-semantics surfaces only. See the doc comment. */
  includeNone?: boolean
  /**
   * Rendered above the list and OUTSIDE the loading/empty branches: a row that
   * says what the rows below fall through to is exactly what a reader needs while
   * they are still loading, or when there are none.
   */
  leadingRow?: ReactNode
  emptyState?: AccessRowsEmptyState
  onChange: (id: string, level: ResourcePermission | 'inherit') => void
}) {
  return (
    <div className='flex flex-col gap-0.5'>
      {leadingRow}

      {isLoading ? (
        <>
          <TreeRowSkeleton depth={depth} />
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
          <DefAccessRowItem
            key={row.id}
            row={row}
            canEdit={canEdit}
            depth={depth}
            includeNone={includeNone}
            onChange={(level) => onChange(row.id, level)}
          />
        ))
      )}
    </div>
  )
}

/** One record-type row: icon + name, restriction lock, override pill, picker. */
function DefAccessRowItem({
  row,
  canEdit,
  depth,
  includeNone,
  onChange,
}: {
  row: DefAccessRow
  canEdit: boolean
  depth: number
  includeNone: boolean
  onChange: (level: ResourcePermission | 'inherit') => void
}) {
  const { icon, isLockedDown, isOrphan, grantLevel, inheritedLevel, inheritLabelText, isNoEffect } =
    row
  const isOverridden = grantLevel !== undefined

  return (
    <AccessTreeRow
      depth={depth}
      muted={isOrphan}
      icon={
        icon ? (
          <EntityIcon iconId={icon.iconId} color={icon.color} size='xs' />
        ) : (
          <Table2 className={cn('size-4', isOrphan && 'text-muted-foreground')} />
        )
      }
      title={row.title}
      description={isOrphan ? ORPHAN_DESCRIPTION : row.description}
      secondary={
        isOrphan ? (
          <span className='text-muted-foreground text-xs'>{ORPHAN_SECONDARY}</span>
        ) : isLockedDown ? (
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
          <AccessRowSelect
            value={grantLevel}
            includeInherit
            includeNone={includeNone}
            inheritedLevel={inheritedLevel}
            inheritLabelText={inheritLabelText}
            onInherit={() => onChange('inherit')}
            onChange={(level) => onChange(level)}
            disabled={!canEdit}
          />
        </>
      }
    />
  )
}
