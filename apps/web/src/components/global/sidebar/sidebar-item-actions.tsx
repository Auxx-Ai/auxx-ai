// components/global/sidebar/sidebar-item-actions.tsx
'use client'

import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { LayoutTemplate, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { WorkflowTemplateDialog } from '~/components/workflow/dialogs/workflow-template-dialog'
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const currentOrganization = useOrganization()

  return {
    editItems: {
      workflows: () => (
        <>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              setCreateDialogOpen(true)
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
    },
    dialogs: (
      <>
        {createDialogOpen && (
          <WorkflowFormDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            mode='create'
          />
        )}
        {templateDialogOpen && (
          <WorkflowTemplateDialog
            open={templateDialogOpen}
            onOpenChange={setTemplateDialogOpen}
            organizationId={currentOrganization?.id ?? ''}
          />
        )}
      </>
    ),
  }
}
