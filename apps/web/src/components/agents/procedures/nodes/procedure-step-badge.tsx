// apps/web/src/components/agents/procedures/nodes/procedure-step-badge.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ArrowRight, Code2, CornerDownRight, Hand, Settings2, Square, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '~/trpc/react'
import { useProcedureEditorContext } from '../ui/procedure-draft-provider'

const PILL =
  'inline-flex items-center gap-1 align-baseline rounded-md px-1.5 py-0 text-sm bg-primary-100 text-primary-700 ring-1 ring-primary-200 transition-all'

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
  return <span className={cn(PILL, selected && 'ring-primary-400')}>{id}</span>
}

/** Detects whether a given prefixed id is a procedure step badge (vs. a plain reference). */
export function isProcedureStepId(id: string): boolean {
  return id.startsWith('subprocedure:') || id.startsWith('code:') || id.startsWith('route:')
}

function Pill({
  icon,
  selected,
  onCog,
  children,
}: {
  icon: ReactNode
  selected: boolean
  onCog?: () => void
  children: ReactNode
}) {
  return (
    <span className={cn(PILL, selected && 'ring-primary-400')}>
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
          className='ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:bg-primary-200 hover:opacity-100'>
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
      icon={<Workflow className='size-3.5' />}
      selected={selected}
      onCog={ctx ? () => ctx.openDrill(`sub:${subId}`) : undefined}>
      {name}
      <ArrowRight className='ml-0.5 inline size-3 opacity-60' />
    </Pill>
  )
}

function CodeBadge({ codeId, selected }: { codeId: string; selected: boolean }) {
  const ctx = useProcedureEditorContext()
  const name = ctx?.codeBlocks.find((c) => c.id === codeId)?.name?.trim() || 'Code'
  return (
    <Pill
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
      <Pill icon={<Square className='size-3.5' />} selected={selected}>
        End procedure
      </Pill>
    )
  }
  if (payload === 'handoff') {
    return (
      <Pill icon={<Hand className='size-3.5' />} selected={selected}>
        Hand off to human
      </Pill>
    )
  }
  if (payload.startsWith('switch:')) {
    return <SwitchBadge procId={payload.slice('switch:'.length)} selected={selected} />
  }
  return (
    <Pill icon={<CornerDownRight className='size-3.5' />} selected={selected}>
      {payload}
    </Pill>
  )
}

function SwitchBadge({ procId, selected }: { procId: string; selected: boolean }) {
  const list = api.procedure.list.useQuery()
  const name = list.data?.find((p) => p.id === procId)?.name ?? 'Procedure'
  return (
    <Pill icon={<CornerDownRight className='size-3.5' />} selected={selected}>
      Switch to {name}
    </Pill>
  )
}
