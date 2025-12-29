// apps/web/src/app/(protected)/app/workflows/_components/lists/workflows-empty-state.tsx
'use client'

import { useState } from 'react'
import { Workflow, Plus, Search, FileText } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { EmptyState } from '~/components/global/empty-state'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { WorkflowTemplateDialog } from '~/components/workflow/dialogs/workflow-template-dialog'
import { useOrganization } from '~/hooks/use-organization'

interface WorkflowsEmptyStateProps {
  searchQuery?: string
  selectedTriggerType?: string | null
}

export function WorkflowsEmptyState({
  searchQuery,
  selectedTriggerType,
}: WorkflowsEmptyStateProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const organization = useOrganization()
  const hasFilters = searchQuery || selectedTriggerType

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center flex-1 h-full">
        <EmptyState
          icon={Search}
          title="No workflows found"
          description={
            <div className="max-w-md">
              No workflows match your current search criteria. Try adjusting your filters or search
              terms.
            </div>
          }
          button={
            <Button variant="outline" onClick={() => window.location.reload()}>
              Clear filters
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center flex-1 h-full">
      <EmptyState
        icon={Workflow}
        title="Create your first workflow"
        description={
          <div className="max-w-md">
            Workflows allow you to automate complex business processes with visual, node-based
            logic. Build powerful automations with conditions, actions, and integrations.
          </div>
        }
        button={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowCreateDialog(true)}>
              <Plus />
              Create Workflow
            </Button>
            <Button type="button" size="sm" onClick={() => setShowTemplateDialog(true)}>
              <FileText />
              Browse Templates
            </Button>
          </div>
        }
      />
      <WorkflowFormDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} mode="create" />
      <WorkflowTemplateDialog
        open={showTemplateDialog}
        onOpenChange={setShowTemplateDialog}
        organizationId={organization?.id ?? ''}
      />
    </div>
  )
}
