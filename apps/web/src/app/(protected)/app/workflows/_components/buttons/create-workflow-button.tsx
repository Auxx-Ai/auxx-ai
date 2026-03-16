// apps/web/src/app/(protected)/app/workflows/_components/buttons/create-workflow-button.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { FileText, Plus, Workflow } from 'lucide-react'
import { useState } from 'react'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { WorkflowTemplateDialog } from '~/components/workflow/dialogs/workflow-template-dialog'
import { useOrganization } from '~/hooks/use-organization'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useWorkflows } from '../providers/workflows-provider'

export function CreateWorkflowButton() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const currentOrganization = useOrganization()
  const { isAtLimit, getLimit } = useFeatureFlags()
  const { stats } = useWorkflows()
  const atLimit = isAtLimit(FeatureKey.workflowsLimit, stats.total)
  const workflowLimit = getLimit(FeatureKey.workflowsLimit)

  if (atLimit) {
    return (
      <>
        <Button size='sm' onClick={() => setLimitDialogOpen(true)}>
          <Plus />
          Create Workflow
        </Button>
        <LimitReachedDialog
          open={limitDialogOpen}
          onOpenChange={setLimitDialogOpen}
          icon={Workflow}
          title='Workflow Limit Reached'
          description={`You've reached the maximum of ${workflowLimit} workflows on your current plan.`}
        />
      </>
    )
  }

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
