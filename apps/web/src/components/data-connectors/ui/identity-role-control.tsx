// apps/web/src/components/data-connectors/ui/identity-role-control.tsx
'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { Check, KeyRound } from 'lucide-react'
import { useMappingConnector } from './mapping-connector-context'

/** The identity role a binding plays (relationship-linking v3 §9.4). */
export type IdentityRole = 'externalId' | 'match' | null

/**
 * The unified identity-role control (relationship-linking v3 §9.4) — one `KeyRound`
 * icon that replaces both the old silent external-id guess and the separate "Match"
 * badge. State is conveyed by visibility + color (the glyph never changes):
 *   • none → hover-reveal, muted;  • External ID → always-on, primary/blue;
 *   • Match → always-on, amber. Click opens a tiny context-aware popover.
 *
 * Shared by source-leaf rows (keyed by source path) and formula rows (keyed by entry
 * id), so the affordance reads identically wherever an identifier can be designated.
 */
export function IdentityRoleControl({
  role,
  canMatch,
  appManaged,
  onChange,
}: {
  role: IdentityRole
  /** Show the "Match existing" option (needs a bound target to compare against). */
  canMatch: boolean
  /**
   * This leaf belongs to an app OWNED mapping, where the connector declares the record's
   * External ID (a real column stamped by the seeder). When true: the leaf that IS the
   * External ID renders as a non-interactive blue key ("managed"), and every OTHER leaf
   * drops the "External ID" option so the user can't designate a competing one that would
   * silently override the app's record identity (see connector-declared-external-id-plan).
   */
  appManaged?: boolean
  onChange: (role: IdentityRole) => void
}) {
  // The app's display title for the managed tooltip is a tree-wide constant — read it from
  // context rather than prop-drilling it through every SourceNode/leaf/formula.
  const { appLabel } = useMappingConnector()
  // The connector-declared External ID leaf: read-only, blue, no popover. It's stamped by
  // the seeder and equals the app's `ConnectorRecord.externalId` — the user never edits it.
  if (appManaged && role === 'externalId') {
    return (
      <SimpleTooltip
        side='top'
        delayDuration={500}
        content={`External ID · managed by ${appLabel ?? 'the connector'} — the upstream key that dedups this record.`}>
        <span className='inline-flex size-4 shrink-0 items-center justify-center text-primary'>
          <KeyRound className='size-3.5' />
        </span>
      </SimpleTooltip>
    )
  }
  const tooltip =
    role === 'externalId'
      ? 'External ID — the upstream key that dedups this record and anchors its links.'
      : role === 'match'
        ? 'Match — a secondary key used to adopt an existing record (external id stays primary).'
        : 'Mark as an identifier (External ID or Match).'
  return (
    <Popover>
      <SimpleTooltip side='top' delayDuration={500} content={tooltip}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors',
              role === 'externalId' && 'text-primary',
              role === 'match' && 'text-amber-500',
              !role &&
                'text-muted-foreground/0 group-hover/tree-row:text-muted-foreground/50 hover:text-muted-foreground'
            )}>
            <KeyRound className='size-3.5' />
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align='start' className='w-52 p-1'>
        <RoleOption label='Not an identifier' active={!role} onClick={() => onChange(null)} />
        {!appManaged && (
          <RoleOption
            label='External ID'
            hint='Primary upstream key'
            active={role === 'externalId'}
            onClick={() => onChange('externalId')}
          />
        )}
        {canMatch && (
          <RoleOption
            label='Match existing'
            hint='Secondary adoption key'
            active={role === 'match'}
            onClick={() => onChange('match')}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function RoleOption({
  label,
  hint,
  active,
  onClick,
}: {
  label: string
  hint?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted'>
      <Check className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
      <span className='flex flex-col'>
        <span>{label}</span>
        {hint && <span className='text-[10px] text-muted-foreground'>{hint}</span>}
      </span>
    </button>
  )
}
