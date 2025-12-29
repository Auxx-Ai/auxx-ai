// apps/web/src/app/(protected)/app/settings/custom-fields/page.tsx
'use client'

import { useState } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DataModelOptions } from '@auxx/lib/custom-fields/types'
import { ModelTypes } from '@auxx/lib/resources/client'
import { EntityRow } from '~/components/custom-fields/ui/entity-row'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import type { FieldType } from '@auxx/database/types'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { useEntityDefinitionMutations } from '~/components/resources/hooks'

const BASE_URL = `/app/settings/custom-fields`

/** Entity definition type from API */
interface EntityDefinition {
  id: string
  apiSlug: string
  icon: string | null
  color: string | null
  singular: string
  plural: string
  archivedAt: string | null
}

/** Custom field definition type for EntityInstanceDialog */
interface CustomFieldDef {
  id: string
  name: string
  type: FieldType
  description?: string | null
  required?: boolean | null
  position?: number | null
  active?: boolean | null
  defaultValue?: string | null
  options?: unknown
}

/** Entity definition with custom fields for EntityInstanceDialog */
interface EntityDefinitionWithFields {
  id: string
  singular: string
  plural: string
  icon: string | null
  color: string | null
  customFields: CustomFieldDef[]
}

export default function CustomFieldsPage() {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntity, setEditingEntity] = useState<EntityDefinition | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  // State for EntityInstanceDialog
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false)
  const [entityForNewInstance, setEntityForNewInstance] = useState<EntityDefinitionWithFields | null>(null)

  // tRPC utils for fetching custom fields
  const utils = api.useUtils()

  // Fetch custom entity definitions
  const {
    data: entityDefinitions,
    refetch,
    isLoading,
  } = api.entityDefinition.getAll.useQuery({ includeArchived: false })

  // Use mutations hook for automatic resource cache invalidation
  const { archiveEntity: archiveEntityMutation, restoreEntity: restoreEntityMutation } =
    useEntityDefinitionMutations()

  /** Navigate to entity fields page */
  function handleRowClick(slug: string) {
    router.push(`${BASE_URL}/${slug}`)
  }

  /** Open dialog in create mode */
  function handleCreateEntity() {
    setEditingEntity(null)
    setDialogOpen(true)
  }

  /** Open dialog in edit mode */
  function handleEditEntity(entity: EntityDefinition) {
    setEditingEntity(entity)
    setDialogOpen(true)
  }

  /** Archive an entity definition */
  async function handleArchiveEntity(entity: EntityDefinition) {
    const confirmed = await confirm({
      title: `Archive "${entity.singular}"?`,
      description:
        'This entity will be archived and hidden from the list. You can restore it later.',
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      archiveEntityMutation.mutate(
        { id: entity.id },
        {
          onSuccess: () => refetch(),
          onError: (error) => {
            toastError({ title: 'Failed to archive entity', description: error.message })
          },
        }
      )
    }
  }

  /** Restore an archived entity */
  function handleRestoreEntity(entity: EntityDefinition) {
    restoreEntityMutation.mutate(
      { id: entity.id },
      {
        onSuccess: () => refetch(),
        onError: (error) => {
          toastError({ title: 'Failed to restore entity', description: error.message })
        },
      }
    )
  }

  /** Callback after successful dialog action */
  function handleDialogSuccess() {
    refetch()
  }

  /** Open EntityInstanceDialog for a custom entity */
  async function handleNewItem(entity: EntityDefinition) {
    // Fetch custom fields for this entity
    const customFields = await utils.customField.getByEntityDefinition.fetch({
      entityDefinitionId: entity.id,
    })

    setEntityForNewInstance({
      id: entity.id,
      singular: entity.singular,
      plural: entity.plural,
      icon: entity.icon,
      color: entity.color,
      customFields: (customFields ?? []) as CustomFieldDef[],
    })
    setInstanceDialogOpen(true)
  }

  // Filter out the generic "entity" type from system models since that's a placeholder
  const systemModels = Object.values(DataModelOptions).filter(
    (model) => model.isSystem && model.type !== ModelTypes.ENTITY
  )

  return (
    <SettingsPage
      title="Custom Entities & Fields"
      description="Manage all the custom entities and fields in your organization."
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Custom Fields' }]}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Fields</TableHead>
            <TableHead className="w-[100px]">
              <Button onClick={handleCreateEntity} size="sm" variant="outline">
                <Plus />
                Create
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* System models */}
          {systemModels.map((model) => (
            <EntityRow
              key={model.type}
              iconId={model.icon}
              label={model.label}
              type="System"
              onClick={() => handleRowClick(model.type)}
            />
          ))}

          {/* Custom entity definitions */}
          {!isLoading &&
            entityDefinitions?.map((entity) => (
              <EntityRow
                key={entity.id}
                label={entity.singular}
                type="Custom"
                iconId={entity.icon}
                color={entity.color}
                isArchived={!!entity.archivedAt}
                onClick={() => handleRowClick(entity.apiSlug)}
                onEdit={() => handleEditEntity(entity)}
                onArchive={() => handleArchiveEntity(entity)}
                onRestore={() => handleRestoreEntity(entity)}
                onNewItem={() => handleNewItem(entity)}
              />
            ))}
        </TableBody>
      </Table>

      <EntityDefinitionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingEntity={editingEntity}
        onSuccess={handleDialogSuccess}
      />

      {entityForNewInstance && (
        <EntityInstanceDialog
          open={instanceDialogOpen}
          onOpenChange={setInstanceDialogOpen}
          entityDefinition={entityForNewInstance}
        />
      )}

      <ConfirmDialog />
    </SettingsPage>
  )
}
