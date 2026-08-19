// apps/web/src/components/workflow/dialogs/workflow-template-dialog.tsx
'use client'

import { constants } from '@auxx/config/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { AlertTriangle, Image as ImageIcon, Sparkles, TrendingUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useCallback, useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { InlineAppInstallButton } from '~/components/apps/ui/app-install-button'
import { useResources } from '~/components/resources/hooks'
import { TemplateDetailLayout, TemplateGalleryDialog } from '~/components/templates/ui'
import type { WorkflowViewerData } from '~/components/workflow/viewer/hooks/use-workflow-viewer'
import { WorkflowViewer } from '~/components/workflow/viewer/workflow-viewer'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { EntityRequirementsStep } from './entity-requirements-step'
import { SingleEntityInstallDialog } from './single-entity-install-dialog'

export type WorkflowCategory = (typeof constants.workflowCategories)[number]['value']

type WorkflowTemplate = RouterOutputs['workflow']['templates']['getPublic'][number]

/** Color map for workflow category badges */
const categoryColorMap = Object.fromEntries(
  constants.workflowCategories.map((c) => [c.value, c.color])
) as Record<string, (typeof constants.workflowCategories)[number]['color']>

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

/**
 * Dialog for selecting a workflow template. The gallery shell, sidebar, search,
 * and filtering live in `TemplateGalleryDialog`; the detail page uses the shared
 * two-pane `TemplateDetailLayout` (WorkflowViewer preview + name/description form
 * and requirement checks). Creating the workflow happens via the footer CTA.
 */
