// apps/web/src/components/permissions/ui/access-level-select.tsx
'use client'

import { ResourcePermission } from '@auxx/database/enums'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { permissionLabel } from './level-labels'

/**
 * The records-specific second line under each option. The LABEL comes from the
 * shared rung vocabulary ({@link permissionLabel}); only this helper sentence is
 * local, because it is worded for entity-def records and would be wrong on the
 * area or resource surfaces that share the labels.
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

const INHERIT_LABEL = { label: 'Inherit', helper: 'What they get by default' }

/** Positive levels offered to grantee rows (removing the row is the revoke). */
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
  disabled = false,
  size = 'sm',
  variant = 'default',
  className,
}: AccessLevelSelectProps) {
  const levels = includeNone ? ALL_LEVELS : POSITIVE_LEVELS

  if (includeInherit) {
    // Inherit = absence of a stored row (value undefined); the offered levels below.
    const safeValue = value && levels.includes(value) ? value : INHERIT
    const inheritLabel =
      inheritedLevel !== undefined
        ? `${inheritLabelText} · ${permissionLabel(inheritedLevel, 'long')}`
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
            {safeValue === INHERIT ? inheritLabel : permissionLabel(safeValue, 'long')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align='end' className='min-w-52'>
          <SelectItem value={INHERIT} textValue={inheritLabel}>
            <div className='flex flex-col items-start'>
              <span>{inheritLabel}</span>
              <span className='text-muted-foreground text-xs'>{INHERIT_LABEL.helper}</span>
            </div>
          </SelectItem>
          {levels.map((level) => (
            <SelectItem key={level} value={level} textValue={permissionLabel(level, 'long')}>
              <div className='flex flex-col items-start'>
                <span>{permissionLabel(level, 'long')}</span>
                <span className='text-muted-foreground text-xs'>{ACCESS_LEVEL_HELPERS[level]}</span>
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
        <SelectValue placeholder='Access'>{permissionLabel(safeValue, 'long')}</SelectValue>
      </SelectTrigger>
      <SelectContent align='end' className='min-w-52'>
        {levels.map((level) => (
          <SelectItem key={level} value={level} textValue={permissionLabel(level, 'long')}>
            <div className='flex flex-col items-start'>
              <span>{permissionLabel(level, 'long')}</span>
              <span className='text-muted-foreground text-xs'>{ACCESS_LEVEL_HELPERS[level]}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
