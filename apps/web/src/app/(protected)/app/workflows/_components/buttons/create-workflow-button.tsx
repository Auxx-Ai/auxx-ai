// apps/web/src/app/(protected)/app/workflows/_components/buttons/create-workflow-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { FileText, Plus, Workflow, Zap } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { WorkflowTemplateDialog } from '~/components/workflow/dialogs/workflow-template-dialog'
import { useOrganization } from '~/hooks/use-organization'

export function CreateWorkflowButton() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const currentOrganization = useOrganization()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size='sm'>
            <Plus />
            Create Workflow
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => setCreateDialogOpen(true)}>
            <Workflow />
            Create from scratch
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTemplateDialogOpen(true)}>
            <FileText />
            Use template
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkflowFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        mode='create'
      />
      <WorkflowTemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        organizationId={currentOrganization?.id ?? ''}
      />
    </>
  )
}
