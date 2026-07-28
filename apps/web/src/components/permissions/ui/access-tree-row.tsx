// apps/web/src/components/permissions/ui/access-tree-row.tsx
'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'
import { AccessLevelSelect } from './access-level-select'

/**
 * Indent of every access child row under its area row. Every child-row family in
 * this folder nests exactly one level under the `ProfileAreaGrid` /
 * `LeveledAreaGrid` row it belongs to, so the constant lives here rather than
 * once per file (plan 33 §4.1).
 */
export const ACCESS_ROW_DEPTH = 1

/**
 * The frozen row chrome of an access child row — the tinted band that
 * distinguishes a rule row from the area row above it. It appeared as a literal
 * in every child-row file, which is how the four of them drifted apart while
 * looking identical.
 */
const ACCESS_ROW_CLASS = 'bg-primary-50 hover:bg-primary-100'

/**
 * One access child row: a `TreeRow` with the depth, tint and title treatment that
 * every per-def / per-instance / collection-default row in this folder shares.
 *
 * Deliberately thin — it owns **presentation the rows must not disagree about**
 * and nothing else. Which rows exist, what they say and what a change does stay
 * with the components and hosts above it (see `GranteeDefAccessRows`,
 * `GranteeInstanceRows`, and the agent editor's `leadingRow`, which builds its
 * "All X" collection-default row from this same primitive).
 *
 * **It does not expose `expandable` / `children`, on purpose.** Whether a row has
 * children is a statement about its SUBJECT — `InstanceBaselineRows` expands
 * because its subject is everyone and its children are the exceptions to it,
 * while a grantee row's children would be a different subject entirely (plan 31
 * §2.1, and the warning `grantee-instance-rows.test.tsx` opens with). A shared
 * `expandable` boolean is exactly how that distinction would get lost, so the one
 * row family that needs it stays on `TreeRow` directly.
 */
export function AccessTreeRow({
  icon,
  title,
  description,
  secondary,
  muted = false,
  depth = ACCESS_ROW_DEPTH,
  actions,
  onDrill,
}: {
  icon?: ReactNode
  /** Plain text — the row owns the truncation, so every family truncates alike. */
  title: string
  /** `TooltipExplanation` help text beside the title. */
  description?: string
  /** Visible text beside the title (an effective-access line, an orphan note). */
  secondary?: ReactNode
  /** Grey the title — an orphan row naming a target that no longer exists. */
  muted?: boolean
  depth?: number
  /** Right-hand cluster: badges, row buttons, and the access picker. */
  actions?: ReactNode
  /** Trailing drill affordance — navigate to where this row's subject is owned. */
  onDrill?: () => void
}) {
  return (
    <TreeRow
      depth={depth}
      rowClassName={ACCESS_ROW_CLASS}
      icon={icon}
      title={<span className={cn('truncate', muted && 'text-muted-foreground')}>{title}</span>}
      description={description}
      secondary={secondary}
      actions={actions}
      onDrill={onDrill}
    />
  )
}

/**
 * {@link AccessLevelSelect} as an access child row wears it — `sm`, transparent,
 * and sized to the widest rung label. The three style props were repeated at ten
 * call sites; the picker's BEHAVIOUR props (`includeNone`, `includeInherit`,
 * `inheritedLevel`, …) stay with the caller, because those are the semantics of
 * the row and differ on purpose.
 */
export function AccessRowSelect(
  props: Omit<ComponentProps<typeof AccessLevelSelect>, 'size' | 'variant' | 'className'>
) {
  return <AccessLevelSelect {...props} size='sm' variant='transparent' className='h-7 w-44' />
}
