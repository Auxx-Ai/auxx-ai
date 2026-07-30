// apps/web/src/components/permissions/ui/access-level-select.tsx
'use client'

import { ResourcePermission } from '@auxx/database/enums'
import type { Area } from '@auxx/lib/permissions/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { areaRungHelper, areaRungLabel } from './area-access-copy'
import { LEVEL_OF_PERMISSION, permissionLabel } from './level-labels'

/**
 * The records-specific second line under each option. The LABEL comes from the
 * shared rung vocabulary ({@link permissionLabel}); only this helper sentence is
 * local, because it is worded for entity-def records and would be wrong on the
 * area or resource surfaces that share the labels.
 *
 * The area surfaces no longer read it: an {@link AccessLevelSelectProps.area}
 * routes both label and helper through `area-access-copy.ts` instead (plan 43
 * §2.1a, the item 2b nit). This stays the default for every caller with no area
 * context — the per-def rows, whose wording it was written for.
 */
const ACCESS_LEVEL_HELPERS: Record<ResourcePermission, string> = {
  [ResourcePermission.none]: 'Cannot see these records',
  [ResourcePermission.view]: 'Can view records',
  [ResourcePermission.edit]: 'Can view and edit records',
  [ResourcePermission.admin]: 'Full access to records',
}

/**
 * Sentinel Select value for the grantee-axis "no explicit grant" option — the
 * grantee follows the def's workspace baseline (capability layer v2
 * grantee-def-access). Distinct from every `ResourcePermission` string, so it
 * never collides with `none/view/edit/admin`.
 */
const INHERIT = 'inherit' as const

/**
 * The DEFAULT name and helper for the fall-through option, both overridable.
 *
 * Plan 43 §5.3's `Private` rename is not a second inherit vocabulary — it is this
 * same option under a caller-supplied label, because for `signature` / `snippet` /
 * `personal_inbox` no `role:org_member` row exists anywhere, so "Inherit" and
 * "Restricted" were one state wearing two names. That caller passes
 * `inheritLabelText='Private'`, its own `inheritHelperText`, and NO
 * `inheritedLevel` — which is what drops the meaningless `· No access` suffix.
 */
const INHERIT_LABEL = { label: 'Inherit', helper: 'What they get by default' }

/**
 * Positive levels offered to grantee rows (removing the row is the revoke).
 *
 * **Deliberately not filtered by the area's rungs** (plan 43 §5.4). An INSTANCE
 * row keeps offering `Read+write` even where the area ladder has no `Edit` rung —
 * `ResourcePermission.edit` is a real per-instance tier asserted by
 * `assertEditInstance`, and §3.1 dropped the *area* rung, not that tier. The one
 * caller that must follow the rungs is the area access row, which passes an
 * explicit {@link AccessLevelSelectProps.levels} list instead.
 */
const POSITIVE_LEVELS: ResourcePermission[] = [
  ResourcePermission.view,
  ResourcePermission.edit,
  ResourcePermission.admin,
]

/** All four levels, offered on the workspace baseline row (`includeNone`). */
const ALL_LEVELS: ResourcePermission[] = [ResourcePermission.none, ...POSITIVE_LEVELS]

interface AccessLevelSelectProps {
  /** `undefined` renders as `Inherit` (only meaningful with `includeInherit`). */
  value: ResourcePermission | undefined
  onChange: (value: ResourcePermission) => void
  /** Include the `No access` option — only baseline-editing rows offer it. */
  includeNone?: boolean
  /**
   * Include the `Inherit` option — no stored row; the value falls through to
   * {@link inheritedLevel}. Selecting it calls {@link onInherit}. Combines with
   * `includeNone` for the per-def workspace baselines on the permissions page,
   * where Inherit (fall through to the Records level) and No access (restrict
   * the def) are both meaningful.
   */
  includeInherit?: boolean
  /** Called when `Inherit` is chosen (revoke the grantee's explicit row). */
  onInherit?: () => void
  /**
   * With `includeInherit`, the level the grantee inherits by default — rendered
   * inline on the Inherit option (e.g. "Inherit · Full access") so the default is
   * legible without a separate label.
   */
  inheritedLevel?: ResourcePermission
  /**
   * Name for the `Inherit` option. AGENT grantees pass `'Default'` — they
   * compose by SET over an all-Full base, so there is no baseline to inherit
   * FROM and "Inherit" would misdescribe the state (capability layer v2 §0.2).
   */
  inheritLabelText?: string
  /**
   * Helper line under the `Inherit` option. Defaults to *"What they get by
   * default"*; the `Private` rows (plan 43 §5.3) replace it, because nothing is
   * inherited there.
   */
  inheritHelperText?: string
  /**
   * The capability area this picker edits, when there is one. Routes both the
   * option LABELS and their helper lines through `area-access-copy.ts` —
   * `Signatures · Use / Create` instead of `Read only / Full access`, and a
   * dataset row that no longer says *"Can view records"* (plan 43 §2.1a).
   *
   * Absent on every per-def and per-instance row: those pickers answer a
   * question about ONE item, and the area copy is written for the workspace
   * default lane ("every unrestricted dataset"), which would be a more
   * confidently wrong sentence than the generic one it replaced.
   */
  area?: Area
  /**
   * Exact option list, overriding the `includeNone` derivation. The area access
   * row passes `PERMISSION_AREAS[area].rungs` mapped through `permissionOfLevel`
   * so each area offers exactly its own rungs — 4 for `datasets`, 3 for
   * `inboxes`, 3 for the plan-43 three (§5.2). Everything else leaves it unset
   * and keeps {@link POSITIVE_LEVELS} / {@link ALL_LEVELS}.
   */
  levels?: ResourcePermission[]
  disabled?: boolean
  size?: 'xs' | 'sm' | 'default'
  variant?: 'default' | 'transparent'
  className?: string
}

