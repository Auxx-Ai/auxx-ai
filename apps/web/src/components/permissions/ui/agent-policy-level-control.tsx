// apps/web/src/components/permissions/ui/agent-policy-level-control.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import {
  AGENT_LEVEL_DESCRIPTIONS,
  AGENT_LEVEL_ORDER,
  followDefaultTooltip,
  usesDefaultLabel,
} from './agent-policy-copy'
import { agentLevelLabel } from './level-labels'

interface AgentPolicyLevelControlProps {
  /**
   * The stored rung. `undefined` is legal ONLY on an override row and means
   * "this key carries no rule of its own, so `fallback` answers" — it is not a
   * third state of the ladder and it never appears at run time.
   */
  value: AgentAccessLevel | undefined
  /**
   * The concrete rung an unset row resolves to: the collection default. Always
   * rendered next to the control, so "uses the default" is never shown without
   * the level that default actually is (plan 19 §7).
   */
  fallback?: AgentAccessLevel
  /** Emits the new rung, or `undefined` to drop the override (fallback rows only). */
  onChange: (level: AgentAccessLevel | undefined) => void
  disabled?: boolean
  /**
   * A rung this row's target cannot express — e.g. a capability area whose
   * ladder is on/off, where `Read` grants nothing. Rendered as a warning beside
   * the control rather than by hiding a rung, because the stored vocabulary is
   * four levels everywhere and a missing segment would misrepresent the value.
   *
   * NOTE: nothing computes this today (plan 26 §2.2/§2.3). The area rows that
   * used to derive it now render the human `LevelControl`, which cannot offer an
   * inert rung in the first place. It is kept for the rows this control still
   * serves — the collection DEFAULT rows, which span areas and resource types
   * that do not exist yet and so can legitimately carry a rung some future
   * member of the collection cannot express.
   */
  inertNote?: string
  /** Accessible name for the control (the row's label). */
  label: string
  /**
   * Overrides the reset affordance's tooltip. The resources grid needs it: on a
   * resource TYPE row, following the default means dropping the type's entry —
   * and its instance rules go with it, because the shape has nowhere to keep
   * them. A generic "follow the default" would hide that.
   */
  resetTooltip?: string
}

/**
 * The exact four-rung control for the agent policy's few glanceable TOP rows —
 * the three collection defaults and the three resource TYPE rows. The numerous
 * narrow child rows (per record type, per resource item) use
 * `AgentPolicyLevelSelect` instead, and the area rows use the human
 * `LevelControl`, which knows each area's real ladder (plan 26 §2.2/§2.3).
 *
 * What this control keeps that an additive human widget would drop: agent policy
 * is a SET — `None` removes authority, so the ladder is rendered whole rather
 * than as "positive levels plus inherit" (plan 19 §0.5/§2.3/§7).
 *
 * Consequences visible in this component:
 *  - all four rungs are always rendered, so the value is legible as one of four
 *    — correct here precisely because these rows stand in for a whole collection,
 *    including members of it that do not exist yet;
 *  - `None` is a first-class rung labelled *None*, never "inherit"/"not set";
 *  - a row with no rule of its own reads **"Default · Edit"** — the word
 *    *default* is always accompanied by the concrete rung it stands for.
 */
export function AgentPolicyLevelControl({
  value,
  fallback,
  onChange,
  disabled = false,
  inertNote,
  label,
  resetTooltip,
}: AgentPolicyLevelControlProps) {
  const effective = value ?? fallback ?? 'none'
  const isExplicit = value !== undefined
  const canFollowDefault = fallback !== undefined
  const resetLabel = resetTooltip ?? (fallback === undefined ? '' : followDefaultTooltip(fallback))

  return (
    <div className='flex items-center gap-1'>
      {inertNote ? (
        <Tooltip content={inertNote}>
          <AlertTriangle className='size-3.5 text-amber-500' />
        </Tooltip>
      ) : null}

      {canFollowDefault ? (
        <span
          className={cn(
            'whitespace-nowrap text-xs text-muted-foreground',
            isExplicit && 'invisible'
          )}
          aria-hidden={isExplicit}>
          {usesDefaultLabel(fallback)}
        </span>
      ) : null}

      {canFollowDefault ? (
        <Tooltip content={resetLabel}>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            aria-label={resetLabel}
            disabled={disabled || !isExplicit}
            className={cn('size-6 text-muted-foreground', !isExplicit && 'invisible')}
            onClick={() => onChange(undefined)}>
            <Undo2 />
          </Button>
        </Tooltip>
      ) : null}

      <RadioTab
        value={effective}
        onValueChange={(next) => onChange(next as AgentAccessLevel)}
        size='xs'
        aria-label={label}
        radioGroupClassName='after:rounded-lg'
        className='rounded-lg'>
        {AGENT_LEVEL_ORDER.map((level) => (
          <RadioTabItem
            key={level}
            value={level}
            size='xs'
            disabled={disabled}
            tooltip={AGENT_LEVEL_DESCRIPTIONS[level]}
            className='h-full w-auto min-w-0 rounded-lg px-2.5'>
            {agentLevelLabel(level)}
          </RadioTabItem>
        ))}
      </RadioTab>
    </div>
  )
}

/**
 * The header row a collection's explicit default sits on — "everything not named
 * below resolves to this". Rendered above each grid rather than inside it,
 * because §0.5/§2.3 make the default a first-class rule: it is what a definition
 * or resource created *tomorrow* will resolve to.
 */
export function AgentPolicyDefaultRow({
  title,
  description,
  value,
  onChange,
  disabled = false,
}: {
  title: string
  description: string
  value: AgentAccessLevel
  onChange: (level: AgentAccessLevel) => void
  disabled?: boolean
}) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-primary-50 px-3 py-2'>
      <div className='flex min-w-0 flex-col'>
        <span className='text-sm font-medium'>{title}</span>
        <span className='text-xs text-muted-foreground'>{description}</span>
      </div>
      <AgentPolicyLevelControl
        label={title}
        value={value}
        onChange={(level) => level !== undefined && onChange(level)}
        disabled={disabled}
      />
    </div>
  )
}