export function WorkflowTemplateDialog({ open, onOpenChange }: WorkflowTemplateDialogProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const { theme } = useTheme()
  const { appInstallations } = useAppsContext()
  const { resources, getResourceById } = useResources()

  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)
  const [workflowName, setWorkflowName] = useState('')
  const [workflowDescription, setWorkflowDescription] = useState('')
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
      { enabled: !!selectedTemplate?.id }
    )

  // Entity requirements — resolved client-side via useResources()
  const selectedRequiredEntities = templateDetail?.requiredEntities ?? []
  const hasEntityRequirements = selectedRequiredEntities.length > 0

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
      // Same reason as `useCreateWorkflow`: the list's 30s `staleTime` means a
      // remount inside that window serves the pre-create page, and staleness
      // expiring on its own never refetches. `refetchType: 'none'` marks it for
      // the next mount without repainting the list we are leaving.
      void utils.workflow.list.invalidate(undefined, { refetchType: 'none' })
      router.push(`/app/workflows/${workflow.id}`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create workflow', description: error.message })
    },
  })

  /** Check install status of required apps (entirely client-side) */
  const getAppInstallStatus = (apps: RequiredApp[]) =>
    apps.map((app) => ({
      ...app,
      installed: appInstallations.some((inst) => inst.app.slug === app.appSlug),
      avatarUrl: appInstallations.find((inst) => inst.app.slug === app.appSlug)?.app.avatarUrl,
    }))

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

  function handleSelect(template: WorkflowTemplate) {
    setSelectedTemplate(template)
    setWorkflowName(template.name)
    setWorkflowDescription(template.description)
  }

  function handleDetailExit() {
    setSelectedTemplate(null)
    setWorkflowName('')
    setWorkflowDescription('')
  }

  async function handleCreate() {
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

  const handleInstallEntity = useCallback((templateId: string) => {
    setEntityInstallTemplateId(templateId)
  }, [])

  const handleEntityInstallComplete = useCallback(() => {
    setEntityInstallTemplateId(null)
    // Resource store auto-updates → EntityRequirementsStep re-evaluates via useResources()
  }, [])

  return (
    <>
      <TemplateGalleryDialog<WorkflowTemplate>
        open={open}
        onOpenChange={onOpenChange}
        title='Use Template'
        description='Select a workflow template to create from'
        crumbLabel='Template selector'
        items={templates ?? []}
        isLoading={isLoading}
        categories={constants.workflowCategories}
        renderIcon={(template) => (
          <div className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted transition-colors group-hover:bg-secondary'>
            {template.imgUrl ? (
              <img src={template.imgUrl} alt={template.name} className='size-full object-cover' />
            ) : (
              <Sparkles className='size-4 text-primary-500' />
            )}
          </div>
        )}
        renderNameBadge={(template) =>
          template.popularity > 80 ? (
            <Badge variant='secondary' className='shrink-0 text-xs'>
              <TrendingUp className='mr-1 size-3' />
              Popular
            </Badge>
          ) : null
        }
        renderBadges={(template) =>
          template.categories.slice(0, 2).map((cat) => (
            <Badge key={cat} variant={categoryColorMap[cat] ?? 'zinc'} className='text-xs'>
              {constants.workflowCategories.find((c) => c.value === cat)?.label ?? cat}
            </Badge>
          ))
        }
        onSelectItem={handleSelect}
        detailBusy={createWorkflow.isPending}
        onDetailExit={handleDetailExit}
        renderDetail={() => (
          <TemplateDetailLayout
            previewLoading={isLoadingDetail}
            preview={
              workflowViewerData ? (
                <WorkflowViewer
                  workflow={workflowViewerData}
                  theme={theme as 'light' | 'dark' | 'system'}
                  options={{
                    showTitle: false,
                    showMinimap: true,
                    showNavigation: true,
                    showBranding: false,
                  }}
                  className='h-full w-full'
                />
              ) : (
                <div className='flex h-full flex-col items-center justify-center text-muted-foreground'>
                  <ImageIcon className='mb-4 size-8' />
                  <p className='text-sm'>No preview available</p>
                </div>
              )
            }>
            <div className='space-y-6 p-3'>
              {/* Template info */}
              {selectedTemplate && (
                <div>
                  <h3 className='mb-2 text-sm font-semibold text-muted-foreground'>
                    {selectedTemplate.name}
                  </h3>
                  <p className='text-sm text-primary-400'>{selectedTemplate.description}</p>
                  <div className='mt-2 flex flex-wrap gap-1'>
                    {selectedTemplate.categories.map((cat) => (
                      <Badge
                        key={cat}
                        variant={categoryColorMap[cat] ?? 'zinc'}
                        className='text-xs'>
                        {constants.workflowCategories.find((c) => c.value === cat)?.label ?? cat}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Required apps */}
              {appStatuses.length > 0 && (
                <div>
                  <h4 className='mb-2 text-xs font-semibold text-muted-foreground'>
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

              {/* Entity requirements */}
              {hasEntityRequirements && (
                <div>
                  <h4 className='mb-2 text-xs font-semibold text-muted-foreground'>
                    Required Entities
                  </h4>
                  <EntityRequirementsStep
                    requiredEntities={selectedRequiredEntities}
                    onInstallEntity={handleInstallEntity}
                  />
                </div>
              )}

              {/* Workflow name */}
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

              {/* Workflow description */}
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
          </TemplateDetailLayout>
        )}
        renderDetailFooter={() => (
          <>
            {missingRequiredCount > 0 && (
              <span className='flex items-center gap-1 text-xs text-amber-600'>
                <AlertTriangle className='size-3' />
                {missingRequiredCount} required app{missingRequiredCount !== 1 ? 's' : ''} not
                installed
              </span>
            )}
            {missingEntityCount > 0 && (
              <span className='flex items-center gap-1 text-xs text-amber-600'>
                <AlertTriangle className='size-3' />
                {missingEntityCount} required entit{missingEntityCount !== 1 ? 'ies' : 'y'} not
                found
              </span>
            )}
            <Button
              size='sm'
              variant='outline'
              onClick={handleCreate}
              loading={createWorkflow.isPending}
              loadingText='Creating workflow...'>
              Use this template
            </Button>
          </>
        )}
      />

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
