// apps/web/src/components/permissions/ui/agent-policy-level-select.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import { AlertTriangle } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { AccessLevelSelect } from './access-level-select'
import { agentLevelOfPermission, permissionOfAgentLevel } from './level-labels'

interface AgentPolicyLevelSelectProps {
  /**
   * The stored rung. `undefined` means "this key carries no rule of its own, so
   * {@link fallback} answers" — never a third state of the ladder, and never a
   * run-time value.
   */
  value: AgentAccessLevel | undefined
  /** The concrete rung an unset row resolves to: the collection default. */
  fallback: AgentAccessLevel
  /** Emits the new rung, or `undefined` when the row goes back to the default. */
  onChange: (level: AgentAccessLevel | undefined) => void
  /**
   * A rung this row's target cannot express, as a sentence. Rendered as an amber
   * warning BESIDE the trigger (plan 26 §2.2) rather than inside the option list,
   * so it stays visible while the menu is closed. No grid computes one today —
   * record types and resource instances implement the whole ladder — but the
   * trigger-side slot is what keeps a future one from being buried in a menu.
   */
  inertNote?: string
  disabled?: boolean
}

/**
 * The agent-policy rule picker for the numerous NARROW child rows — per record
 * type and per resource instance (plan 26 §2.2). The segmented
 * `AgentPolicyLevelControl` stays on the few glanceable top rows; rows that
 * repeat once per record type or per dataset get the same dropdown the human
 * per-def and per-instance rows already use, so the two principals stop
 * diverging by widget where they agree by structure.
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
 * Selecting Default emits `undefined`; every other option emits an
 * `AgentAccessLevel`.
 */
export function AgentPolicyLevelSelect({
  value,
  fallback,
  onChange,
  inertNote,
  disabled = false,
}: AgentPolicyLevelSelectProps) {
  return (
    <div className='flex items-center gap-1'>
      {inertNote ? (
        <Tooltip content={inertNote}>
          <AlertTriangle className='size-3.5 text-amber-500' />
        </Tooltip>
      ) : null}

      <AccessLevelSelect
        value={value === undefined ? undefined : permissionOfAgentLevel(value)}
        includeInherit
        includeNone
        inheritLabelText='Default'
        inheritedLevel={permissionOfAgentLevel(fallback)}
        onInherit={() => onChange(undefined)}
        onChange={(permission) => onChange(agentLevelOfPermission(permission))}
        disabled={disabled}
        size='sm'
        variant='transparent'
        className='h-7 w-44'
      />
    </div>
  )
}
