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

/** The label + helper shown for each access level in the def-access selects. */
export const ACCESS_LEVEL_LABELS: Record<ResourcePermission, { label: string; helper: string }> = {
  [ResourcePermission.none]: { label: 'No Access', helper: 'Cannot see these records' },
  [ResourcePermission.view]: { label: 'Read only', helper: 'Can view records' },
  [ResourcePermission.edit]: { label: 'Read and write', helper: 'Can view and edit records' },
  [ResourcePermission.admin]: { label: 'Full access', helper: 'Full access to records' },
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
  /** Include the `No Access` option — only the workspace baseline offers it. */
  includeNone?: boolean
  /**
   * Include the `Inherit` option (grantee axis) — no explicit grant row; the
   * grantee follows the def baseline. Selecting it calls {@link onInherit}.
   * Mutually exclusive with `includeNone`.
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
  disabled?: boolean
  size?: 'xs' | 'sm' | 'default'
  variant?: 'default' | 'transparent'
  className?: string
}

/**
 * The access-level picker for the entity-def Access UI. A `Select` over the
 * relevant levels mapping labels ⇄ `ResourcePermission` (`none/view/edit/admin`):
 * - **baseline row** (`includeNone`, phase 3) — No Access / Read / Edit / Full.
 * - **per-def grantee row** (phase 3) — the three positive levels (the remove
 *   button is the revoke).
 * - **grantee-axis row** (`includeInherit`, grantee-def-access) — Inherit / Read
 *   / Edit / Full, where Inherit = no explicit grant (calls `onInherit`).
 * Controlled and dumb — persistence lives in the hook.
 */
export function AccessLevelSelect({
  value,
  onChange,
  includeNone = false,
  includeInherit = false,
  onInherit,
  inheritedLevel,
  disabled = false,
  size = 'sm',
  variant = 'default',
  className,
}: AccessLevelSelectProps) {
  const levels = includeNone ? ALL_LEVELS : POSITIVE_LEVELS

  if (includeInherit) {
    // Inherit = absence of a grant row (value undefined); positive levels below.
    const safeValue = value && POSITIVE_LEVELS.includes(value) ? value : INHERIT
    const inheritLabel =
      inheritedLevel !== undefined
        ? `Inherit · ${ACCESS_LEVEL_LABELS[inheritedLevel].label}`
        : INHERIT_LABEL.label
    return (
      <Select
        value={safeValue}
        onValueChange={(next) =>
          next === INHERIT ? onInherit?.() : onChange(next as ResourcePermission)
        }
        disabled={disabled}>
        <SelectTrigger size={size} variant={variant} className={className}>
          <SelectValue placeholder='Access'>
            {safeValue === INHERIT ? inheritLabel : ACCESS_LEVEL_LABELS[safeValue].label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align='end' className='min-w-52'>
          <SelectItem value={INHERIT} textValue={inheritLabel}>
            <div className='flex flex-col items-start'>
              <span>{inheritLabel}</span>
              <span className='text-muted-foreground text-xs'>{INHERIT_LABEL.helper}</span>
            </div>
          </SelectItem>
          {POSITIVE_LEVELS.map((level) => (
            <SelectItem key={level} value={level} textValue={ACCESS_LEVEL_LABELS[level].label}>
              <div className='flex flex-col items-start'>
                <span>{ACCESS_LEVEL_LABELS[level].label}</span>
                <span className='text-muted-foreground text-xs'>
                  {ACCESS_LEVEL_LABELS[level].helper}
                </span>
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
        <SelectValue placeholder='Access'>{ACCESS_LEVEL_LABELS[safeValue].label}</SelectValue>
      </SelectTrigger>
      <SelectContent align='end' className='min-w-52'>
        {levels.map((level) => (
          <SelectItem key={level} value={level} textValue={ACCESS_LEVEL_LABELS[level].label}>
            <div className='flex flex-col items-start'>
              <span>{ACCESS_LEVEL_LABELS[level].label}</span>
              <span className='text-muted-foreground text-xs'>
                {ACCESS_LEVEL_LABELS[level].helper}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
