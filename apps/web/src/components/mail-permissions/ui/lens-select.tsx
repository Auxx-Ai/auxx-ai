// apps/web/src/components/mail-permissions/ui/lens-select.tsx
'use client'

import { LENS_CHOICES, LENS_LABELS, type LensChoice } from '@auxx/lib/permissions/visibility/client'
import { Badge } from '@auxx/ui/components/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useState } from 'react'
import {
  GranularPermissionsUpgradeDialog,
  useGranularPermissionsGated,
} from './granular-permissions-gate'

interface LensSelectProps {
  value: LensChoice
  onChange: (value: LensChoice) => void
  /** Renders the separator + Manager entry (inbox surface only). */
  includeManager?: boolean
  disabled?: boolean
  size?: 'sm' | 'default'
  /** SelectTrigger style — `transparent` to sit flush inside a FieldPanelRow. */
  variant?: 'default' | 'transparent'
  className?: string
}

/**
 * The one tier picker every mail-permission surface uses. Options below
 * Full access (and the Manager entry) are plan-gated: without the
 * feature they render with an "Upgrade" badge and selecting one opens
 * the upgrade dialog instead of changing the value. The badge is deliberately
 * plan-agnostic — `granularPermissions` is Growth+, not Enterprise-only.
 */
export function LensSelect({
  value,
  onChange,
  includeManager = false,
  disabled = false,
  size = 'sm',
  variant = 'default',
  className,
}: LensSelectProps) {
  const gated = useGranularPermissionsGated()
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const handleChange = (next: string) => {
    const choice = next as LensChoice
    if (gated && choice !== 'read') {
      setUpgradeOpen(true)
      return
    }
    onChange(choice)
  }

  const upgradeBadge = (
    <Badge variant='outline' className='ml-2 px-1 text-[10px]'>
      Upgrade
    </Badge>
  )

  // Never feed Radix an unknown value — it renders the placeholder fallback and,
  // via its hidden native <select>, warns on non-scalar values. Guards regressions.
  const safeValue = LENS_LABELS[value] ? value : 'read'

  return (
    <>
      <Select value={safeValue} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger size={size} variant={variant} className={className}>
          <SelectValue placeholder='Access'>{LENS_LABELS[safeValue]?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent align='end' className='min-w-56'>
          {LENS_CHOICES.map((lens) => (
            <SelectItem key={lens} value={lens} textValue={LENS_LABELS[lens].label}>
              <div className='flex flex-col items-start'>
                <span className='flex items-center'>
                  {LENS_LABELS[lens].label}
                  {gated && lens !== 'read' && upgradeBadge}
                </span>
                <span className='text-muted-foreground text-xs'>{LENS_LABELS[lens].helper}</span>
              </div>
            </SelectItem>
          ))}
          {includeManager && (
            <>
              <SelectSeparator />
              <SelectItem value='manager' textValue={LENS_LABELS.manager.label}>
                <div className='flex flex-col items-start'>
                  <span className='flex items-center'>
                    {LENS_LABELS.manager.label}
                    {gated && upgradeBadge}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {LENS_LABELS.manager.helper}
                  </span>
                </div>
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      <GranularPermissionsUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </>
  )
}