/**
 * The access-level picker for the entity-def Access UI. A `Select` over the
 * relevant levels mapping labels ⇄ `ResourcePermission` (`none/view/edit/admin`):
 * - **baseline row** (`includeNone`, phase 3) — No access / Read only / Read and write / Full
 *   access.
 * - **per-def grantee row** (phase 3) — the three positive levels (the remove
 *   button is the revoke).
 * - **grantee-axis row** (`includeInherit`, grantee-def-access) — Inherit / the
 *   three positive rungs, where Inherit = no explicit grant (`onInherit`).
 * - **def baseline row on the permissions grid** (`includeInherit` +
 *   `includeNone`) — Inherit / No access / the three positive rungs, where
 *   Inherit = no stored baseline (the def falls through to the Records area).
 * - **area access row** (`includeInherit` + `area` + `levels`, plan 43 §5.2) —
 *   Inherit / exactly the rungs `PERMISSION_AREAS[area]` offers, labelled and
 *   explained in that area's own vocabulary.
 * Controlled and dumb — persistence lives in the hook.
 */
export function AccessLevelSelect({
  value,
  onChange,
  includeNone = false,
  includeInherit = false,
  onInherit,
  inheritedLevel,
  inheritLabelText = INHERIT_LABEL.label,
  inheritHelperText = INHERIT_LABEL.helper,
  area,
  levels: levelsProp,
  disabled = false,
  size = 'sm',
  variant = 'default',
  className,
}: AccessLevelSelectProps) {
  const levels = levelsProp ?? (includeNone ? ALL_LEVELS : POSITIVE_LEVELS)

  /** The rung label — area vocabulary where there is one, the shared ladder otherwise. */
  const labelOf = (level: ResourcePermission) =>
    area !== undefined
      ? areaRungLabel(area, LEVEL_OF_PERMISSION[level])
      : permissionLabel(level, 'long')

  /**
   * The helper line. `areaRungHelper` returns `''` for a rung an area has no copy
   * for, which the option list should never ask for — but the records wording is
   * a better fallback than an empty second line if it ever does.
   */
  const helperOf = (level: ResourcePermission) =>
    (area !== undefined ? areaRungHelper(area, LEVEL_OF_PERMISSION[level]) : '') ||
    ACCESS_LEVEL_HELPERS[level]

  if (includeInherit) {
    // Inherit = absence of a stored row (value undefined); the offered levels below.
    const safeValue = value && levels.includes(value) ? value : INHERIT
    const inheritLabel =
      inheritedLevel !== undefined
        ? `${inheritLabelText} · ${labelOf(inheritedLevel)}`
        : inheritLabelText
    return (
      <Select
        value={safeValue}
        onValueChange={(next) =>
          next === INHERIT ? onInherit?.() : onChange(next as ResourcePermission)
        }
        disabled={disabled}>
        <SelectTrigger size={size} variant={variant} className={className}>
          <SelectValue placeholder='Access'>
            {safeValue === INHERIT ? inheritLabel : labelOf(safeValue)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align='end' className='min-w-52'>
          <SelectItem value={INHERIT} textValue={inheritLabel}>
            <div className='flex flex-col items-start'>
              <span>{inheritLabel}</span>
              <span className='text-muted-foreground text-xs'>{inheritHelperText}</span>
            </div>
          </SelectItem>
          {levels.map((level) => (
            <SelectItem key={level} value={level} textValue={labelOf(level)}>
              <div className='flex flex-col items-start'>
                <span>{labelOf(level)}</span>
                <span className='text-muted-foreground text-xs'>{helperOf(level)}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // Never feed Radix an unknown/none value on a positive-only select.
  const safeValue = value && levels.includes(value) ? value : ResourcePermission.view

  return (
    <Select
      value={safeValue}
      onValueChange={(next) => onChange(next as ResourcePermission)}
      disabled={disabled}>
      <SelectTrigger size={size} variant={variant} className={className}>
        <SelectValue placeholder='Access'>{labelOf(safeValue)}</SelectValue>
      </SelectTrigger>
      <SelectContent align='end' className='min-w-52'>
        {levels.map((level) => (
          <SelectItem key={level} value={level} textValue={labelOf(level)}>
            <div className='flex flex-col items-start'>
              <span>{labelOf(level)}</span>
              <span className='text-muted-foreground text-xs'>{helperOf(level)}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
