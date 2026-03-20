// apps/web/src/components/workflow/dialogs/single-entity-install-dialog.tsx
'use client'

import type { ConflictResolution } from '@auxx/lib/entity-templates'
import { FeatureKey } from '@auxx/lib/permissions/client'
import type { Resource } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { Loader2, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  EntityPreviewCard,
  type FieldState,
} from '~/components/custom-fields/ui/entity-preview-card'
import type { EntityTemplateInstallResult } from '~/components/custom-fields/ui/entity-template-dialog'
import { useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

interface SingleEntityInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateId: string
  onComplete?: (result: EntityTemplateInstallResult) => void
}

/**
 * Focused dialog for installing a single entity template.
 * Smaller alternative to EntityTemplateDialog — shows one EntityPreviewCard
 * with optional companions and an install button.
 */
export function SingleEntityInstallDialog({
  open,
  onOpenChange,
  templateId,
  onComplete,
}: SingleEntityInstallDialogProps) {
  const { resources, customResources, getResourceById } = useResources()
  const { getLimit } = useFeatureFlags()
  const entityLimit = getLimit(FeatureKey.entities)
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [allFieldModifications, setAllFieldModifications] = useState<
    Record<string, Record<string, FieldState>>
  >({})
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, ConflictResolution>
  >({})

  // Fetch template detail
  const { data: templateDetail, isLoading } = api.entityDefinition.getTemplateById.useQuery(
    { id: templateId },
    { enabled: open && !!templateId }
  )

  // Install mutation
  const utils = api.useUtils()
  const installTemplates = api.entityDefinition.createFromTemplates.useMutation({
    onSuccess: async (result) => {
      utils.entityDefinition.getAll.invalidate()
      await utils.resource.list.invalidate()
      if (onComplete) {
        onComplete(result as EntityTemplateInstallResult)
        return
      }
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to install entity', description: error.message })
    },
  })

  // ── Conflict detection ──────────────────────────────────────────────
  const conflictMap = useMemo(() => {
    const map = new Map<string, Resource>()
    if (!templateDetail) return map

    const bySlug = getResourceById(templateDetail.entity.apiSlug)
    if (bySlug) {
      map.set(templateDetail.id, bySlug)
    } else {
      const byName = resources.find(
        (r) => r.label.toLowerCase() === templateDetail.entity.singular.toLowerCase()
      )
      if (byName) {
        map.set(templateDetail.id, byName)
      }
    }
    return map
  }, [templateDetail, resources, getResourceById])

  const hasAnyConflict = conflictMap.size > 0

  function getResolution(id: string): ConflictResolution {
    return conflictResolutions[id] ?? 'use-existing'
  }

  function getNewRelationshipFields(
    template: NonNullable<typeof templateDetail>,
    existingResource: Resource
  ) {
    const relFields = template.fields.filter((f) => f.type === 'RELATIONSHIP')
    return relFields.filter((field) => {
      const ref = field.relationship?.relatedResourceId
      if (!ref) return false

      let targetEntityDefId: string | undefined
      if (ref.startsWith('@template:')) {
        const targetTemplateId = ref.slice('@template:'.length)
        const targetConflict = conflictMap.get(targetTemplateId)
        if (targetConflict && getResolution(targetTemplateId) === 'use-existing') {
          targetEntityDefId = targetConflict.entityDefinitionId
        }
        if (!targetConflict || getResolution(targetTemplateId) === 'create-new') {
          return true
        }
      } else if (ref.startsWith('@system:')) {
        const systemType = ref.slice('@system:'.length)
        const systemResource = resources.find(
          (r) => 'entityType' in r && r.entityType === systemType
        )
        targetEntityDefId = systemResource?.entityDefinitionId
      } else {
        targetEntityDefId = ref
      }

      if (!targetEntityDefId) return true

      const alreadyHasRelationship = existingResource.fields.some((existingField) => {
        if (!existingField.relationship) return false
        const existingTarget = getRelatedEntityDefinitionId(
          existingField.relationship as RelationshipConfig
        )
        return existingTarget === targetEntityDefId
      })

      return !alreadyHasRelationship
    })
  }

  const handleFieldModifications = useCallback(
    (id: string, modifications: Record<string, FieldState>) => {
      setAllFieldModifications((prev) => ({ ...prev, [id]: modifications }))
    },
    []
  )

  const selectedTemplateIds = useMemo(() => new Set([templateId]), [templateId])

  const isConflictUseExisting =
    conflictMap.has(templateId) && getResolution(templateId) === 'use-existing'

  const installButtonLabel = isConflictUseExisting ? 'Link relationships only' : 'Install entity'

  async function handleInstall() {
    const conflict = conflictMap.get(templateId)
    const resolution = getResolution(templateId)

    const linkedEntities: Record<
      string,
      { entityDefinitionId: string; newRelationshipFieldTemplateIds?: string[] }
    > = {}
    const templateIdsToCreate: string[] = []

    if (conflict && resolution === 'use-existing') {
      const newRelFields = templateDetail ? getNewRelationshipFields(templateDetail, conflict) : []
      linkedEntities[templateId] = {
        entityDefinitionId: conflict.entityDefinitionId,
        ...(newRelFields.length > 0 && {
          newRelationshipFieldTemplateIds: newRelFields.map((f) => f.templateFieldId),
        }),
      }
    } else {
      templateIdsToCreate.push(templateId)
    }

    // Entity limit check
    if (typeof entityLimit === 'number' && entityLimit > 0) {
      if (userCreatedEntityCount + templateIdsToCreate.length > entityLimit) {
        setLimitDialogOpen(true)
        return
      }
    }

    // Build field modifications
    const modifications: Record<
      string,
      Record<string, { customName?: string; removed?: boolean }>
    > = {}
    const fieldStates = allFieldModifications[templateId]
    if (fieldStates) {
      const changed: Record<string, { customName?: string; removed?: boolean }> = {}
      for (const [fieldId, state] of Object.entries(fieldStates)) {
        if (state.customName !== null || state.removed) {
          changed[fieldId] = {
            ...(state.customName !== null && { customName: state.customName }),
            ...(state.removed && { removed: true }),
          }
        }
      }
      if (Object.keys(changed).length > 0) {
        modifications[templateId] = changed
      }
    }

    await installTemplates.mutateAsync({
      templateIds: templateIdsToCreate,
      ...(Object.keys(modifications).length > 0 && { fieldModifications: modifications }),
      ...(Object.keys(linkedEntities).length > 0 && { linkedEntities }),
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setAllFieldModifications({})
      setConflictResolutions({})
    }
    onOpenChange(nextOpen)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent size='xs' innerClassName='p-0' position='tc'>
          <DialogHeader className='border-b px-4  mb-0 '>
            <DialogTitle className='text-sm font-semibold h-10 flex items-center mb-0'>
              Install Entity
            </DialogTitle>
            <DialogDescription className='sr-only'>Install an entity template</DialogDescription>
          </DialogHeader>

          {isLoading || !templateDetail ? (
            <div className='flex items-center justify-center py-12'>
              <Loader2 className='size-6 animate-spin text-muted-foreground' />
            </div>
          ) : (
            <>
              <ScrollArea className='max-h-[400px]'>
                <div className='p-4 flex-col space-y-4 flex items-center'>
                  {/* Primary entity preview card */}
                  <EntityPreviewCard
                    template={templateDetail}
                    primary
                    selectedTemplateIds={selectedTemplateIds}
                    onFieldModifications={handleFieldModifications}
                    hasAnyConflict={hasAnyConflict}
                    conflictingResource={conflictMap.get(templateDetail.id) ?? null}
                    conflictResolution={getResolution(templateDetail.id)}
                    onConflictResolutionChange={
                      conflictMap.has(templateDetail.id)
                        ? (r) =>
                            setConflictResolutions((prev) => ({
                              ...prev,
                              [templateDetail.id]: r,
                            }))
                        : undefined
                    }
                    newRelationshipFields={
                      conflictMap.has(templateDetail.id) &&
                      getResolution(templateDetail.id) === 'use-existing'
                        ? getNewRelationshipFields(
                            templateDetail,
                            conflictMap.get(templateDetail.id)!
                          )
                        : undefined
                    }
                  />
                </div>
                <div className='border-t px-4 py-2 flex items-center flex-col h-12 justify-center sticky bottom-0 inset-x-0 backdrop-blur'>
                  <Button
                    className='w-full'
                    onClick={handleInstall}
                    loading={installTemplates.isPending}
                    loadingText='Installing...'>
                    {installButtonLabel}
                  </Button>
                </div>
              </ScrollArea>

              {/* Footer */}
            </>
          )}
        </DialogContent>
      </Dialog>

      <LimitReachedDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        icon={Plus}
        title='Entity Limit Reached'
        description={`You've reached the maximum of ${entityLimit} custom entities on your current plan.`}
      />
    </>
  )
}
