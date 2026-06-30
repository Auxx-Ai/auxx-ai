// apps/web/src/components/custom-fields/ui/entity-template-dialog.tsx
'use client'

import { constants } from '@auxx/config/client'
import type { ConflictResolution } from '@auxx/lib/entity-templates'
import { FeatureKey } from '@auxx/lib/permissions/client'
import type { Resource } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Link2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { TemplateDetailLayout, TemplateGalleryDialog } from '~/components/templates/ui'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { EntityPreviewCard, type FieldState } from './entity-preview-card'

/** Result returned to the caller after successful installation */
export interface EntityTemplateInstallResult {
  created: Array<{ templateId: string; entityDefinitionId: string; name: string; apiSlug: string }>
  linked: Array<{ templateId: string; entityDefinitionId: string; name: string }>
  skippedRelationships: string[]
  fieldIdMap: Record<string, string>
}

interface EntityTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, skip list view and pre-select these template IDs */
  preSelectedTemplateIds?: string[]
  /** Called after successful installation with the full result including fieldIdMap */
  onComplete?: (result: EntityTemplateInstallResult) => void
  /**
   * Connector/app ownership to stamp on installed defs + fields (v6). Set when the
   * dialog is opened inside a connector wizard so the installed record-type defs are
   * connector-owned (delete prompt) and app-owned (uninstall cleanup + appFieldKey
   * idempotency). Absent for a plain gallery install.
   */
  installContext?: { dataConnectorId?: string; appInstallationId?: string }
}

type EntityTemplate = RouterOutputs['entityDefinition']['getTemplates'][number]

/**
 * Dialog for selecting and installing entity definition templates. The gallery
 * shell, sidebar, search, and filtering live in `TemplateGalleryDialog`; the
 * detail page uses the shared two-pane `TemplateDetailLayout` (preview-card strip
 * + companion picker). All conflict/companion/modification state stays here.
 */
