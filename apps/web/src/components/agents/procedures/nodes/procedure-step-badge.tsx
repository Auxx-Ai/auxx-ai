// apps/web/src/components/agents/procedures/nodes/procedure-step-badge.tsx
'use client'

import { getColorBadgeClasses, getColorSelectedBorderClasses } from '@auxx/lib/custom-fields/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { cn } from '@auxx/ui/lib/utils'
import { Code2, CornerDownRight, Hand, Settings2, Square, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '~/trpc/react'
import { useProcedureEditorContext } from '../ui/procedure-draft-provider'

// Layout only — bg/text/border come from the option-color palette per tone.
// `border-black/10` is a fallback for tones (gray) that lack a border color.
const PILL =
  'inline-flex items-center gap-1 align-baseline rounded-md border border-black/10 px-1.5 py-0 text-sm transition-all dark:border-white/10'

/** Tone-aware pill classes from the shared select-option color palette. */
function pillClasses(tone: SelectOptionColor, selected: boolean) {
  return cn(PILL, getColorBadgeClasses(tone), selected && getColorSelectedBorderClasses(tone))
}

/**
 * Inline step badges for the v9 procedure editor — one badge system, the kind
 * keyed off the id-prefix (plan §2):
 *
 * - `route:finished` / `route:handoff` / `route:switch:<procId>` — terminal pills,
 * - `subprocedure:<id>` — "run sub-procedure" pill + cog → drill into its body,
 * - `code:<id>` — code pill + cog → drill into the code editor.
 *
 * Names + the cog's drill target come from {@link useProcedureEditorContext}
 * (the doc-level `subProcedures` / `codeBlocks` maps); `switch` resolves the
 * target procedure name from the org list.
 */
export function ProcedureStepBadge({ id, selected }: { id: string; selected: boolean }) {
  if (id.startsWith('subprocedure:')) {
    return <SubProcedureBadge subId={id.slice('subprocedure:'.length)} selected={selected} />
  }
  if (id.startsWith('code:')) {
    return <CodeBadge codeId={id.slice('code:'.length)} selected={selected} />
  }
  if (id.startsWith('route:')) {
    return <RouteBadge payload={id.slice('route:'.length)} selected={selected} />
  }
  return <span className={pillClasses('gray', selected)}>{id}</span>
}

/** Detects whether a given prefixed id is a procedure step badge (vs. a plain reference). */
export function isProcedureStepId(id: string): boolean {
  return id.startsWith('subprocedure:') || id.startsWith('code:') || id.startsWith('route:')
}

function Pill({
  tone,
  icon,
  selected,
  onCog,
  children,
}: {
  tone: SelectOptionColor
  icon: ReactNode
  selected: boolean
  onCog?: () => void
  children: ReactNode
}) {
  return (
    <span className={pillClasses(tone, selected)}>
      <span className='shrink-0 opacity-70'>{icon}</span>
      <span className='truncate'>{children}</span>
      {onCog && (
        <button
          type='button'
          tabIndex={-1}
          aria-label='Edit'
          contentEditable={false}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onCog()
          }}
          className='ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:bg-current/15 hover:opacity-100'>
          <Settings2 className='size-3' />
        </button>
      )}
    </span>
  )
}

function SubProcedureBadge({ subId, selected }: { subId: string; selected: boolean }) {
  const ctx = useProcedureEditorContext()
  const name = ctx?.subProcedures.find((s) => s.id === subId)?.name?.trim() || 'Sub-procedure'
  return (
    <Pill
      tone='forest'
      icon={<Workflow className='size-3.5' />}
      selected={selected}
      onCog={ctx ? () => ctx.openDrill(`sub:${subId}`) : undefined}>
      {name}
    </Pill>
  )
}

function CodeBadge({ codeId, selected }: { codeId: string; selected: boolean }) {
  const ctx = useProcedureEditorContext()
  const name = ctx?.codeBlocks.find((c) => c.id === codeId)?.name?.trim() || 'Code'
  return (
    <Pill
      tone='indigo'
      icon={<Code2 className='size-3.5' />}
      selected={selected}
      onCog={ctx ? () => ctx.openDrill(`code:${codeId}`) : undefined}>
      {name}
    </Pill>
  )
}

function RouteBadge({ payload, selected }: { payload: string; selected: boolean }) {
  if (payload === 'finished') {
    return (
      <Pill tone='red' icon={<Square className='size-3.5' />} selected={selected}>
        End procedure
      </Pill>
    )
  }
  if (payload === 'handoff') {
    return (
      <Pill tone='red' icon={<Hand className='size-3.5' />} selected={selected}>
        Hand off to human
      </Pill>
    )
  }
  if (payload.startsWith('switch:')) {
    return <SwitchBadge procId={payload.slice('switch:'.length)} selected={selected} />
  }
  return (
    <Pill tone='red' icon={<CornerDownRight className='size-3.5' />} selected={selected}>
      {payload}
    </Pill>
  )
}

function SwitchBadge({ procId, selected }: { procId: string; selected: boolean }) {
  const list = api.procedure.list.useQuery()
  const name = list.data?.find((p) => p.id === procId)?.name ?? 'Procedure'
  return (
    <Pill tone='red' icon={<CornerDownRight className='size-3.5' />} selected={selected}>
      Switch to {name}
    </Pill>
  )
}
