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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { EntityIcon } from '@auxx/ui/components/icons'
import { InputSearch } from '@auxx/ui/components/input-search'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import {
  ChevronLeft,
  Headphones,
  LayoutGrid,
  Link2,
  Loader2,
  type LucideIcon,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useResources } from '~/components/resources/hooks'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { EntityPreviewCard, type FieldState } from './entity-preview-card'

type EntityTemplateCategory = (typeof constants.entityTemplateCategories)[number]['value']

/** Icon map for entity template categories */
const categoryIcons: Record<string, LucideIcon> = {
  LayoutGrid,
  ShoppingBag,
  Users,
  Settings,
  Headphones,
}

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
}

type ViewMode = 'list' | 'detail'

/**
 * Dialog for selecting and installing entity definition templates.
 * Mirrors the workflow-template-dialog pattern with category sidebar + template grid.
 */
export function EntityTemplateDialog({
  open,
  onOpenChange,
  preSelectedTemplateIds,
  onComplete,
}: EntityTemplateDialogProps) {
  const router = useRouter()
  const { resources, customResources, getResourceById } = useResources()
  const { getLimit } = useFeatureFlags()
  const entityLimit = getLimit(FeatureKey.entities)
  const userCreatedEntityCount = customResources?.filter((r) => !r.entityType).length ?? 0
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<EntityTemplateCategory>('all')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [companionSelections, setCompanionSelections] = useState<Set<string>>(new Set())
  const [allFieldModifications, setAllFieldModifications] = useState<
    Record<string, Record<string, FieldState>>
  >({})
  const [conflictResolutions, setConflictResolutions] = useState<
    Record<string, ConflictResolution>
  >({})

  // Auto-select when preSelectedTemplateIds is provided
  useEffect(() => {
    if (open && preSelectedTemplateIds?.length) {
      const [primaryId, ...companionIds] = preSelectedTemplateIds
      if (primaryId) {
        setSelectedTemplateId(primaryId)
        setCompanionSelections(new Set(companionIds))
        setViewMode('detail')
      }
    }
  }, [open, preSelectedTemplateIds])

  // Fetch all templates
  const { data: templates, isLoading } = api.entityDefinition.getTemplates.useQuery(
    {},
    { enabled: open }
  )

  // Fetch full template detail when one is selected
  const { data: templateDetail } = api.entityDefinition.getTemplateById.useQuery(
    { id: selectedTemplateId ?? '' },
    { enabled: !!selectedTemplateId && viewMode === 'detail' }
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
      t.entityDefinition.getTemplateById({ id }, { enabled: viewMode === 'detail' })
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

  // Filter templates client-side
  const filteredTemplates = useMemo(() => {
    if (!templates) return []

    let filtered = templates

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((t) => t.categories.includes(selectedCategory))
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [templates, selectedCategory, searchQuery])

  /** Handle template selection — switch to detail view */
  function handleSelectTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    setAllFieldModifications({})
    setConflictResolutions({})

    // Auto-select companions
    const template = templates?.find((t) => t.id === templateId)
    if (template?.companions) {
      setCompanionSelections(new Set(template.companions))
    } else {
      setCompanionSelections(new Set())
    }

    setViewMode('detail')
  }

  /** Handle back button */
  function handleBackToList() {
    setViewMode('list')
    setSelectedTemplateId(null)
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
    })
  }

  /** Whether the user has made any field modifications in detail view */
  const isDirty = useMemo(() => {
    if (viewMode !== 'detail') return false
    return Object.values(allFieldModifications).some((fields) =>
      Object.values(fields).some((state) => state.customName !== null || state.removed)
    )
  }, [viewMode, allFieldModifications])

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

  /** Reset all state and close the dialog */
  const handleConfirmedClose = useCallback(() => {
    setViewMode('list')
    setSelectedTemplateId(null)
    setCompanionSelections(new Set())
    setSearchQuery('')
    setSelectedCategory('all')
    setAllFieldModifications({})
    setConflictResolutions({})
    onOpenChange(false)
  }, [onOpenChange])

  const { guardProps, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: handleConfirmedClose,
  })

  /** Reset state when dialog closes */
  function handleOpenChange(open: boolean) {
    if (!open) {
      setViewMode('list')
      setSelectedTemplateId(null)
      setCompanionSelections(new Set())
      setSearchQuery('')
      setSelectedCategory('all')
      setConflictResolutions({})
    }
    onOpenChange(open)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className='h-dvh sm:h-[550px]'
          innerClassName='p-0'
          position='tc'
          size='3xl'
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            searchInputRef.current?.focus()
          }}
          {...guardProps}>
          <div className='flex flex-col flex-1 min-h-0'>
            {viewMode === 'list' ? (
              <>
                {/* LIST VIEW */}
                <DialogHeader className='border-b px-3 h-10 flex flex-row items-center justify-start mb-0'>
                  <div>
                    <Button variant='ghost' size='sm'>
                      Entity templates
                    </Button>
                    <DialogTitle className='sr-only'>Create from template</DialogTitle>
                    <DialogDescription className='sr-only'>
                      Select an entity template to scaffold
                    </DialogDescription>
                  </div>
                </DialogHeader>

                <div className='flex flex-1 flex-col sm:flex-row justify-start w-full min-h-0'>
                  {/* Sidebar */}
                  <div className='hidden sm:flex w-64 border-r bg-muted/30 flex-col rounded-bl-[16px]'>
                    <ScrollArea>
                      <h3 className='p-3 pb-0 text-sm font-semibold text-muted-foreground sticky top-0'>
                        Categories
                      </h3>
                      <div className='p-3'>
                        <RadioGroup
                          value={selectedCategory}
                          onValueChange={(v) => setSelectedCategory(v as EntityTemplateCategory)}>
                          {constants.entityTemplateCategories.map((category) => {
                            const count =
                              category.value === 'all'
                                ? (templates?.length ?? 0)
                                : (templates?.filter((t) => t.categories.includes(category.value))
                                    .length ?? 0)

                            const Icon = categoryIcons[category.icon]

                            return (
                              <RadioGroupItemCard
                                key={category.value}
                                label={category.label}
                                value={category.value}
                                description={
                                  isLoading
                                    ? 'Loading...'
                                    : `${count} template${count !== 1 ? 's' : ''}`
                                }
                                icon={Icon ? <Icon /> : undefined}
                              />
                            )
                          })}
                        </RadioGroup>
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Template grid */}
                  <div className='flex-1 overflow-hidden flex flex-col'>
                    <div className='py-3 px-3 sm:px-6'>
                      <InputSearch
                        ref={searchInputRef}
                        placeholder='Search templates...'
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClear={() => setSearchQuery('')}
                      />
                    </div>

                    {isLoading ? (
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant='icon'>
                            <Loader2 className='animate-spin' />
                          </EmptyMedia>
                          <EmptyTitle>Loading...</EmptyTitle>
                          <EmptyDescription>Fetching entity templates</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : filteredTemplates.length > 0 ? (
                      <ScrollArea className='flex-1'>
                        <div className='p-3 sm:p-6 space-y-2'>
                          {filteredTemplates.map((template) => (
                            <div
                              key={template.id}
                              onClick={() => handleSelectTemplate(template.id)}
                              className='group flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer'>
                              <div className='flex items-start gap-3 flex-1 min-w-0'>
                                <div className='size-8 rounded-lg flex items-center justify-center shrink-0'>
                                  <EntityIcon
                                    iconId={template.entity.icon}
                                    color={template.entity.color}
                                    size='default'
                                    inverse
                                    className='inset-shadow-xs inset-shadow-black/20'
                                  />
                                </div>
                                <div className='flex flex-col flex-1 min-w-0'>
                                  <div className='flex items-center gap-2'>
                                    <span className='text-sm font-medium truncate'>
                                      {template.name}
                                    </span>
                                    <Badge variant='secondary' className='text-xs shrink-0'>
                                      {template.fieldCount} fields
                                    </Badge>
                                  </div>
                                  <span className='text-xs text-muted-foreground line-clamp-1 mt-0.5'>
                                    {template.description}
                                  </span>
                                </div>
                              </div>
                              {template.categories.length > 0 && (
                                <div className='flex gap-1 shrink-0 ml-11 sm:ml-0'>
                                  {template.categories.slice(0, 2).map((cat) => (
                                    <Badge key={cat} variant='outline' className='text-xs'>
                                      {cat}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    ) : (
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant='icon'>
                            <Search />
                          </EmptyMedia>
                          <EmptyTitle>No templates found</EmptyTitle>
                          <EmptyDescription>
                            {searchQuery
                              ? 'No templates match your search. Try adjusting your query.'
                              : 'No templates available in this category.'}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}

                    {!isLoading && filteredTemplates.length > 0 && (
                      <div className='border-t px-6 py-3 bg-muted/30'>
                        <p className='text-sm text-muted-foreground'>
                          Showing {filteredTemplates.length} template
                          {filteredTemplates.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* DETAIL VIEW */}
                <DialogHeader className='border-b px-3 py-2 mb-0 h-10'>
                  <div className='flex items-center gap-1'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={handleBackToList}
                      disabled={installTemplates.isPending}>
                      <ChevronLeft />
                      Back
                    </Button>
                    <Separator orientation='vertical' className='h-5' />
                    <Button variant='ghost' size='sm'>
                      {templateDetail?.name ?? 'Loading...'}
                    </Button>
                    <DialogTitle className='sr-only'>Template Detail</DialogTitle>
                    <DialogDescription className='sr-only'>
                      Preview and install template
                    </DialogDescription>
                  </div>
                </DialogHeader>

                <div className='flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden'>
                  {/* Left: Preview cards — horizontally scrollable */}
                  <div className='h-1/2 sm:h-auto sm:flex-2 border-b sm:border-b-0 sm:border-r bg-muted/30 overflow-hidden'>
                    {templateDetail ? (
                      <ScrollArea orientation='both' className='h-full sm:min-h-[400px]'>
                        <div className='flex gap-4 p-6 items-start [&>[data-slot=preview-card]:last-child]:pr-6'>
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
                    ) : (
                      <div className='flex items-center justify-center h-full'>
                        <Loader2 className='w-8 h-8 animate-spin text-muted-foreground' />
                      </div>
                    )}
                  </div>

                  {/* Right: Template info + companions + install */}
                  <div className='h-1/2 sm:h-auto sm:flex-1 flex flex-col'>
                    <ScrollArea className='flex-1'>
                      <div className='p-3 space-y-6'>
                        {/* Template info */}
                        {templateDetail && (
                          <div>
                            <h3 className='text-sm font-semibold text-muted-foreground mb-2'>
                              {templateDetail.name}
                            </h3>
                            <p className='text-sm'>{templateDetail.description}</p>
                            <div className='flex gap-1 flex-wrap mt-2'>
                              {templateDetail.categories.map((cat) => (
                                <Badge key={cat} variant='outline' className='text-xs'>
                                  {cat}
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
                              These templates work best together. Select companions to install
                              alongside.
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
                                      'flex items-center gap-2 rounded-lg border p-2 cursor-pointer hover:bg-muted transition-colors',
                                      isLinked &&
                                        'border-amber-200 bg-amber-50/50 dark:bg-amber-50/10 hover:dark:bg-amber-300/10 dark:border-amber-300/30'
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
                                        className='text-xs ml-auto border-amber-300 text-amber-700'>
                                        <Link2 className='size-3' />
                                        already exists
                                      </Badge>
                                    ) : (
                                      <Badge variant='secondary' className='text-xs ml-auto'>
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
                    </ScrollArea>

                    {/* Footer */}
                    <div className='border-t p-3'>
                      <Button
                        className='w-full'
                        onClick={handleInstall}
                        loading={installTemplates.isPending}
                        loadingText='Installing...'>
                        {installButtonLabel}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
