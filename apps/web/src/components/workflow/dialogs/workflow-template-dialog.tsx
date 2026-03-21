// apps/web/src/components/workflow/dialogs/workflow-template-dialog.tsx
'use client'

import { constants } from '@auxx/config/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
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
import { Input } from '@auxx/ui/components/input'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Separator } from '@auxx/ui/components/separator'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import {
  AlertTriangle,
  ChevronLeft,
  GitBranch,
  Headphones,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  type LucideIcon,
  Search,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

import { InlineAppInstallButton } from '~/components/apps/app-install-button'
import { useResources } from '~/components/resources/hooks'
import type { WorkflowViewerData } from '~/components/workflow/viewer/hooks/use-workflow-viewer'
import { WorkflowViewer } from '~/components/workflow/viewer/workflow-viewer'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { api } from '~/trpc/react'
import { EntityRequirementsStep } from './entity-requirements-step'
import { SingleEntityInstallDialog } from './single-entity-install-dialog'

export type WorkflowCategory = (typeof constants.workflowCategories)[number]['value']

/**
 * Icon map for workflow categories
 * Maps icon string names to Lucide icon components
 */
const categoryIcons: Record<string, LucideIcon> = {
  LayoutGrid,
  Headphones,
  ShoppingBag,
  Zap,
  GitBranch,
  Sparkles,
  TrendingUp,
}

interface RequiredApp {
  appSlug: string
  appTitle: string
  blockIds: string[]
  triggerIds: string[]
  required: boolean
}

interface WorkflowTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
}

type ViewMode = 'list' | 'detail'

/**
 * Dialog for selecting a workflow template
 * Features a sidebar navigation and template grid display
 * Includes detail view for customizing template before creation
 */
