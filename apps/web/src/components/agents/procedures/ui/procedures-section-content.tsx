// apps/web/src/components/agents/procedures/ui/procedures-section-content.tsx
'use client'

import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../store/agent-store'
import { ProcedureRow } from './procedure-row'

interface ProceduresSectionContentProps {
  agent: AgentDetail
  /** Drill into a procedure — sets the page-level `procedure` nuqs param (NavStack push). */
  onOpen: (procedureId: string) => void
}

/**
 * The agent-detail Procedures list — a flat list of `TreeRow`s (mirroring Tools /
 * Bindings). The "Add procedure" button lives in `<Section actions>` (owned by the
 * agent-detail tab wrapper); clicking a row pushes the detail panel via the
 * page-level `NavStack`. Shows for chat AND internal agents.
 */
export function ProceduresSectionContent({ agent, onOpen }: ProceduresSectionContentProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const procedures = api.agentProcedure.list.useQuery({ agentId: agent.id })
  const invalidate = () => utils.agentProcedure.list.invalidate({ agentId: agent.id })

  const updateLink = api.agentProcedure.update.useMutation({
    onSuccess: invalidate,
    onError: (err) => toastError({ title: 'Failed to update procedure', description: err.message }),
  })
  const detach = api.agentProcedure.detach.useMutation({
    onSuccess: invalidate,
    onError: (err) => toastError({ title: 'Failed to remove procedure', description: err.message }),
  })

  const rows = procedures.data ?? []

  const handleDelete = async (linkId: string, name: string) => {
    const confirmed = await confirm({
      title: 'Delete procedure?',
      description: `"${name}" will be removed from this agent. This cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) detach.mutate({ id: linkId })
  }

  if (procedures.isLoading) return <EmptySection loading className='mx-3' />

  if (rows.length === 0) {
    return (
      <p className='px-3 py-6 text-center text-sm text-muted-foreground'>
        No procedures yet. Add one to give this agent a step-by-step playbook.
      </p>
    )
  }

  return (
    <div className='flex flex-col pe-4'>
      {rows.map((row) => (
        <ProcedureRow
          key={row.linkId}
          row={row}
          onOpen={() => onOpen(row.procedureId)}
          onToggle={(enabled) => updateLink.mutate({ id: row.linkId, enabled })}
          onDelete={() => void handleDelete(row.linkId, row.name)}
        />
      ))}
      <ConfirmDialog />
    </div>
  )
}