export function EntityTemplateDialog({
  open,
  onOpenChange,
  preSelectedTemplateIds,
  onComplete,
  installContext,
}: EntityTemplateDialogProps) {
  const router = useRouter()
  const { resources, customResources, getResourceById } = useResources()
  const { getLimit } = useFeatureFlags()
  const entityLimit = getLimit(FeatureKey.entities)
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0

  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [companionSelections, setCompanionSelections] = useState<Set<string>>(new Set())
  const [allFieldModifications, setAllFieldModifications] = useState<
    Record<string, Record<string, FieldState>>
  >({})
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, ConflictResolution>
  >({})

  // Fetch all templates
  const { data: templates, isLoading } = api.entityDefinition.getTemplates.useQuery(
    {},
    { enabled: open }
  )

  // Auto-select when preSelectedTemplateIds is provided (opens straight into detail)
  useEffect(() => {
    if (open && preSelectedTemplateIds?.length) {
      const [primaryId, ...companionIds] = preSelectedTemplateIds
      if (primaryId) {
        setSelectedTemplateId(primaryId)
        setCompanionSelections(new Set(companionIds))
      }
    }
  }, [open, preSelectedTemplateIds])

  // Fetch full template detail when one is selected
  const { data: templateDetail } = api.entityDefinition.getTemplateById.useQuery(
    { id: selectedTemplateId ?? '' },
    { enabled: !!selectedTemplateId }
  )

  // Install mutation
  const utils = api.useUtils()
  const installTemplates = api.entityDefinition.createFromTemplates.useMutation({
    onSuccess: (result) => {
      utils.entityDefinition.getAll.invalidate()
      utils.resource.list.invalidate()

      // If onComplete callback provided, pass the result and let the caller handle navigation
      if (onComplete) {
        onComplete(result as EntityTemplateInstallResult)
        return
      }

      onOpenChange(false)
      // Navigate to first created entity, if any were created
      if (result.created.length > 0) {
        router.push(`/app/custom/${result.created[0]!.apiSlug}`)
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to install template', description: error.message })
    },
  })

  // Fetch companion template details for preview cards
  const companionIds = templateDetail?.companions ?? []
  const companionQueries = api.useQueries((t) =>
    companionIds.map((id) =>
      t.entityDefinition.getTemplateById({ id }, { enabled: !!selectedTemplateId })
    )
  )
  const companionTemplateDetails = companionQueries
    .map((q) => q.data)
    .filter(Boolean) as NonNullable<typeof templateDetail>[]

  // ── Conflict detection ──────────────────────────────────────────────
  /** Map of templateId → conflicting Resource (if any) */
  const conflictMap = useMemo(() => {
    const map = new Map<string, Resource>()
    if (!templateDetail) return map

    // Check all templates that will be installed (primary + companions)
    const templatesToCheck = [templateDetail, ...companionTemplateDetails]
    for (const template of templatesToCheck) {
      // Try matching by apiSlug first
      const bySlug = getResourceById(template.entity.apiSlug)
      if (bySlug) {
        map.set(template.id, bySlug)
        continue
      }
      // Fallback: match by singular name (case-insensitive)
      const byName = resources.find(
        (r) => r.label.toLowerCase() === template.entity.singular.toLowerCase()
      )
      if (byName) {
        map.set(template.id, byName)
      }
    }
    return map
  }, [templateDetail, companionTemplateDetails, resources, getResourceById])

  const hasAnyConflict = conflictMap.size > 0

  /** Get current resolution for a template (defaults to 'use-existing') */
  function getResolution(templateId: string): ConflictResolution {
    return conflictResolutions[templateId] ?? 'use-existing'
  }

  /** Compute new relationship fields for a linked (use-existing) template */
  function getNewRelationshipFields(
    template: NonNullable<typeof templateDetail>,
    existingResource: Resource
  ) {
    const relFields = template.fields.filter((f) => f.type === 'RELATIONSHIP')
    return relFields.filter((field) => {
      const ref = field.relationship?.relatedResourceId
      if (!ref) return false

      // Resolve what entity definition ID this template field would point to
      let targetEntityDefId: string | undefined
      if (ref.startsWith('@template:')) {
        const targetTemplateId = ref.slice('@template:'.length)
        // Check if target template has a conflicting resource with "use-existing"
        const targetConflict = conflictMap.get(targetTemplateId)
        if (targetConflict && getResolution(targetTemplateId) === 'use-existing') {
          targetEntityDefId = targetConflict.entityDefinitionId
        }
        // If the target template is being created fresh, we can't compare yet — include it
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

      if (!targetEntityDefId) return true // Can't resolve — include it as new

      // Check if the existing resource already has a relationship field pointing to the same target
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
    (templateId: string, modifications: Record<string, FieldState>) => {
      setAllFieldModifications((prev) => ({ ...prev, [templateId]: modifications }))
    },
    []
  )

  /** All template IDs currently selected (primary + companions) */
  const selectedTemplateIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedTemplateId) ids.add(selectedTemplateId)
    for (const id of companionSelections) ids.add(id)
    // Also include linked templates so relationship refs resolve
    for (const [templateId, resolution] of Object.entries(conflictResolutions)) {
      if (resolution === 'use-existing' && conflictMap.has(templateId)) {
        ids.add(templateId)
      }
    }
    // Include default use-existing conflicts
    for (const templateId of conflictMap.keys()) {
      if (!conflictResolutions[templateId]) {
        ids.add(templateId)
      }
    }
    return ids
  }, [selectedTemplateId, companionSelections, conflictResolutions, conflictMap])

  /** Selecting a template (shell-controlled): seed companions + reset modifications */
  function handleSelectedIdChange(id: string | null) {
    setSelectedTemplateId(id)
    if (!id) return
    setAllFieldModifications({})
    setConflictResolutions({})
    const template = templates?.find((t) => t.id === id)
    setCompanionSelections(new Set(template?.companions ?? []))
  }

  /** Reset detail-only state when leaving the detail page (back or close) */
  function handleDetailExit() {
    setCompanionSelections(new Set())
    setAllFieldModifications({})
    setConflictResolutions({})
  }

  /** Toggle a companion template selection */
  function toggleCompanion(companionId: string) {
    setCompanionSelections((prev) => {
      const next = new Set(prev)
      if (next.has(companionId)) {
        next.delete(companionId)
      } else {
        next.add(companionId)
      }
      return next
    })
  }

  /** Handle install */
  async function handleInstall() {
    if (!selectedTemplateId) return

    const allTemplateIds = [selectedTemplateId, ...companionSelections]
    const uniqueIds = [...new Set(allTemplateIds)]

    // Build linkedEntities map for templates resolved as "use-existing"
    const linkedEntities: Record<
      string,
      { entityDefinitionId: string; newRelationshipFieldTemplateIds?: string[] }
    > = {}

    // Separate template IDs: those being created vs those being linked
    const templateIdsToCreate: string[] = []

    for (const templateId of uniqueIds) {
      const conflict = conflictMap.get(templateId)
      const resolution = getResolution(templateId)

      if (conflict && resolution === 'use-existing') {
        // Find the full template detail to compute new relationship fields
        const fullTemplate =
          templateId === templateDetail?.id
            ? templateDetail
            : companionTemplateDetails.find((c) => c.id === templateId)

        const newRelFields = fullTemplate ? getNewRelationshipFields(fullTemplate, conflict) : []

        linkedEntities[templateId] = {
          entityDefinitionId: conflict.entityDefinitionId,
          ...(newRelFields.length > 0 && {
            newRelationshipFieldTemplateIds: newRelFields.map((f) => f.templateFieldId),
          }),
        }
      } else {
        templateIdsToCreate.push(templateId)
      }
    }

    // Check if installing these templates would exceed the entity limit
    if (typeof entityLimit === 'number' && entityLimit > 0) {
      if (userCreatedEntityCount + templateIdsToCreate.length > entityLimit) {
        setLimitDialogOpen(true)
        return
      }
    }

    // Only include modifications that actually have changes
    const modifications: Record<
      string,
      Record<string, { customName?: string; removed?: boolean }>
    > = {}
    for (const [templateId, fieldStates] of Object.entries(allFieldModifications)) {
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
      ...(installContext && { installContext }),
    })
  }

  /** Whether the user has made any field modifications in detail view */
  const isDirty = useMemo(() => {
    if (selectedTemplateId == null) return false
    return Object.values(allFieldModifications).some((fields) =>
      Object.values(fields).some((state) => state.customName !== null || state.removed)
    )
  }, [selectedTemplateId, allFieldModifications])

  /** Smart install button label based on create vs link counts */
  const installButtonLabel = useMemo(() => {
    if (!selectedTemplateId) return 'Use this template'

    const allIds = [selectedTemplateId, ...companionSelections]
    let createCount = 0
    let linkCount = 0

    for (const id of allIds) {
      const conflict = conflictMap.get(id)
      const resolution = conflictResolutions[id] ?? 'use-existing'
      if (conflict && resolution === 'use-existing') {
        linkCount++
      } else {
        createCount++
      }
    }

    if (linkCount === 0) {
      // No conflicts — original behavior
      if (companionSelections.size > 0) {
        return `Use this template (+${companionSelections.size} companion${companionSelections.size !== 1 ? 's' : ''})`
      }
      return 'Use this template'
    }

    if (createCount === 0) {
      return 'Link relationships only'
    }

    const entityWord = createCount === 1 ? 'entity' : 'entities'
    return `Create ${createCount} ${entityWord}, link ${linkCount} existing`
  }, [selectedTemplateId, companionSelections, conflictMap, conflictResolutions])

  const { guardProps, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: () => onOpenChange(false),
  })

  return (
    <>
      <TemplateGalleryDialog<EntityTemplate>
        open={open}
        onOpenChange={onOpenChange}
        title='Create from template'
        description='Select an entity template to scaffold'
        crumbLabel='Entity templates'
        items={templates ?? []}
        isLoading={isLoading}
        categories={constants.entityTemplateCategories}
        selectedId={selectedTemplateId}
        onSelectedIdChange={handleSelectedIdChange}
        onDetailExit={handleDetailExit}
        detailBusy={installTemplates.isPending}
        contentProps={guardProps}
        renderIcon={(template) => (
          <EntityIcon
            iconId={template.entity.icon}
            color={template.entity.color}
            size='lg'
            inverse
            className='inset-shadow-xs inset-shadow-black/20'
          />
        )}
        renderNameBadge={(template) => (
          <Badge variant='secondary' className='shrink-0 text-xs'>
            {template.fieldCount} fields
          </Badge>
        )}
        detailCrumb={(template) => template.name}
        renderDetail={() => (
          <TemplateDetailLayout
            previewLoading={!templateDetail}
            preview={
              templateDetail ? (
                <ScrollArea orientation='both' className='h-full'>
                  <div className='flex items-start gap-4 p-6 [&>[data-slot=preview-card]:last-child]:pr-6'>
                    {/* Primary template card */}
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

                    {/* Companion template cards */}
                    {companionTemplateDetails.map((companion) => {
                      const conflict = conflictMap.get(companion.id) ?? null
                      const resolution = getResolution(companion.id)
                      return (
                        <EntityPreviewCard
                          key={companion.id}
                          template={companion}
                          selected={companionSelections.has(companion.id)}
                          selectedTemplateIds={selectedTemplateIds}
                          onToggle={() => toggleCompanion(companion.id)}
                          onFieldModifications={handleFieldModifications}
                          hasAnyConflict={hasAnyConflict}
                          conflictingResource={conflict}
                          conflictResolution={resolution}
                          onConflictResolutionChange={
                            conflict
                              ? (r) =>
                                  setConflictResolutions((prev) => ({
                                    ...prev,
                                    [companion.id]: r,
                                  }))
                              : undefined
                          }
                          newRelationshipFields={
                            conflict && resolution === 'use-existing'
                              ? getNewRelationshipFields(companion, conflict)
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                </ScrollArea>
              ) : null
            }>
            <div className='space-y-6 p-3'>
              {/* Template info */}
              {templateDetail && (
                <div>
                  <h3 className='mb-2 text-sm font-semibold text-muted-foreground'>
                    {templateDetail.name}
                  </h3>
                  <p className='text-sm'>{templateDetail.description}</p>
                  <div className='mt-2 flex flex-wrap gap-1'>
                    {templateDetail.categories.map((cat) => (
                      <Badge key={cat} variant='outline' className='text-xs'>
                        {constants.entityTemplateCategories.find((c) => c.value === cat)?.label ??
                          cat}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Companion templates */}
              {templateDetail?.companions && templateDetail.companions.length > 0 && (
                <div className='space-y-2'>
                  <h4 className='text-sm font-medium'>Also install</h4>
                  <p className='text-xs text-muted-foreground'>
                    These templates work best together. Select companions to install alongside.
                  </p>
                  <div className='space-y-1.5'>
                    {templateDetail.companions.map((companionId) => {
                      const companion = templates?.find((t) => t.id === companionId)
                      if (!companion) return null

                      const conflict = conflictMap.get(companionId)
                      const resolution = getResolution(companionId)
                      const isLinked = conflict && resolution === 'use-existing'

                      return (
                        <label
                          key={companionId}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-lg border p-2 transition-colors hover:bg-muted',
                            isLinked &&
                              'border-amber-200 bg-amber-50/50 hover:dark:bg-amber-300/10 dark:border-amber-300/30 dark:bg-amber-50/10'
                          )}>
                          <Checkbox
                            checked={companionSelections.has(companionId)}
                            onCheckedChange={() => toggleCompanion(companionId)}
                          />
                          <EntityIcon
                            iconId={companion.entity.icon}
                            color={companion.entity.color}
                            size='xs'
                            inverse
                          />
                          <span className='text-sm'>{companion.name}</span>
                          {isLinked ? (
                            <Badge
                              variant='outline'
                              className='ml-auto border-amber-300 text-xs text-amber-700'>
                              <Link2 className='size-3' />
                              already exists
                            </Badge>
                          ) : (
                            <Badge variant='secondary' className='ml-auto text-xs'>
                              {companion.fieldCount} fields
                            </Badge>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </TemplateDetailLayout>
        )}
        renderDetailFooter={() => (
          <Button
            size='sm'
            variant='outline'
            onClick={handleInstall}
            loading={installTemplates.isPending}
            loadingText='Installing...'>
            {installButtonLabel}
          </Button>
        )}
      />
      <ConfirmDialog />
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
