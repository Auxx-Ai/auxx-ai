// apps/web/src/components/permissions/ui/agent-policy-level-select.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import { AlertTriangle } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { AccessLevelSelect } from './access-level-select'
import { agentLevelOfPermission, permissionOfAgentLevel } from './level-labels'

type AgentPolicyLevelSelectProps = {
  /**
   * A rung this row's target cannot express, as a sentence. Rendered as an amber
   * warning BESIDE the trigger (plan 26 §2.2) rather than inside the option list,
   * so it stays visible while the menu is closed. No grid computes one today —
   * record types and resource instances implement the whole ladder — but the
   * trigger-side slot is what keeps a future one from being buried in a menu.
   */
  inertNote?: string
  disabled?: boolean
} & (
  | {
      /**
       * The concrete rung an unset row resolves to: the collection default.
       * Present ⇒ the row MAY carry no rule of its own, so a `Default · <rung>`
       * option is offered and selecting it emits `undefined`.
       */
      fallback: AgentAccessLevel
      /**
       * The stored rung. `undefined` means "this key carries no rule of its own,
       * so {@link fallback} answers" — never a third state of the ladder, and
       * never a run-time value.
       */
      value: AgentAccessLevel | undefined
      onChange: (level: AgentAccessLevel | undefined) => void
    }
  | {
      /**
       * Absent ⇒ this row IS a collection default (plan 29 §2.2's "All record
       * types" row): mandatory, so there is nothing to fall through to and the
       * `Default` option must not be offered. Offering it would be a dead
       * option that emits a value the store has nowhere to put.
       */
      fallback?: undefined
      value: AgentAccessLevel
      onChange: (level: AgentAccessLevel) => void
    }
)

/**
 * The agent-policy rule picker for EVERY child row of the unified area tree
 * (plan 29 §2.2) — the "All record types" / "All datasets" collection defaults,
 * the per-record-type rows, and the per-instance rows. Since those rows all sit
 * under the area row whose rung they are `min`'d with, they share one widget;
 * only the AREA rows themselves keep the human `LevelControl`, which knows each
 * area's real ladder (plan 26 §2.3).
 *
 * It is a thin wrapper, and the two things it must not lose in the wrapping are:
 *  - **`None` is a first-class, selectable rung** (`includeNone`) — for an agent
 *    it is a deliberate deny, never "not set" (plan 19 §7). This is exactly why
 *    the human "positive levels only" mode is not reused here.
 *  - **Unset reads as the default it resolves to** — `includeInherit` +
 *    `inheritLabelText='Default'` renders "Default · Read and write", so the word
 *    *default* never appears without the concrete rung standing behind it.
 *
 * `AccessLevelSelect` is typed in `ResourcePermission`; the conversion is the
 * bijection in `level-labels.ts`, so nothing is widened or clamped in transit.
 * With a `fallback`, selecting Default emits `undefined`; without one there is
 * no Default option and every option emits an `AgentAccessLevel`.
 */
export function AgentPolicyLevelSelect(props: AgentPolicyLevelSelectProps) {
  const { inertNote, disabled = false } = props

  return (
    <div className='flex items-center gap-1'>
      {inertNote ? (
        <Tooltip content={inertNote}>
          <AlertTriangle className='size-3.5 text-amber-500' />
        </Tooltip>
      ) : null}

      {props.fallback === undefined ? (
        <AccessLevelSelect
          value={permissionOfAgentLevel(props.value)}
          includeNone
          onChange={(permission) => props.onChange(agentLevelOfPermission(permission))}
          disabled={disabled}
          size='sm'
          variant='transparent'
          className='h-7 w-44'
        />
      ) : (
        <AccessLevelSelect
          value={props.value === undefined ? undefined : permissionOfAgentLevel(props.value)}
          includeInherit
          includeNone
          inheritLabelText='Default'
          inheritedLevel={permissionOfAgentLevel(props.fallback)}
          onInherit={() => props.onChange(undefined)}
          onChange={(permission) => props.onChange(agentLevelOfPermission(permission))}
          disabled={disabled}
          size='sm'
          variant='transparent'
          className='h-7 w-44'
        />
      )}
    </div>
  )
}
