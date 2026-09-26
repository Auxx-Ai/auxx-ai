// apps/web/src/components/global/sidebar/tree/entity-actions.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import type { CustomResource } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { EntityTemplateDialog } from '~/components/custom-fields/ui/entity-template-dialog'
import { useEntityDefinitionMutations, useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

interface EntityActions {
  createEntity: () => void
  createFromTemplate: () => void
  editEntity: (resource: CustomResource) => void
  archiveEntity: (resource: CustomResource) => Promise<void>
  deleteEntity: (resource: CustomResource) => Promise<void>
}

const EntityActionsContext = createContext<EntityActions | null>(null)

export function useEntityActions(): EntityActions {
  const ctx = useContext(EntityActionsContext)
  if (!ctx) throw new Error('useEntityActions must be used within EntityActionsProvider')
  return ctx
}

/** Entity-definition dialogs for the sidebar; mounted once so they outlive the closed dropdowns. */
export function EntityActionsProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()
  const { archiveEntity, deleteEntity } = useEntityDefinitionMutations()
  const { isAtLimit, getLimit } = useFeatureFlags()
  const { customResources } = useResources()
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0
  const atEntityLimit = isAtLimit(FeatureKey.entities, userCreatedEntityCount)
  const entityLimit = getLimit(FeatureKey.entities)

  const actions = useMemo<EntityActions>(
    () => ({
      createEntity: () => {
        if (atEntityLimit) return setLimitDialogOpen(true)
        setEditingEntityId(null)
        setDialogOpen(true)
      },
      createFromTemplate: () => {
        if (atEntityLimit) return setLimitDialogOpen(true)
        setTemplateDialogOpen(true)
      },
      editEntity: (resource) => {
        setEditingEntityId(resource.id)
        setDialogOpen(true)
      },
      archiveEntity: async (resource) => {
        const confirmed = await confirm({
          title: `Archive "${resource.label}"?`,
          description:
            'This entity will be archived and hidden. You can restore it later from Settings.',
          confirmText: 'Archive',
          cancelText: 'Cancel',
          destructive: true,
        })
        if (!confirmed) return
        archiveEntity.mutate(
          { id: resource.id },
          {
            onError: (error) =>
              toastError({ title: 'Failed to archive entity', description: error.message }),
          }
        )
      },
      deleteEntity: async (resource) => {
        const confirmed = await confirm({
          title: `Delete "${resource.label}" permanently?`,
          description:
            `This permanently deletes ${resource.plural} — every record, all custom fields, and the ` +
            'opposite side of any relationships pointing to it. Sync connectors that target this ' +
            'entity will also be torn down. This cannot be undone.',
          confirmText: 'Delete permanently',
          cancelText: 'Cancel',
          destructive: true,
        })
        if (!confirmed) return
        deleteEntity.mutate(
          { id: resource.id },
          {
            onError: (error) =>
              toastError({ title: 'Failed to delete entity', description: error.message }),
          }
        )
      },
    }),
    [atEntityLimit, confirm, archiveEntity, deleteEntity]
  )

  return (
    <EntityActionsContext.Provider value={actions}>
      {children}
      {dialogOpen && (
        <EntityDefinitionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          entityDefinitionId={editingEntityId}
          onSuccess={({ apiSlug }) => {
            if (!editingEntityId) router.push(`/app/custom/${apiSlug}`)
          }}
        />
      )}
      <ConfirmDialog />
      <EntityTemplateDialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen} />
      <LimitReachedDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        icon={Plus}
        title='Entity Limit Reached'
        description={`You've reached the maximum of ${entityLimit} custom entities on your current plan.`}
      />
    </EntityActionsContext.Provider>
  )
}
