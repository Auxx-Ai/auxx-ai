// apps/web/src/components/agents/ui/detail/restrictions/restriction-required-badge.tsx
'use client'

import { Tooltip } from '~/components/global/tooltip'
import { ModeBadge } from '~/components/shared/mode-badge'

interface RestrictionRequiredBadgeProps {
  required: boolean
  onChange: (required: boolean) => void
  /** Identity-scoped args are forced required (removing it re-opens a fail-closed gap). */
  isIdentityArg?: boolean
}

const AMBER = 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'

/**
 * Collapsing Required/Optional pill mounted left of a restriction's value
 * input. Click toggles `ArgRestriction.required` — independent of source, so it
 * survives constant⇄dynamic toggles. Identity args show it **locked on** with a
 * fail-closed tooltip. See plans/chat/v6 phase-4 redesign.
 */
export function RestrictionRequiredBadge({
  required,
  onChange,
  isIdentityArg,
}: RestrictionRequiredBadgeProps) {
  if (isIdentityArg) {
    return (
      <Tooltip content='Identity-scoped — must stay required, or chat calls would fail closed.'>
        <span className='inline-flex'>
          <ModeBadge label='Required' disabled className={AMBER} />
        </span>
      </Tooltip>
    )
  }

  return required ? (
    <ModeBadge label='Required' className={AMBER} onClick={() => onChange(false)} />
  ) : (
    <ModeBadge
      label='Optional'
      className='bg-muted text-muted-foreground'
      onClick={() => onChange(true)}
    />
  )
}
