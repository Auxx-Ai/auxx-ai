// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-empty-state.tsx
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { FileText, Plus, Search, Workflow } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { WorkflowTemplateDialog } from '~/components/workflow/dialogs/workflow-template-dialog'
import { useCreateWorkflow } from '~/components/workflow/hooks/use-create-workflow'
import { useOrganization } from '~/hooks/use-organization'
import { useAccess } from '~/providers/capabilities-provider'

interface WorkflowsEmptyStateProps {
  searchQuery?: string
  selectedTriggerType?: string | null
}

export function WorkflowsEmptyState({
  searchQuery,
  selectedTriggerType,
}: WorkflowsEmptyStateProps) {
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const organization = useOrganization()
  const { createWorkflow, isCreating } = useCreateWorkflow()
  const { can } = useAccess()
  const canCreate = can(PermissionKey.workflowsManage)
  const hasFilters = searchQuery || selectedTriggerType

  if (hasFilters) {
    return (
      <div className='flex flex-col items-center flex-1 h-full'>
        <EmptyState
          icon={Search}
          title='No workflows found'
          description={
            <div className='max-w-md'>
              No workflows match your current search criteria. Try adjusting your filters or search
              terms.
            </div>
          }
          button={
            <Button variant='outline' onClick={() => window.location.reload()}>
              Clear filters
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className='flex flex-col items-center flex-1 h-full'>
      <EmptyState
        icon={Workflow}
        title='Workflows'
        description={
          <div className='max-w-[250px]'>
            {canCreate
              ? 'No workflows yet! Create your first workflow to get started.'
              : 'No workflows yet. Ask an admin to set one up.'}
          </div>
        }
        button={
          canCreate ? (
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                size='sm'
                variant='outline'
                loading={isCreating}
                loadingText='Creating...'
                onClick={() => void createWorkflow()}>
                <Plus />
                Create Workflow
              </Button>
              <Button type='button' size='sm' onClick={() => setShowTemplateDialog(true)}>
                <FileText />
                Browse Templates
              </Button>
            </div>
          ) : undefined
        }
      />
      <WorkflowTemplateDialog
        open={showTemplateDialog}
        onOpenChange={setShowTemplateDialog}
        organizationId={organization?.id ?? ''}
      />
    </div>
  )
}
