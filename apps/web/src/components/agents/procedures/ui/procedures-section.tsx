// apps/web/src/components/agents/procedures/ui/procedures-section.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { ListChecks, Plus } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../store/agent-store'
import { ProcedureRow } from './procedure-row'

interface ProceduresSectionProps {
  agent: AgentDetail
  /** Drill into a procedure — sets the page-level `procedure` nuqs param (NavStack push). */
  onSelect: (procedureId: string) => void
}

/**
 * Procedures section — owns the `<Section>` shell (with the "Add procedure"
 * action that creates + attaches a fresh procedure and drills into it) and the
 * flat list of `TreeRow`s (mirroring Tools / Bindings). Clicking a row pushes
 * the detail panel via the page-level `NavStack`. Shows for chat AND internal
 * agents.
 */
export function ProceduresSection({ agent, onSelect }: ProceduresSectionProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  // Beta gate — also enforced on the tab visibility + backend mutations. Hides the
  // "Add procedure" action if the org loses entitlement while this view is mounted.
  const { hasAccess } = useFeatureFlags()
  const canEdit = hasAccess(FeatureKey.agentProcedures)

  const procedures = api.agentProcedure.list.useQuery({ agentId: agent.id })
  const invalidate = () => utils.agentProcedure.list.invalidate({ agentId: agent.id })

  const createAndAttach = api.agentProcedure.createAndAttach.useMutation({
    onSuccess: ({ procedureId }) => {
      void invalidate()
      onSelect(procedureId)
    },
    onError: (err) => toastError({ title: 'Failed to add procedure', description: err.message }),
  })
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

  return (
    <Section
      title='Procedures'
      icon={<ListChecks className='size-4' />}
      className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
      initialOpen
      description='Step-by-step playbooks the agent follows for specific situations.'
      collapsible={false}
      actions={
        canEdit ? (
          <Button
            variant='ghost'
            size='xs'
            loading={createAndAttach.isPending}
            onClick={() => createAndAttach.mutate({ agentId: agent.id, name: 'New procedure' })}>
            <Plus />
            Add procedure
          </Button>
        ) : null
      }>
      {procedures.isLoading ? (
        <EmptySection loading className='mx-3' />
      ) : rows.length === 0 ? (
        <div className='px-3 py-2'>
          <EmptySection
            icon={<ListChecks className='size-5' />}
            title='No procedures yet'
            description='Add one to give this agent a step-by-step playbook for specific situations.'
          />
        </div>
      ) : (
        <div className='flex flex-col ps-2 pe-4'>
          {rows.map((row) => (
            <ProcedureRow
              key={row.linkId}
              row={row}
              onOpen={() => onSelect(row.procedureId)}
              onToggle={(enabled) => updateLink.mutate({ id: row.linkId, enabled })}
              onDelete={() => void handleDelete(row.linkId, row.name)}
            />
          ))}
          <ConfirmDialog />
        </div>
      )}
    </Section>
  )
}
