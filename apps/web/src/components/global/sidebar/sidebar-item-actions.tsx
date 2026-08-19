// components/global/sidebar/sidebar-item-actions.tsx
'use client'

import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { Bot, CheckSquare, LayoutTemplate, Workflow } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useAgentMutations } from '~/components/agents/hooks/use-agent-mutations'
import { AgentTemplateDialog } from '~/components/agents/ui/dialogs/agent-template-dialog'
import { useCreateTaskStore } from '~/components/tasks/stores/create-task-store'
import { WorkflowTemplateDialog } from '~/components/workflow/dialogs/workflow-template-dialog'
import { useCreateWorkflow } from '~/components/workflow/hooks/use-create-workflow'
import { useOrganization } from '~/hooks/use-organization'

type SidebarItemActionsResult = {
  /** Dropdown menu items rendered inside the SidebarItem dropdown */
  editItems: Record<string, () => ReactNode>
  /** Dialogs rendered at the top level, outside the dropdown */
  dialogs: ReactNode
}

/**
 * Hook that provides per-item dropdown actions and their associated dialogs.
 * Dialogs are rendered separately so they persist when the dropdown closes.
 */
export function useSidebarItemActions(): SidebarItemActionsResult {
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [agentTemplateDialogOpen, setAgentTemplateDialogOpen] = useState(false)
  const currentOrganization = useOrganization()
  const router = useRouter()
  const { createAgent, isCreating } = useAgentMutations()
  const { createWorkflow, isCreating: isCreatingWorkflow } = useCreateWorkflow()

  async function handleCreateAgentFromScratch() {
    const created = await createAgent()
    if (created) router.push(`/app/agents/${created.slug}`)
  }

  return {
    editItems: {
      agents: () => (
        <>
          <DropdownMenuItem
            disabled={isCreating}
            onClick={(e) => {
              e.stopPropagation()
              void handleCreateAgentFromScratch()
            }}>
            <Bot /> Create blank
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCreating}
            onClick={(e) => {
              e.stopPropagation()
              setAgentTemplateDialogOpen(true)
            }}
            className='data-highlighted:bg-[#ffaa40]/10'>
            <LayoutTemplate className='text-[#ffaa40]' />{' '}
            <AnimatedGradientText>Create from template</AnimatedGradientText>
          </DropdownMenuItem>
        </>
      ),
      workflows: () => (
        <>
          <DropdownMenuItem
            disabled={isCreatingWorkflow}
            onClick={(e) => {
              e.stopPropagation()
              void createWorkflow()
            }}>
            <Workflow /> Create blank
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setTemplateDialogOpen(true)
            }}
            className='data-highlighted:bg-[#ffaa40]/10'>
            <LayoutTemplate className='text-[#ffaa40]' />{' '}
            <AnimatedGradientText>Create from template</AnimatedGradientText>
          </DropdownMenuItem>
        </>
      ),
      tasks: () => (
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation()
            useCreateTaskStore.getState().openDialog()
          }}>
          <CheckSquare /> Create task
        </DropdownMenuItem>
      ),
    },
    dialogs: (
      <>
        {templateDialogOpen && (
          <WorkflowTemplateDialog
            open={templateDialogOpen}
            onOpenChange={setTemplateDialogOpen}
            organizationId={currentOrganization?.id ?? ''}
          />
        )}
        {agentTemplateDialogOpen && (
          <AgentTemplateDialog
            open={agentTemplateDialogOpen}
            onOpenChange={setAgentTemplateDialogOpen}
            // Matches the sibling "Create blank" item, which uses
            // `createAgent()`'s `internal` default.
            kind='internal'
          />
        )}
      </>
    ),
  }
}
