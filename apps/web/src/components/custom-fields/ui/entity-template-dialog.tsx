// apps/web/src/components/custom-fields/ui/entity-template-dialog.tsx
'use client'

import { constants } from '@auxx/config/client'
import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
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
  Loader2,
  type LucideIcon,
  Search,
  Settings,
  ShoppingBag,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'

type EntityTemplateCategory = (typeof constants.entityTemplateCategories)[number]['value']

/** Icon map for entity template categories */
const categoryIcons: Record<string, LucideIcon> = {
  LayoutGrid,
  ShoppingBag,
  Users,
  Settings,
  Headphones,
}

interface EntityTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ViewMode = 'list' | 'detail'

/**
 * Dialog for selecting and installing entity definition templates.
 * Mirrors the workflow-template-dialog pattern with category sidebar + template grid.
 */
export function EntityTemplateDialog({ open, onOpenChange }: EntityTemplateDialogProps) {
  const router = useRouter()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<EntityTemplateCategory>('all')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [companionSelections, setCompanionSelections] = useState<Set<string>>(new Set())

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
      onOpenChange(false)
      // Navigate to first created entity
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

    const templateIds = [selectedTemplateId, ...companionSelections]
    // Deduplicate
    const uniqueIds = [...new Set(templateIds)]

    await installTemplates.mutateAsync({ templateIds: uniqueIds })
  }

  /** Reset state when dialog closes */
  function handleOpenChange(open: boolean) {
    if (!open) {
      setViewMode('list')
      setSelectedTemplateId(null)
      setCompanionSelections(new Set())
      setSearchQuery('')
      setSelectedCategory('all')
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='h-[550px]' innerClassName='p-0' position='tc' size='3xl'>
        <div className='flex flex-col flex-1 min-h-0'>
          {viewMode === 'list' ? (
            <>
              {/* LIST VIEW */}
              <DialogHeader className='border-b px-3 h-10 flex flex-row items-center justify-start mb-0'>
                <div>
                  <Button variant='ghost' size='sm'>
                    Entity templates
                  </Button>
                  <DialogTitle className='sr-only'>Create from Template</DialogTitle>
                  <DialogDescription className='sr-only'>
                    Select an entity template to scaffold
                  </DialogDescription>
                </div>
              </DialogHeader>

              <div className='flex flex-1 flex-row justify-start w-full min-h-0'>
                {/* Sidebar */}
                <div className='w-64 border-r bg-muted/30 flex flex-col rounded-bl-[16px]'>
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
                  <div className='py-3 px-6'>
                    <InputSearch
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
                      <div className='p-6 space-y-2'>
                        {filteredTemplates.map((template) => (
                          <div
                            key={template.id}
                            onClick={() => handleSelectTemplate(template.id)}
                            className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer'>
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
                              <div className='flex gap-1 shrink-0'>
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

              <div className='flex flex-1 overflow-hidden'>
                {/* Left: Preview cards — horizontally scrollable */}
                <div className='flex-2 border-r bg-muted/30 overflow-hidden'>
                  {templateDetail ? (
                    <ScrollArea orientation='both' className='h-full'>
                      <div className='flex gap-4 p-6 items-start [&>[data-slot=preview-card]:last-child]:pr-6'>
                        {/* Primary template card */}
                        <EntityPreviewCard template={templateDetail} primary />

                        {/* Companion template cards */}
                        {companionTemplateDetails.map((companion) => (
                          <EntityPreviewCard
                            key={companion.id}
                            template={companion}
                            selected={companionSelections.has(companion.id)}
                            onToggle={() => toggleCompanion(companion.id)}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className='flex items-center justify-center h-full'>
                      <Loader2 className='w-8 h-8 animate-spin text-muted-foreground' />
                    </div>
                  )}
                </div>

                {/* Right: Template info + companions + install */}
                <div className='flex-1 flex flex-col'>
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

                              return (
                                <label
                                  key={companionId}
                                  className='flex items-center gap-2 rounded-lg border p-2 cursor-pointer hover:bg-muted transition-colors'>
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
                                  <Badge variant='secondary' className='text-xs ml-auto'>
                                    {companion.fieldCount} fields
                                  </Badge>
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
                      Use this template
                      {companionSelections.size > 0 &&
                        ` (+${companionSelections.size} companion${companionSelections.size !== 1 ? 's' : ''})`}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Preview card showing entity icon + field list with optional checkbox */
function EntityPreviewCard({
  template,
  primary,
  selected,
  onToggle,
}: {
  template: {
    entity: { icon: string; color: string; singular: string; plural: string }
    fields: Array<{ templateFieldId: string; name: string; type: string }>
  }
  /** Primary card — always included, no checkbox */
  primary?: boolean
  /** Whether this companion card is selected */
  selected?: boolean
  /** Toggle selection callback (companion cards only) */
  onToggle?: () => void
}) {
  return (
    <div data-slot='preview-card' className='shrink-0'>
      <div
        onClick={!primary ? onToggle : undefined}
        className={cn(
          'rounded-2xl border p-3 w-xs relative',
          primary
            ? 'bg-primary-50 ring-2 ring-primary'
            : selected
              ? 'bg-primary-50 cursor-pointer'
              : 'bg-muted/50 opacity-60 cursor-pointer'
        )}>
        {/* Checkbox in upper right for companion cards (visual only) */}
        {!primary && (
          <div className='absolute top-2.5 right-2.5 pointer-events-none'>
            <Checkbox checked={selected} tabIndex={-1} />
          </div>
        )}

        {/* Header */}
        <div className='flex items-center gap-2 mb-3'>
          <EntityIcon
            iconId={template.entity.icon}
            color={template.entity.color}
            size='default'
            inverse
            className='inset-shadow-xs inset-shadow-black/20'
          />
          <div>
            <h3 className='text-sm font-semibold'>{template.entity.singular}</h3>
            <p className='text-xs text-muted-foreground'>
              {template.entity.plural} &middot; {template.fields.length} fields
            </p>
          </div>
        </div>

        {/* Field list */}
        <div className='space-y-1'>
          {template.fields.map((field) => {
            const fieldTypeOption = fieldTypeOptions[field.type as FieldType]
            const iconId = fieldTypeOption?.iconId ?? 'circle'
            const label = fieldTypeOption?.label ?? field.type

            return (
              <div
                key={field.templateFieldId}
                className='flex h-7 items-center gap-1 rounded-md bg-primary-100 px-2'>
                <div className='flex flex-row justify-between w-full items-center'>
                  <span className='text-sm text-foreground'>{field.name}</span>
                  <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                    <EntityIcon iconId={iconId} variant='default' size='default' />
                    <span>{label}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
