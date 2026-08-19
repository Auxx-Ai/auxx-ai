// apps/web/src/components/workflow/ui/workflow-breadcrumb-switcher.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useMemo, useState } from 'react'
import { EntityBreadcrumbSwitcher, type EntitySwitcherItem } from '~/components/pickers'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { WorkflowFormDialog } from '../dialogs/workflow-form-dialog'
import { useWorkflowStore } from '../store/workflow-store'

/** A workflow row as returned by `workflow.list`. */
type WorkflowRow = RouterOutputs['workflow']['list']['workflows'][number]

/** The list caps at the schema max; anything beyond it is reported honestly. */
const LIST_LIMIT = 100

interface WorkflowBreadcrumbSwitcherProps {
  /** The workflow currently open — highlighted in the list. */
  activeWorkflowId: string
  /** Trigger label. The detail page passes a `<Skeleton>` while the workflow loads. */
  activeLabel: React.ReactNode
}

/** Enabled / Disabled / Draft, mirroring the workflows grid's status dot. */
function statusBadge(workflow: WorkflowRow) {
  if (!workflow.workflowId)
    return (
      <Badge variant='gray' size='xs'>
        Draft
      </Badge>
    )
  return workflow.enabled ? (
    <Badge variant='green' size='xs'>
      Enabled
    </Badge>
  ) : (
    <Badge variant='amber' size='xs'>
      Disabled
    </Badge>
  )
}

/**
 * The workflow switcher mounted in the workflow detail breadcrumb — search,
 * jump, favorite, rename (via `WorkflowFormDialog`) and delete, over every
 * workflow the member may view.
 *
 * `limit: 100` is passed explicitly: `listWorkflowsSchema` caps there but
 * *defaults* to 50, so relying on the default silently truncates the list. When
 * the router still reports `hasMore` the truncation is stated rather than hidden.
 *
 * Edit and delete are the `admin` rung of per-workflow instance access and are
 * gated per row, so a list mixing owned and restricted workflows shows the
 * affordances on exactly the rows that would not 403.
 */
export function WorkflowBreadcrumbSwitcher({
  activeWorkflowId,
  activeLabel,
}: WorkflowBreadcrumbSwitcherProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const { canAdminInstance } = useAccess()
  const [editing, setEditing] = useState<WorkflowRow | null>(null)

  // Jumping to another workflow abandons unsaved canvas edits, so every exit the
  // switcher owns — rows and prev/next alike — confirms first.
  const isDirty = useWorkflowStore((state) => state.isDirty)

  const { data, isLoading } = api.workflow.list.useQuery(
    { limit: LIST_LIMIT },
    { staleTime: 30_000 }
  )

  const deleteWorkflow = api.workflow.delete.useMutation({
    onSuccess: () => void utils.workflow.list.invalidate(),
    onError: (error) =>
      toastError({ title: 'Failed to delete workflow', description: error.message }),
  })

  const rows = useMemo(() => data?.workflows ?? [], [data])
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])

  const items = useMemo<EntitySwitcherItem[]>(
    () =>
      rows.map((workflow) => ({
        id: workflow.id,
        label: workflow.name,
        href: `/app/workflows/${workflow.id}`,
        iconId: workflow.icon?.iconId ?? 'zap',
        color: workflow.icon?.color,
        secondary: statusBadge(workflow),
      })),
    [rows]
  )

  const canAdmin = (item: EntitySwitcherItem) => canAdminInstance(toRecordId('workflow', item.id))

  return (
    <>
      <EntityBreadcrumbSwitcher<'WORKFLOW'>
        activeLabel={activeLabel}
        items={items}
        activeId={activeWorkflowId}
        isLoading={isLoading}
        nav={{
          isDirty,
          orphanLabel: 'Workflows',
          confirmOptions: {
            description: 'This workflow has unsaved changes. Leaving now will discard them.',
          },
        }}
        searchPlaceholder='Search workflows...'
        emptyText='No workflows'
        onSelect={(item) => router.push(item.href ?? '/app/workflows')}
        canEdit={canAdmin}
        onEdit={(item) => setEditing(rowsById.get(item.id) ?? null)}
        canDelete={canAdmin}
        deleteConfirm={() => ({
          title: 'Delete workflow?',
          description: 'This will permanently delete this workflow and all its execution history.',
        })}
        onDelete={async (item) => {
          await deleteWorkflow.mutateAsync({ id: item.id })
          if (item.id === activeWorkflowId) router.push('/app/workflows')
        }}
        favorite={{ targetType: 'WORKFLOW', targetIds: (item) => ({ workflowId: item.id }) }}
        truncatedNotice={
          data?.hasMore ? `Showing the first ${LIST_LIMIT} — refine your search` : undefined
        }
      />

      {editing && (
        <WorkflowFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          workflow={{
            id: editing.id,
            name: editing.name,
            description: editing.description,
            icon: editing.icon,
          }}
        />
      )}
    </>
  )
}