export function WorkflowTemplateDialog({
  open,
  onOpenChange,
  organizationId,
}: WorkflowTemplateDialogProps) {
  const router = useRouter()
  const { appInstallations } = useExtensionsContext()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<WorkflowCategory>('all')
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null)

  // Form state for detail view
  const [workflowName, setWorkflowName] = useState('')
  const [workflowDescription, setWorkflowDescription] = useState('')

  // Single entity install dialog state
  const [entityInstallTemplateId, setEntityInstallTemplateId] = useState<string | null>(null)

  // Fetch all public templates once
  const { data: templates, isLoading } = api.workflow.templates.getPublic.useQuery(
    {},
    { enabled: open }
  )

  // Fetch full template detail when one is selected (for graph data)
  const { data: templateDetail, isLoading: isLoadingDetail } =
    api.workflow.templates.getById.useQuery(
      { id: selectedTemplate?.id ?? '' },
      { enabled: !!selectedTemplate?.id && viewMode === 'detail' }
    )

  // Entity requirements — resolved client-side via useResources()
  const selectedRequiredEntities = templateDetail?.requiredEntities ?? []
  const hasEntityRequirements = selectedRequiredEntities.length > 0
  const { resources, getResourceById } = useResources()

  // Transform template detail into WorkflowViewerData format
  const workflowViewerData: WorkflowViewerData | null = useMemo(() => {
    if (!templateDetail?.graph) return null
    return {
      name: templateDetail.name,
      graph: {
        nodes: templateDetail.graph.nodes || [],
        edges: templateDetail.graph.edges || [],
        viewport: templateDetail.graph.viewport || null,
      },
      envVars:
        templateDetail.envVars?.map((ev) => ({
          id: ev.id,
          name: ev.name,
          type: ev.type,
        })) || [],
    }
  }, [templateDetail])

  // Create workflow mutation
  const createWorkflow = api.workflow.create.useMutation({
    onSuccess: (workflow) => {
      onOpenChange(false)
      // Navigate to workflow editor
      router.push(`/app/workflows/${workflow.id}`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create workflow', description: error.message })
    },
  })

  /**
   * Check install status of required apps (entirely client-side)
   */
  const getAppInstallStatus = (apps: RequiredApp[]) => {
    return apps.map((app) => ({
      ...app,
      installed: appInstallations.some((inst) => inst.app.slug === app.appSlug),
      avatarUrl: appInstallations.find((inst) => inst.app.slug === app.appSlug)?.app.avatarUrl,
    }))
  }

  // Filter templates client-side
  const filteredTemplates = useMemo(() => {
    if (!templates) return []

    let filtered = templates

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter((template) =>
        (template.categories as string[])?.includes(selectedCategory)
      )
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (template) =>
          template.name.toLowerCase().includes(query) ||
          template.description.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [templates, selectedCategory, searchQuery])

  /**
   * Handle template selection - switch to detail view
   */
  const handleSelectTemplate = (template: any) => {
    setSelectedTemplate(template)
    setWorkflowName(template.name)
    setWorkflowDescription(template.description)
    setViewMode('detail')
  }

  /**
   * Handle back button - return to list view
   */
  const handleBackToList = () => {
    setViewMode('list')
    setSelectedTemplate(null)
    setWorkflowName('')
    setWorkflowDescription('')
  }

  /**
   * Handle workflow creation from template
   */
  const handleCreateFromTemplate = async () => {
    if (!selectedTemplate || !workflowName.trim()) {
      toastError({ title: 'Name required', description: 'Please enter a workflow name' })
      return
    }

    await createWorkflow.mutateAsync({
      name: workflowName.trim(),
      description: workflowDescription.trim(),
      enabled: false,
      templateId: selectedTemplate.id,
    })
  }

  /** Handle single entity install request from EntityRequirementsStep */
  const handleInstallEntity = useCallback((templateId: string) => {
    setEntityInstallTemplateId(templateId)
  }, [])

  /** Handle completion of entity installation */
  const handleEntityInstallComplete = useCallback(() => {
    setEntityInstallTemplateId(null)
    // Resource store auto-updates → EntityRequirementsStep re-evaluates via useResources()
  }, [])

  /**
   * Reset state when dialog closes
   */
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setViewMode('list')
      setSelectedTemplate(null)
      setWorkflowName('')
      setWorkflowDescription('')
      setSearchQuery('')
      setSelectedCategory('all')
      setEntityInstallTemplateId(null)
    }
    onOpenChange(open)
  }

  // Compute app install status for the selected template
  const selectedRequiredApps: RequiredApp[] = selectedTemplate?.requiredApps ?? []
  const appStatuses = useMemo(
    () => getAppInstallStatus(selectedRequiredApps),
    [selectedRequiredApps, appInstallations]
  )
  const missingRequiredCount = appStatuses.filter((a) => a.required && !a.installed).length
  const missingEntityCount = useMemo(() => {
    if (!hasEntityRequirements) return 0
    return selectedRequiredEntities.filter((req) => {
      if (req.entityTemplateId.startsWith('__system:')) return false
      return !getResourceById(req.apiSlug)
    }).length
  }, [selectedRequiredEntities, resources, getResourceById, hasEntityRequirements])

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className=' h-[550px]' innerClassName='p-0' position='tc' size='3xl'>
          <div className='flex flex-col flex-1 min-h-0'>
            {viewMode === 'list' ? (
              <>
                {/* LIST VIEW */}
                <DialogHeader className='border-b px-3 h-10 flex flex-row items-center justify-start mb-0'>
                  <div>
                    <Button variant='ghost' size='sm'>
                      Template selector
                    </Button>

                    <DialogTitle className='sr-only'>Use Template</DialogTitle>
                    <DialogDescription className='sr-only'>Template selector</DialogDescription>
                  </div>
                </DialogHeader>

                {/* Search Bar */}

                {/* Main Content: Sidebar + Templates */}
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
                          onValueChange={(value) => setSelectedCategory(value as WorkflowCategory)}>
                          {constants.workflowCategories.map((category) => {
                            const templateCount =
                              category.value === 'all'
                                ? (templates?.length ?? 0)
                                : (templates?.filter((t) =>
                                    (t.categories as string[])?.includes(category.value)
                                  ).length ?? 0)

                            const Icon = categoryIcons[category.icon]

                            return (
                              <RadioGroupItemCard
                                key={category.value}
                                label={category.label}
                                value={category.value}
                                description={
                                  isLoading
                                    ? 'Loading...'
                                    : `${templateCount} template${templateCount !== 1 ? 's' : ''}`
                                }
                                icon={Icon ? <Icon /> : undefined}
                              />
                            )
                          })}
                        </RadioGroup>
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Template List */}
                  <div className='flex-1 overflow-hidden flex flex-col'>
                    <div className='py-3 px-6'>
                      <InputSearch
                        placeholder='Search templates by name or description...'
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
                          <EmptyDescription>Fetching workflow templates</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : filteredTemplates.length > 0 ? (
                      <ScrollArea className='flex-1'>
                        <div className='p-6 space-y-2'>
                          {filteredTemplates.map((template) => (
                            <div
                              key={template.id}
                              onClick={() => handleSelectTemplate(template)}
                              className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer'>
                              <div className='flex items-start gap-3 flex-1 min-w-0'>
                                <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors overflow-hidden shrink-0'>
                                  {template.imgUrl ? (
                                    <img
                                      src={template.imgUrl}
                                      alt={template.name}
                                      className='size-full object-cover'
                                    />
                                  ) : (
                                    <Sparkles className='size-4 text-primary-500' />
                                  )}
                                </div>
                                <div className='flex flex-col flex-1 min-w-0'>
                                  <div className='flex items-center gap-2'>
                                    <span className='text-sm font-medium truncate'>
                                      {template.name}
                                    </span>
                                    {template.popularity > 80 && (
                                      <Badge variant='secondary' className='text-xs shrink-0'>
                                        <TrendingUp className='size-3 mr-1' />
                                        Popular
                                      </Badge>
                                    )}
                                  </div>
                                  <span className='text-xs text-muted-foreground line-clamp-1 mt-0.5 min-h-[50px]'>
                                    {template.description}
                                  </span>
                                </div>
                              </div>
                              {(template.categories as string[])?.length > 0 && (
                                <div className='flex gap-1 shrink-0'>
                                  {(template.categories as string[]).slice(0, 2).map((cat) => (
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
                              ? 'No templates match your search criteria. Try adjusting your search query or browse different categories.'
                              : 'No templates available in this category yet. Try selecting a different category or check back later.'}
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
                <DialogHeader className='border-b px-3 py-2 mb-0 h-10 '>
                  <div className='flex items-center gap-1'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={handleBackToList}
                      disabled={createWorkflow.isPending}>
                      <ChevronLeft />
                      Back
                    </Button>
                    <Separator orientation='vertical' className='h-5' />
                    <Button variant='ghost' size='sm'>
                      {selectedTemplate.name}
                    </Button>

                    <div>
                      <DialogTitle className='sr-only'>Use Template</DialogTitle>
                      <DialogDescription className='sr-only'>Template selector</DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className='flex flex-1 overflow-hidden'>
                  {/* Left Column: Preview (2/3 width) */}
                  <div className='flex-[2] border-r bg-muted/30 flex flex-col overflow-hidden'>
                    {isLoadingDetail ? (
                      <div className='flex-1 flex items-center justify-center'>
                        <Loader2 className='w-8 h-8 animate-spin text-muted-foreground' />
                      </div>
                    ) : workflowViewerData ? (
                      <WorkflowViewer
                        workflow={workflowViewerData}
                        options={{
                          showTitle: false,
                          showMinimap: true,
                          showNavigation: true,
                          showBranding: false,
                        }}
                        className='h-full w-full'
                      />
                    ) : (
                      <div className='flex-1 flex flex-col items-center justify-center text-muted-foreground'>
                        <ImageIcon className='size-8 mb-4' />
                        <p className='text-sm'>No preview available</p>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Form (1/3 width) */}
                  <div className='flex-1 flex flex-col'>
                    <ScrollArea className='flex-1'>
                      <div className='p-3 space-y-6'>
                        {/* Template Info */}
                        <div>
                          <h3 className='text-sm font-semibold text-muted-foreground mb-2'>
                            {selectedTemplate.name}
                          </h3>
                          <p className='text-sm text-primary-400'>
                            {selectedTemplate?.description}
                          </p>
                          <div className='flex gap-1 flex-wrap mt-2'>
                            {(selectedTemplate?.categories as string[])?.map((cat) => (
                              <Badge key={cat} variant='outline' className='text-xs'>
                                {cat}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        {/* Required Apps Section */}
                        {appStatuses.length > 0 && (
                          <div>
                            <h4 className='text-xs font-semibold text-muted-foreground mb-2'>
                              Required Apps
                            </h4>
                            <div className='space-y-2'>
                              {appStatuses.map((app) => (
                                <div
                                  key={app.appSlug}
                                  className='flex items-center justify-between rounded-lg border p-2'>
                                  <div className='flex items-center gap-2'>
                                    {app.avatarUrl && (
                                      <img
                                        src={app.avatarUrl}
                                        alt={app.appTitle}
                                        className='size-5 rounded'
                                      />
                                    )}
                                    <span className='text-sm'>{app.appTitle || app.appSlug}</span>
                                  </div>
                                  <InlineAppInstallButton appSlug={app.appSlug} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Entity Requirements Section */}
                        {hasEntityRequirements && (
                          <div>
                            <h4 className='text-xs font-semibold text-muted-foreground mb-2'>
                              Required Entities
                            </h4>
                            <EntityRequirementsStep
                              requiredEntities={selectedRequiredEntities}
                              onInstallEntity={handleInstallEntity}
                            />
                          </div>
                        )}

                        {/* Workflow Name */}
                        <div className='space-y-2'>
                          <Label htmlFor='workflow-name'>Workflow Name *</Label>
                          <Input
                            id='workflow-name'
                            value={workflowName}
                            onChange={(e) => setWorkflowName(e.target.value)}
                            placeholder='Enter workflow name'
                            disabled={createWorkflow.isPending}
                            required
                          />
                        </div>

                        {/* Workflow Description */}
                        <div className='space-y-2 pb-6'>
                          <Label htmlFor='workflow-description'>Description</Label>
                          <Textarea
                            id='workflow-description'
                            value={workflowDescription}
                            onChange={(e) => setWorkflowDescription(e.target.value)}
                            placeholder='Enter workflow description (optional)'
                            disabled={createWorkflow.isPending}
                            rows={4}
                          />
                        </div>
                      </div>
                    </ScrollArea>

                    {/* Footer */}
                    <div className='border-t p-3'>
                      {missingRequiredCount > 0 && (
                        <div className='flex items-center gap-1.5 text-xs text-amber-600 mb-2'>
                          <AlertTriangle className='size-3' />
                          <span>
                            {missingRequiredCount} required app
                            {missingRequiredCount !== 1 ? 's' : ''} not installed
                          </span>
                        </div>
                      )}
                      {missingEntityCount > 0 && (
                        <div className='flex items-center gap-1.5 text-xs text-amber-600 mb-2'>
                          <AlertTriangle className='size-3' />
                          <span>
                            {missingEntityCount} required entit
                            {missingEntityCount !== 1 ? 'ies' : 'y'} not found
                          </span>
                        </div>
                      )}
                      <Button
                        className='w-full'
                        onClick={handleCreateFromTemplate}
                        loading={createWorkflow.isPending}
                        loadingText='Creating workflow...'>
                        Use this template
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Single Entity Install Dialog (shown when user clicks Install on an entity row) */}
      {entityInstallTemplateId && (
        <SingleEntityInstallDialog
          open={!!entityInstallTemplateId}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEntityInstallTemplateId(null)
          }}
          templateId={entityInstallTemplateId}
          onComplete={handleEntityInstallComplete}
        />
      )}
    </>
  )
}
